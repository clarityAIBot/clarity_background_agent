/**
 * ClaudeCodeStrategy - Strategy for executing tasks using Claude Code SDK.
 *
 * This strategy ONLY handles the AI execution part.
 * Common operations (workspace setup, git, PR creation) are handled by AgentExecutor.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';

import type { IAgentStrategy } from '../strategy.interface.js';
import type {
  AgentContext,
  AgentResult,
  AgentCapabilities,
  ValidationResult,
  AgentProgressEvent
} from '../types.js';
import { hasApiKeyForProvider } from '../utils/api-key-resolver.js';
import {
  getClaudeSessionDir,
  restoreSessionFromBlob,
  extractSessionToBlob,
  listSessionFiles,
  getSessionStats
} from '../utils/session-utils.js';
import { createLogger } from '../../logger.js';

// SDK message type
type SDKMessage = any;

// Create logger for this module
const logger = createLogger('ClaudeCodeStrategy');

/**
 * Extended result with Claude Code specific data
 */
export interface ClaudeCodeExecutionResult {
  success: boolean;
  messages: SDKMessage[];
  solution: string;
  costUsd: number;
  durationMs: number;
  turnCount: number;
  error?: string;
}

export class ClaudeCodeStrategy implements IAgentStrategy {
  readonly name = 'claude-code';
  readonly displayName = 'Claude Code';

  private abortController: AbortController | null = null;
  private isRunning = false;
  private sessionId: string | undefined;

