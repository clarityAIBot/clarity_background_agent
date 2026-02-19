/**
 * Clarity AI Container - Main HTTP Server
 *
 * This server runs inside a Cloudflare Container and handles issue processing
 * using the Strategy Pattern for multi-agent support.
 */

import * as http from 'http';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { AgentExecutor } from './agents/index.js';
import type { IssueContext, AgentConfig, AgentType, AgentProvider, SlackFileAttachment, DownloadedAttachment } from './agents/types.js';
import { createLogger } from './logger.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 8080;

// Create logger for this module
const logger = createLogger('Main');

// Container response interface
interface ContainerResponse {
  success: boolean;
  message: string;
  error?: string;
  prUrl?: string;
  prNumber?: number;
  prBranchName?: string;
  summary?: string;           // AI task summary from doc/ai-task/issue-<N>.md
  needsClarification?: boolean;
  clarifyingQuestions?: string;
  costUsd?: number;
  durationMs?: number;
  agentType?: string;
  agentProvider?: string;
  // Session persistence (ADR-001) - must match consumer's ContainerResponse interface
  agentSessionId?: string;         // SDK session ID for future resumption
  agentSessionBlob?: string;       // Gzipped base64 session data
}

// Environment variables
const MESSAGE = process.env.MESSAGE || 'Hello from Clarity AI Container';
const INSTANCE_ID = process.env.CLOUDFLARE_DEPLOYMENT_ID || 'unknown';

// Prompt template paths
const PROMPT_TEMPLATE_PATH = path.join(__dirname, 'prompts', 'issue_processor.md');

// ============= Prompt Builder =============

/**
 * Simplified prompt builder following vibe-kanban approach:
 * - If existingPrNumber exists: Build PR changes prompt (working on existing PR)
 * - Otherwise: Build main prompt + append issue context at the end
 *
 * CACHE OPTIMIZATION: Static template is at the top (cacheable prefix),
 * dynamic content (issue details, conversation history) is at the end.
 */
async function buildPrompt(issueContext: IssueContext, attachments?: DownloadedAttachment[]): Promise<string> {
  // If there's an existing PR, use follow-up prompt for PR changes
  if (issueContext.existingPrNumber && issueContext.existingPrUrl) {
    return buildPRChangesPrompt(issueContext, attachments);
  }

  // Read the static template (cacheable prefix)
  const template = await fs.readFile(PROMPT_TEMPLATE_PATH, 'utf8');

  // Build the dynamic issue context section (placed at the end for cache efficiency)
  const issueContextSection = buildIssueContextSection(issueContext, attachments);

  // Replace the single placeholder with the full issue context
  const prompt = template.replace('{{ISSUE_CONTEXT}}', issueContextSection);

  logger.log('PROMPT', 'Built prompt', {
    templatePath: PROMPT_TEMPLATE_PATH,
    promptLength: prompt.length,
    hasConversationHistory: !!issueContext.conversationHistory,
    attachmentCount: attachments?.length ?? 0,
  });

  return prompt;
}

/**
 * Build the dynamic issue context section (placed at end of prompt for cache efficiency)
 */
function buildIssueContextSection(issueContext: IssueContext, attachments?: DownloadedAttachment[]): string {
  let section = `**Issue #${issueContext.issueNumber}:** "${issueContext.title}"

### Description
${issueContext.description}

### Labels
${issueContext.labels.join(', ') || 'None'}

### Author
${issueContext.author}`;

  // Append conversation history if present
  if (issueContext.conversationHistory) {
    section += `

---

### Conversation History

${issueContext.conversationHistory}`;
  }

  // Append attachment info if files were downloaded
  if (attachments?.length) {
    section += buildAttachmentSection(attachments);
  }

  return section;
}

/**
 * Build prompt for changes to an existing PR
 *
 * CACHE OPTIMIZATION: Static instructions first, dynamic content at the end.
 */
function buildPRChangesPrompt(issueContext: IssueContext, attachments?: DownloadedAttachment[]): string {
  // Static instructions (cacheable prefix)
  let prompt = `# Changes Request for Existing Pull Request

You are working on an existing pull request that needs additional changes.

## Instructions

1. You are already on the PR branch - DO NOT create any new branches
2. Review the current state of the codebase
3. Understand what changes were already made in this PR
4. Implement the requested additional changes
5. Make sure your changes don't break existing functionality
6. Leave changes uncommitted - the system will handle committing and pushing

**IMPORTANT:** Do NOT commit, push, or create a new PR. Just make the file changes and leave them uncommitted. The system will automatically commit and push your changes to update the existing PR.

---
---

## Context

### Original Issue
- **Issue #${issueContext.issueNumber}**: ${issueContext.title}
- **Original Description**: ${issueContext.description}

### Existing Pull Request
- **PR #${issueContext.existingPrNumber}**: ${issueContext.existingPrUrl}

### Requested Changes
${issueContext.followUpRequest || 'Additional changes requested'}
`;

  // Include conversation history if available (dynamic content at the end)
  if (issueContext.conversationHistory) {
    prompt += `
### Conversation History

${issueContext.conversationHistory}
`;
  }

  // Append attachment info if files were downloaded
  if (attachments?.length) {
    prompt += buildAttachmentSection(attachments);
  }

  logger.log('PROMPT', 'Built PR changes prompt', {
    promptLength: prompt.length,
    prNumber: issueContext.existingPrNumber,
    hasConversationHistory: !!issueContext.conversationHistory,
    attachmentCount: attachments?.length ?? 0,
  });

  return prompt;
}

// ============= Slack Attachment Downloader =============

const IMAGE_MIMETYPES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024;   // 10MB per file
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;   // 50MB total

/**
 * Download Slack file attachments into the workspace.
 * Files are placed in .clarity-attachments/ so the agent can Read them.
 */