  /**
   * Execute Claude Code with the given prompt.
   *
   * IMPORTANT: This method expects to be called from within the workspace directory.
   * The caller (AgentExecutor) is responsible for:
   * - Setting up the workspace
   * - Changing to the workspace directory
   * - Handling git operations after execution
   * - Creating PRs
   */
  async execute(context: AgentContext): Promise<AgentResult> {
    const { prompt, config, onProgress } = context;

    this.abortController = new AbortController();
    this.isRunning = true;

    const startTime = Date.now();
    const results: SDKMessage[] = [];
    let turnCount = 0;
    let totalCostUsd = 0;

    onProgress?.({
      type: 'started',
      message: 'Starting Claude Code...',
      timestamp: new Date()
    });

    try {
      // Restore session if provided (ADR-001: Session Blob Persistence)
      if (context.resumeSessionId && context.sessionBlob) {
        const sessionDir = getClaudeSessionDir();
        await restoreSessionFromBlob(context.resumeSessionId, context.sessionBlob, sessionDir);
      }

      logger.log('EXECUTE', 'Starting Claude Code query', {
        promptLength: prompt.length,
        maxTurns: config.maxTurns || 100,
        cwd: process.cwd()
      });

      onProgress?.({
        type: 'thinking',
        message: 'Claude Code is analyzing the codebase...',
        timestamp: new Date()
      });

      // Build query options with Skills support and session resumption (ADR-001)
      const queryOptions: Record<string, unknown> = {
        abortController: this.abortController,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        // Enable Skills from user and project directories
        settingSources: ['user', 'project'],
        // Enable Skill tool along with standard tools
        allowedTools: [
          'Skill',      // Enable Skills
          'Read',       // File reading
          'Write',      // File writing
          'Edit',       // File editing
          'Bash',       // Shell commands
          'Glob',       // File pattern matching
          'Grep',       // Content search
          'Task',       // Subagents
          'WebFetch',   // Web content fetching
          'WebSearch',  // Web search
          'TodoWrite',  // Task management
          'NotebookEdit' // Jupyter notebooks
        ]
      };

      // If resumeSessionId is provided, use it to resume the previous session
      if (context.resumeSessionId) {
        queryOptions.resume = context.resumeSessionId;
        logger.log('SESSION', 'Resuming previous session', {
          resumeSessionId: context.resumeSessionId
        });
      }

      logger.log('EXECUTE', 'Query options configured', {
        settingSources: queryOptions.settingSources,
        skillsEnabled: true,
        resuming: !!context.resumeSessionId
      });

      // Execute Claude Code SDK
      for await (const message of query({
        prompt,
        options: queryOptions
      })) {
        turnCount++;
        results.push(message);

        const messageType = (message as any).type;
        const messageSubtype = (message as any).subtype;
        const elapsedMs = Date.now() - startTime;

        // Capture session ID and transcript path from SDK init message (Phase 0: Session verification logging)
        if (messageType === 'system' && messageSubtype === 'init') {
          this.sessionId = (message as any).session_id;
          const transcriptPath = (message as any).transcript_path;
          logger.log('SESSION', 'Captured session info from SDK init message', {
            sessionId: this.sessionId,
            transcriptPath,
            cwd: (message as any).cwd,
            allKeys: Object.keys(message as object),
          });
          // Store transcript path for later use in session extraction
          if (transcriptPath) {
            (this as any)._transcriptPath = transcriptPath;
          }
        }

        if (messageType === 'result') {
          totalCostUsd = (message as any).total_cost_usd || 0;
          logger.log('EXECUTE', 'Query completed', {
            turnCount,
            costUsd: totalCostUsd,
            numTurns: (message as any).num_turns,
            elapsedMs
          });
        } else if (messageType === 'assistant') {
          const content = (message as any).message?.content || [];
          const toolUses = content.filter((c: any) => c.type === 'tool_use');
          const textBlocks = content.filter((c: any) => c.type === 'text');

          if (toolUses.length > 0) {
            onProgress?.({
              type: 'tool_use',
              message: `Using tools: ${toolUses.map((t: any) => t.name).join(', ')}`,
              data: {
                tools: toolUses.map((t: any) => t.name),
                toolDetails: toolUses.map((t: any) => ({
                  name: t.name,
                  context: this.extractToolContext(t.name, t.input),
                })),
              },
              timestamp: new Date()
            });

            logger.log('EXECUTE', 'Tool usage', {
              turnCount,
              elapsedMs,
              toolNames: toolUses.map((t: any) => t.name)
            });
          }

          if (textBlocks.length > 0) {
            logger.log('EXECUTE', 'Assistant response', {
              turnCount,
              elapsedMs,
              textPreview: textBlocks[0]?.text?.substring(0, 100)
            });
          }
        }
      }

      const durationMs = Date.now() - startTime;

      // Phase 0: Session verification logging - check session files after execution
      await this.logSessionFileDetails();

      // Extract solution from messages
      const solution = this.extractSolutionFromMessages(results);

      // Check for SDK errors
      const sdkError = this.checkForSDKErrors(results);
      if (sdkError) {
        logger.log('EXECUTE', 'SDK returned error', { error: sdkError });
      }

      // ADR-001: Extract session blob for persistence
      // Use transcript path from SDK if available, otherwise fall back to computed path
      let sessionBlob: string | undefined;
      const transcriptPath = (this as any)._transcriptPath;

      if (transcriptPath && this.sessionId) {
        // SDK provided the exact path - use it directly
        logger.log('SESSION', 'Using transcript path from SDK', { transcriptPath });
        sessionBlob = await this.extractSessionFromPath(transcriptPath);
      } else if (this.sessionId) {
        // Fall back to computed session directory
        const sessionDir = getClaudeSessionDir();
        logger.log('SESSION', 'Using computed session directory', { sessionDir });
        sessionBlob = await extractSessionToBlob(this.sessionId, sessionDir);
      }

      onProgress?.({
        type: 'completed',
        message: 'Claude Code execution completed',
        timestamp: new Date()
      });

      return {
        success: !sdkError,
        message: sdkError || solution,
        sessionId: this.sessionId,  // Include session ID for persistence (ADR-001)
        sessionBlob,                // Include session blob for persistence (ADR-001)
        costUsd: totalCostUsd,
        durationMs,
        metadata: {
          agent: 'claude-code',
          turnCount,
          messagesCount: results.length,
          solution  // Include full solution in metadata for executor to use
        }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const durationMs = Date.now() - startTime;

      logger.log('EXECUTE', 'Error during execution', {
        error: errorMessage,
        turnCount,
        resultsCount: results.length
      });

      onProgress?.({
        type: 'error',
        message: errorMessage,
        timestamp: new Date()
      });

      return {
        success: false,
        message: 'Claude Code execution failed',
        error: errorMessage,
        costUsd: totalCostUsd,
        durationMs,
        metadata: {
          agent: 'claude-code',
          turnCount,
          messagesCount: results.length
        }
      };
    } finally {
      this.isRunning = false;
    }
  }

  async abort(): Promise<void> {
    if (this.abortController && this.isRunning) {
      this.abortController.abort();
      logger.log('ABORT', 'Abort signal sent');
    }
    this.isRunning = false;
  }

  supportsStreaming(): boolean {
    // Claude Code provides progress at turn boundaries, not real-time streaming
    return false;
  }

  getCapabilities(): AgentCapabilities {
    return {
      supportsStreaming: false,
      supportsSessionManagement: true,  // ADR-001: Session resumption now supported
      supportsSkills: true,             // Skills loaded from user/project directories
      supportedProviders: ['anthropic'],
      maxContextLength: 200000
    };
  }

  /**
   * Extract a short human-readable context string from a tool invocation.
   */
  private extractToolContext(toolName: string, input: any): string {
    if (!input) return toolName;
    switch (toolName) {
      case 'Read':
        return input.file_path ? `Reading ${this.shortPath(input.file_path)}` : 'Reading file';
      case 'Write':
        return input.file_path ? `Writing ${this.shortPath(input.file_path)}` : 'Writing file';
      case 'Edit':
        return input.file_path ? `Editing ${this.shortPath(input.file_path)}` : 'Editing file';
      case 'Bash':
        if (input.command) {
          const cmd = input.command.split(/\s+/)[0]; // first word
          return input.description || `Running ${cmd}`;
        }
        return 'Running command';
      case 'Grep':
      case 'Search':
        return input.pattern ? `Searching for "${input.pattern.substring(0, 30)}"` : 'Searching';
      case 'Glob':
        return input.pattern ? `Finding files ${input.pattern.substring(0, 30)}` : 'Finding files';
      default:
        return toolName;
    }
  }

  private shortPath(filePath: string): string {
    const parts = filePath.split('/');
    return parts.length > 2 ? parts.slice(-2).join('/') : filePath;
  }

  async validate(context: AgentContext): Promise<ValidationResult> {
    const errors: string[] = [];

    if (!hasApiKeyForProvider('anthropic')) {
      errors.push('ANTHROPIC_API_KEY is required for Claude Code');
    }

    if (!context.prompt || context.prompt.trim() === '') {
      errors.push('Prompt is required');
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  async cleanup(): Promise<void> {
    this.abortController = null;
    this.isRunning = false;
  }

  // ============= Private Helper Methods =============

  /**
   * Phase 0: Log session file details for verification.
   * This helps verify the SDK session mechanism works before implementing full persistence.
   */
  private async logSessionFileDetails(): Promise<void> {
    const sessionDir = getClaudeSessionDir();
    logger.log('SESSION', 'Checking session directory', { sessionDir });

    try {
      const sessionFiles = await listSessionFiles(sessionDir);
      logger.log('SESSION', 'Found session files', {
        count: sessionFiles.length,
        files: sessionFiles.slice(0, 5), // Log first 5
      });

      if (this.sessionId) {
        const stats = await getSessionStats(this.sessionId, sessionDir);
        if (stats) {
          logger.log('SESSION', 'Session file stats', {
            sessionId: this.sessionId,
            sizeBytes: stats.sizeBytes,
            sizeMB: stats.sizeMB,
          });
        } else {
          logger.log('SESSION', 'Session file not found for captured ID', {
            sessionId: this.sessionId,
            sessionDir,
          });
        }
      }
    } catch (error) {
      logger.log('SESSION', 'Error checking session files', {
        error: error instanceof Error ? error.message : String(error),
        sessionDir,
      });
    }
  }

  /**
   * Extract human-readable solution from SDK messages
   */
  private extractSolutionFromMessages(messages: SDKMessage[]): string {
    // Look through messages in reverse to find the last assistant response with text
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i] as any;

      // Skip result messages (they're metadata, not content)
      if (message.type === 'result') {
        continue;
      }

      // Look for assistant messages with content
      if (message.type === 'assistant' && message.message?.content) {
        const textContent = message.message.content
          .filter((item: any) => item.type === 'text')
          .map((item: any) => item.text)
          .join('\n\n');

        if (textContent.trim()) {
          return textContent;
        }
      }
    }

    return 'I analyzed the issue and made changes to the codebase. Please review the pull request for details.';
  }

  /**
   * Check if SDK result indicates an error
   */
  private checkForSDKErrors(messages: SDKMessage[]): string | null {
    const lastMessage = messages[messages.length - 1] as any;

    if (lastMessage?.type === 'result') {
      if (lastMessage.subtype === 'error_during_execution' || lastMessage.is_error === true) {
        return lastMessage.error || 'An error occurred during execution';
      }
    }

    return null;
  }

  /**
   * Extract session blob directly from SDK-provided transcript path.
   * The SDK provides the exact path in the init message, which is more reliable
   * than computing the path ourselves (path encoding may differ).
   *
   * @param transcriptPath - The exact path provided by SDK in init message
   * @returns Base64-encoded gzipped session data, or undefined if extraction failed
   */
  private async extractSessionFromPath(transcriptPath: string): Promise<string | undefined> {
    const { promises: fs } = await import('fs');
    const { gzip } = await import('zlib');
    const { promisify } = await import('util');
    const gzipAsync = promisify(gzip);

    try {
      logger.log('SESSION', 'Reading session file from SDK path', { transcriptPath });

      const content = await fs.readFile(transcriptPath);
      const compressed = await gzipAsync(content);
      const blob = compressed.toString('base64');

      logger.log('SESSION', 'Session blob extracted from SDK path', {
        transcriptPath,
        uncompressedSize: content.length,
        compressedSize: compressed.length,
        compressionRatio: ((1 - compressed.length / content.length) * 100).toFixed(1) + '%',
        base64Length: blob.length,
      });

      return blob;
    } catch (error) {
      logger.log('SESSION', 'Failed to extract session from SDK path', {
        transcriptPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}