async function downloadSlackAttachments(
  attachments: SlackFileAttachment[],
  botToken: string,
  workspaceDir: string,
): Promise<DownloadedAttachment[]> {
  const attachmentsDir = path.join(workspaceDir, '.clarity-attachments');
  await fs.mkdir(attachmentsDir, { recursive: true });

  const downloaded: DownloadedAttachment[] = [];
  let totalSize = 0;

  for (const attachment of attachments) {
    if (attachment.size > MAX_FILE_SIZE) {
      logger.log('ATTACHMENTS', 'Skipping oversized file', {
        name: attachment.name,
        size: attachment.size,
      });
      continue;
    }

    if (totalSize + attachment.size > MAX_TOTAL_SIZE) {
      logger.log('ATTACHMENTS', 'Total size limit reached, skipping remaining');
      break;
    }

    try {
      const response = await fetch(attachment.urlPrivateDownload, {
        headers: { Authorization: `Bearer ${botToken}` },
      });

      if (!response.ok) {
        logger.log('ATTACHMENTS', 'Download failed', {
          name: attachment.name,
          status: response.status,
        });
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const sanitizedName = attachment.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const localFilename = `${Date.now()}_${sanitizedName}`;
      const localPath = path.join(attachmentsDir, localFilename);
      const relativePath = `.clarity-attachments/${localFilename}`;

      await fs.writeFile(localPath, buffer);
      totalSize += buffer.length;

      const isImage = IMAGE_MIMETYPES.has(attachment.mimetype);

      downloaded.push({
        originalName: attachment.name,
        localPath,
        relativePath,
        mimetype: attachment.mimetype,
        filetype: attachment.filetype,
        isImage,
      });

      logger.log('ATTACHMENTS', 'Downloaded', {
        name: attachment.name,
        localPath: relativePath,
        size: buffer.length,
        isImage,
      });
    } catch (error) {
      logger.log('ATTACHMENTS', 'Error downloading', {
        name: attachment.name,
        error: (error as Error).message,
      });
    }
  }

  return downloaded;
}

/**
 * Build the attachment section to append to prompts.
 */
function buildAttachmentSection(attachments: DownloadedAttachment[]): string {
  if (attachments.length === 0) return '';

  const images = attachments.filter(a => a.isImage);
  const others = attachments.filter(a => !a.isImage);

  let section = `\n\n---\n\n### Attachments\n\nThe user attached ${attachments.length} file(s) to their message.\n\n`;

  if (images.length > 0) {
    section += `**Images** (use the Read tool to view these):\n`;
    for (const img of images) {
      section += `- \`${img.relativePath}\` (${img.originalName}, ${img.mimetype})\n`;
    }
    section += `\n`;
  }

  if (others.length > 0) {
    section += `**Files** (read these to understand the user's request):\n`;
    for (const file of others) {
      section += `- \`${file.relativePath}\` (${file.originalName}, ${file.mimetype})\n`;
    }
    section += `\n`;
  }

  section += `**IMPORTANT:** Review ALL attached files before proceeding. Images may contain screenshots, mockups, or error messages critical to understanding the request.\n`;

  return section;
}

// ============= HTTP Handlers =============

interface HealthStatus {
  status: string;
  message: string;
  instanceId: string;
  timestamp: string;
  claudeCodeAvailable: boolean;
  githubTokenAvailable: boolean;
  availableAgents: string[];
}

async function healthHandler(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  logger.log('HEALTH', 'Health check requested');

  const { AgentStrategyFactory } = await import('./agents/factory.js');

  const response: HealthStatus = {
    status: 'healthy',
    message: MESSAGE,
    instanceId: INSTANCE_ID,
    timestamp: new Date().toISOString(),
    claudeCodeAvailable: !!process.env.ANTHROPIC_API_KEY,
    githubTokenAvailable: !!process.env.GITHUB_TOKEN,
    availableAgents: AgentStrategyFactory.getAvailableAgents()
  };

  logger.log('HEALTH', 'Health check response', {
    status: response.status,
    claudeCodeAvailable: response.claudeCodeAvailable,
    githubTokenAvailable: response.githubTokenAvailable,
    availableAgents: response.availableAgents
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response));
}

async function errorHandler(_req: http.IncomingMessage, _res: http.ServerResponse): Promise<void> {
  throw new Error('This is a test error from the container');
}

async function processIssueHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  logger.log('ISSUE_HANDLER', 'Processing issue request');

  // Read request body
  let requestBody = '';
  for await (const chunk of req) {
    requestBody += chunk;
  }

  let requestData: any = {};
  if (requestBody) {
    try {
      requestData = JSON.parse(requestBody);
      logger.log('ISSUE_HANDLER', 'Received request data', {
        hasAnthropicKey: !!requestData.ANTHROPIC_API_KEY,
        hasGithubToken: !!requestData.GITHUB_TOKEN,
        agentType: requestData.AGENT_TYPE,
        agentProvider: requestData.AGENT_PROVIDER
      });

      // Set environment variables from request body
      if (requestData.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = requestData.ANTHROPIC_API_KEY;
      if (requestData.GITHUB_TOKEN) process.env.GITHUB_TOKEN = requestData.GITHUB_TOKEN;
      if (requestData.OPENAI_API_KEY) process.env.OPENAI_API_KEY = requestData.OPENAI_API_KEY;
      if (requestData.GOOGLE_API_KEY) process.env.GOOGLE_API_KEY = requestData.GOOGLE_API_KEY;
      if (requestData.GROQ_API_KEY) process.env.GROQ_API_KEY = requestData.GROQ_API_KEY;
      if (requestData.DEEPSEEK_API_KEY) process.env.DEEPSEEK_API_KEY = requestData.DEEPSEEK_API_KEY;
      if (requestData.MISTRAL_API_KEY) process.env.MISTRAL_API_KEY = requestData.MISTRAL_API_KEY;

      // Issue context from request
      if (requestData.ISSUE_ID) process.env.ISSUE_ID = requestData.ISSUE_ID;
      if (requestData.ISSUE_NUMBER) process.env.ISSUE_NUMBER = requestData.ISSUE_NUMBER;
      if (requestData.ISSUE_TITLE) process.env.ISSUE_TITLE = requestData.ISSUE_TITLE;
      if (requestData.ISSUE_BODY) process.env.ISSUE_BODY = requestData.ISSUE_BODY;
      if (requestData.ISSUE_LABELS) process.env.ISSUE_LABELS = requestData.ISSUE_LABELS;
      if (requestData.REPOSITORY_URL) process.env.REPOSITORY_URL = requestData.REPOSITORY_URL;
      if (requestData.REPOSITORY_NAME) process.env.REPOSITORY_NAME = requestData.REPOSITORY_NAME;
      if (requestData.ISSUE_AUTHOR) process.env.ISSUE_AUTHOR = requestData.ISSUE_AUTHOR;

      // Optional user message and existing PR info
      if (requestData.FOLLOW_UP_REQUEST) process.env.FOLLOW_UP_REQUEST = requestData.FOLLOW_UP_REQUEST;
      if (requestData.FOLLOW_UP_AUTHOR) process.env.FOLLOW_UP_AUTHOR = requestData.FOLLOW_UP_AUTHOR;
      if (requestData.EXISTING_PR_NUMBER) process.env.EXISTING_PR_NUMBER = requestData.EXISTING_PR_NUMBER;
      if (requestData.EXISTING_PR_URL) process.env.EXISTING_PR_URL = requestData.EXISTING_PR_URL;
      if (requestData.CONVERSATION_HISTORY) process.env.CONVERSATION_HISTORY = requestData.CONVERSATION_HISTORY;

      // Note: AGENT_SESSION_ID and AGENT_SESSION_BLOB are NOT set as env vars
      // because env vars have a 5000 byte limit. Session data is passed directly
      // from requestData to executor (see ADR-001).

    } catch (error) {
      logger.log('ISSUE_HANDLER', 'Error parsing request body', { error: (error as Error).message });
    }
  }

  // Validate required fields
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.GOOGLE_API_KEY) {
    logger.log('ISSUE_HANDLER', 'Missing API key');
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No API key provided (ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY required)' }));
    return;
  }

  if (!process.env.ISSUE_ID || !process.env.REPOSITORY_URL) {
    logger.log('ISSUE_HANDLER', 'Missing issue context');
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Issue context not provided' }));
    return;
  }

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'GITHUB_TOKEN is required' }));
    return;
  }

  // Build issue context
  const issueContext: IssueContext = {
    issueId: process.env.ISSUE_ID!,
    issueNumber: process.env.ISSUE_NUMBER!,
    title: process.env.ISSUE_TITLE!,
    description: process.env.ISSUE_BODY!,
    labels: process.env.ISSUE_LABELS ? JSON.parse(process.env.ISSUE_LABELS) : [],
    repositoryUrl: process.env.REPOSITORY_URL!,
    repositoryName: process.env.REPOSITORY_NAME!,
    author: process.env.ISSUE_AUTHOR!,
    followUpRequest: process.env.FOLLOW_UP_REQUEST,
    followUpAuthor: process.env.FOLLOW_UP_AUTHOR,
    existingPrNumber: process.env.EXISTING_PR_NUMBER,
    existingPrUrl: process.env.EXISTING_PR_URL,
    conversationHistory: process.env.CONVERSATION_HISTORY,
    // Slack attachments — passed directly from requestData (not env vars) to avoid size limits
    slackAttachments: requestData.SLACK_ATTACHMENTS
      ? JSON.parse(requestData.SLACK_ATTACHMENTS)
      : undefined,
    slackBotToken: requestData.SLACK_BOT_TOKEN,
    // Slack progress streaming — container posts updates directly to Slack thread
    slackChannelId: requestData.SLACK_CHANNEL_ID,
    slackThreadTs: requestData.SLACK_THREAD_TS,
  };

  // Build agent config from request or environment
  const agentConfig: AgentConfig = {
    type: (requestData.AGENT_TYPE || process.env.AGENT_TYPE || 'claude-code') as AgentType,
    provider: (requestData.AGENT_PROVIDER || process.env.AGENT_PROVIDER) as AgentProvider | undefined,
    model: requestData.AGENT_MODEL || process.env.AGENT_MODEL,
    maxTurns: parseInt(requestData.MAX_TURNS || process.env.MAX_TURNS || '100', 10),
    timeout: parseInt(requestData.TIMEOUT || process.env.TIMEOUT || '600000', 10)
  };

  logger.log('ISSUE_HANDLER', 'Issue context prepared', {
    issueId: issueContext.issueId,
    issueNumber: issueContext.issueNumber,
    repository: issueContext.repositoryName,
    hasUserMessage: !!issueContext.followUpRequest,
    hasExistingPR: !!issueContext.existingPrNumber,
    agentType: agentConfig.type,
    agentProvider: agentConfig.provider
  });

  // Execute using AgentExecutor
  try {
    const executor = new AgentExecutor();

    // Session resumption (ADR-001) - fetch blob from URL instead of receiving in POST body
    // This avoids HTTP body size limits for large sessions
    let sessionOptions: { resumeSessionId: string; sessionBlob?: string } | undefined;
    if (requestData.AGENT_SESSION_ID) {
      sessionOptions = { resumeSessionId: requestData.AGENT_SESSION_ID };

      // Fetch session blob from URL if provided (preferred over inline blob)
      if (requestData.SESSION_DOWNLOAD_URL) {
        try {
          logger.log('ISSUE_HANDLER', 'Fetching session blob from URL', {
            sessionId: requestData.AGENT_SESSION_ID,
            url: requestData.SESSION_DOWNLOAD_URL.substring(0, 100) + '...',
          });
          const response = await fetch(requestData.SESSION_DOWNLOAD_URL);
          if (response.ok) {
            // Response is already decompressed .jsonl, need to re-compress for restoreSessionFromBlob
            const jsonlContent = await response.text();
            const { gzip } = await import('zlib');
            const { promisify } = await import('util');
            const gzipAsync = promisify(gzip);
            const compressed = await gzipAsync(Buffer.from(jsonlContent, 'utf-8'));
            sessionOptions.sessionBlob = compressed.toString('base64');
            logger.log('ISSUE_HANDLER', 'Session blob fetched successfully', {
              sessionId: requestData.AGENT_SESSION_ID,
              jsonlLength: jsonlContent.length,
              compressedLength: sessionOptions.sessionBlob.length,
            });
          } else {
            logger.log('ISSUE_HANDLER', 'Failed to fetch session blob', {
              sessionId: requestData.AGENT_SESSION_ID,
              status: response.status,
            });
          }
        } catch (fetchError) {
          logger.log('ISSUE_HANDLER', 'Error fetching session blob', {
            sessionId: requestData.AGENT_SESSION_ID,
            error: (fetchError as Error).message,
          });
        }
      } else if (requestData.AGENT_SESSION_BLOB) {
        // Fallback: use inline blob if provided (for backwards compatibility)
        sessionOptions.sessionBlob = requestData.AGENT_SESSION_BLOB;
      }

      logger.log('ISSUE_HANDLER', 'Session resumption configured', {
        sessionId: sessionOptions.resumeSessionId,
        hasBlobData: !!sessionOptions.sessionBlob,
        blobLength: sessionOptions.sessionBlob?.length || 0,
      });
    }

    // Build attachment downloader callback if files were attached
    const attachmentDownloader = issueContext.slackAttachments?.length && issueContext.slackBotToken
      ? (workspaceDir: string) => downloadSlackAttachments(
          issueContext.slackAttachments!,
          issueContext.slackBotToken!,
          workspaceDir,
        )
      : undefined;

    const result = await executor.execute(
      issueContext,
      agentConfig,
      githubToken,
      buildPrompt,
      (event) => {
        logger.log('PROGRESS', event.type, { message: event.message });
      },
      sessionOptions,
      attachmentDownloader,
    );

    const containerResponse: ContainerResponse = {
      success: result.success,
      message: result.message,
      error: result.error,
      prUrl: result.prUrl,
      prNumber: result.prNumber,
      prBranchName: result.prBranchName,
      summary: result.summary,
      needsClarification: result.needsClarification,
      clarifyingQuestions: result.clarifyingQuestions,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
      agentType: agentConfig.type,
      agentProvider: agentConfig.provider,
      // Session persistence (ADR-001) - must match consumer's expected field names
      agentSessionId: result.sessionId,
      agentSessionBlob: result.sessionBlob
    };

    // Log session blob size for monitoring (ADR-001)
    const sessionBlobSize = result.sessionBlob?.length || 0;
    logger.log('ISSUE_HANDLER', 'Processing completed', {
      success: containerResponse.success,
      message: containerResponse.message,
      agentType: containerResponse.agentType,
      agentSessionId: result.sessionId,
      sessionBlobSizeBytes: sessionBlobSize,
      sessionBlobSizeMB: (sessionBlobSize / 1024 / 1024).toFixed(2)
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(containerResponse));

  } catch (error) {
    logger.log('ISSUE_HANDLER', 'Processing failed', {
      error: error instanceof Error ? error.message : String(error)
    });

    const errorResponse: ContainerResponse = {
      success: false,
      message: 'Failed to process issue',
      error: error instanceof Error ? error.message : String(error),
      agentType: agentConfig.type,
      agentProvider: agentConfig.provider
    };

    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(errorResponse));
  }
}

// ============= Request Router =============

async function requestHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const { method, url } = req;
  const startTime = Date.now();

  logger.log('REQUEST', 'Incoming request', { method, url });

  try {
    if (url === '/' || url === '/container') {
      await healthHandler(req, res);
    } else if (url === '/error') {
      await errorHandler(req, res);
    } else if (url === '/process-issue') {
      await processIssueHandler(req, res);
    } else {
      logger.log('REQUEST', 'Route not found', { url });
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }

    logger.log('REQUEST', 'Request completed', {
      method,
      url,
      processingTimeMs: Date.now() - startTime
    });

  } catch (error) {
    logger.log('REQUEST', 'Request handler error', {
      error: error instanceof Error ? error.message : String(error),
      method,
      url
    });

    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Internal server error',
      message: (error as Error).message
    }));
  }
}

// ============= Server Setup =============

const server = http.createServer(requestHandler);

server.listen(PORT, '0.0.0.0', () => {
  logger.log('SERVER', 'Clarity AI container server started', {
    port: PORT,
    host: '0.0.0.0',
    pid: process.pid,
    nodeVersion: process.version
  });

  logger.log('SERVER', 'Configuration check', {
    claudeCodeAvailable: !!process.env.ANTHROPIC_API_KEY,
    githubTokenAvailable: !!process.env.GITHUB_TOKEN
  });
});

// Error handling
server.on('error', (error) => {
  logger.log('SERVER', 'Server error', {
    error: error.message,
    code: (error as any).code
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.log('SERVER', 'Received SIGTERM, shutting down gracefully');
  server.close(() => {
    logger.log('SERVER', 'Server closed successfully');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.log('SERVER', 'Received SIGINT, shutting down gracefully');
  server.close(() => {
    logger.log('SERVER', 'Server closed successfully');
    process.exit(0);
  });
});

process.on('uncaughtException', (error) => {
  logger.log('SERVER', 'Uncaught exception', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.log('SERVER', 'Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason)
  });
});
