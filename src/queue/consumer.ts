import { logWithContext } from "../core/log";
import { createSandboxClient, type ISandboxClient } from "../integrations/container";
import { handleSlackPRNotification, handleSlackClarificationNotification, handleSlackErrorNotification, handleSlackNoCodeChangesNotification, postSlackMessage } from "../handlers/slack/commands";
import { postConfirmationMessage } from "../handlers/slack/interactivity";
import { getDb, type DrizzleDb } from "../db/client";
import { AppConfigRepository, AgentSessionsRepository } from "../db/repositories";
import { RequestService } from "../services";
import type { Env } from "../core/types";
import { decrypt } from "../core/crypto";
import { getOrRefreshGitHubToken } from "../integrations/github/token";
import { AgentRouter, type AgentType, type AgentProvider } from "../agents";
import { getErrorMessage, getErrorDetails } from "../utils";
import { ClarityError } from "../core/errors";
import { decryptLLMKeys, buildLLMEnvVars } from "../utils/llm-config";
import { GitHubAPI } from "../integrations/github/client";
import type { IssueQueueMessage, SlackFeatureRequestMessage, SlackRetryRequestMessage, SlackAppMentionMessage, SlackClarificationAnswerMessage, SlackSuggestChangesMessage, QueueMessage } from "./types";
import { getRequestTypeEmoji, buildErrorCommentBody } from "./types";
import {
  parseClarityCommand,
  resolveRepository,
  extractTitle,
  getSlackUserInfo,
} from "../integrations/slack";
import { addSlackReaction } from "../handlers/slack/commands";
import { REACTION_PROCESSING } from "../integrations/slack/reactions";
import { detectLLMProviders, getDefaultAgentConfig } from "../utils";
import type { IQueueMessage, IQueueBatch, IQueueProducer } from "./abstractions";
import { getMessageRetryInfo, handleMessageRetryOrFail, createQueueProducer, createQueueBatch } from "./abstractions";

/**
 * Container response type from issue processing
 */
interface ContainerResponse {
  success: boolean;
  message: string;
  error?: string;
  prUrl?: string;
  prNumber?: number;
  prBranchName?: string;
  summary?: string;
  needsClarification?: boolean;
  clarifyingQuestions?: string;
  costUsd?: number;
  durationMs?: number;
  agentType?: AgentType;
  agentProvider?: AgentProvider;
  agentModel?: string;
  agentSessionId?: string;
  /** Gzipped base64 encoded session blob for persistence (ADR-001) */
  agentSessionBlob?: string;
  /** True when only doc/markdown files were changed (no actual code changes) */
  isDocOnlyChanges?: boolean;
}

/**
 * Queue consumer for processing Clarity AI messages.
 * Handles GitHub issue processing, Slack feature requests, and retry requests.
 *
 * This class is queue-agnostic - it works with abstract queue interfaces
 * that can be implemented by different providers (Cloudflare, SQS, etc.)
 */
export class QueueConsumer {
  private db: DrizzleDb;
  private configRepo: AppConfigRepository;
  private requestService: RequestService;
  private sessionsRepo: AgentSessionsRepository;
  private queueProducer: IQueueProducer<QueueMessage>;
  private sandboxClient: ISandboxClient;

  constructor(
    private env: Env,
    queueProducer?: IQueueProducer<QueueMessage>,
    sandboxClient?: ISandboxClient
  ) {
    this.db = getDb(env);
    this.configRepo = new AppConfigRepository(this.db);
    this.requestService = new RequestService(this.db, this.configRepo, env.ENCRYPTION_KEY);
    this.sessionsRepo = new AgentSessionsRepository(this.db);
    // Use provided producer or create from factory (configuration-driven)
    this.queueProducer = queueProducer ?? createQueueProducer({ cloudflareQueue: env.ISSUE_QUEUE });
    // Use provided sandbox client or create from factory (configuration-driven)
    this.sandboxClient = sandboxClient ?? createSandboxClient({ cloudflareNamespace: env.MY_CONTAINER });
  }

  /**
   * Process a batch of queue messages (queue-agnostic)
   */
  async processBatch(batch: IQueueBatch<QueueMessage>): Promise<void> {
    logWithContext("QUEUE_CONSUMER", "Processing queue batch", {
      messageCount: batch.messages.length,
      queue: batch.queue,
    });

    for (const message of batch.messages) {
      const data = message.body;

      if (data.type === "slack_app_mention") {
        await this.handleSlackAppMention(message as IQueueMessage<SlackAppMentionMessage>);
      } else if (data.type === "slack_feature_request") {
        await this.handleSlackFeatureRequest(message as IQueueMessage<SlackFeatureRequestMessage>);
      } else if (data.type === "slack_retry_request") {
        await this.handleSlackRetryRequest(message as IQueueMessage<SlackRetryRequestMessage>);
      } else if (data.type === "slack_clarification_answer") {
        await this.handleSlackClarificationAnswer(message as IQueueMessage<SlackClarificationAnswerMessage>);
      } else if (data.type === "slack_suggest_changes") {
        await this.handleSlackSuggestChanges(message as IQueueMessage<SlackSuggestChangesMessage>);
      } else {
        await this.handleIssueMessage(message as IQueueMessage<IssueQueueMessage>);
      }
    }

    logWithContext("QUEUE_CONSUMER", "Queue batch processing completed", {
      messageCount: batch.messages.length,
    });
  }

  /**
   * Handle GitHub issue processing messages
   */
  private async handleIssueMessage(message: IQueueMessage<IssueQueueMessage>): Promise<void> {
    const issueData = message.body;
    const { attemptNumber, isLastAttempt } = getMessageRetryInfo(message);

    logWithContext("QUEUE_CONSUMER", "Processing issue from queue", {
      requestId: issueData.requestId,
      issueNumber: issueData.issueNumber,
      repository: issueData.repositoryName,
      appId: issueData.appId,
      attempt: attemptNumber,
      isLastAttempt,
    });

    let installationToken: string | null = null;

    try {
      // Update status to processing
      await this.requestService.startProcessing(issueData.requestId, issueData.triggeredBy);
      logWithContext("QUEUE_CONSUMER", "Updated request status to processing");

      // Send Slack acknowledgment for follow-up requests (only on first attempt)
      if (issueData.isFollowUp && issueData.followUpRequest && attemptNumber === 1) {
        await this.sendFollowUpAcknowledgment(issueData);
      }

      // Get GitHub config and token
      const githubConfig = await this.configRepo.getGitHubConfig();
      if (!githubConfig) {
        throw new ClarityError({
          category: "CONFIG",
          operation: "load GitHub config",
          message: "GitHub config not found",
          suggestion: "Configure GitHub App at /gh-setup",
        });
      }

      if (!this.env.ENCRYPTION_KEY) {
        throw new ClarityError({
          category: "CONFIG",
          operation: "decrypt credentials",
          message: "ENCRYPTION_KEY not configured",
          suggestion: "Set ENCRYPTION_KEY in wrangler.jsonc vars or .dev.vars",
        });
      }

      installationToken = await getOrRefreshGitHubToken(this.configRepo, githubConfig, this.env.ENCRYPTION_KEY);
      logWithContext("QUEUE_CONSUMER", "Got GitHub installation token");

      // Get LLM config and prepare container context
      const llmConfig = await this.configRepo.getLLMConfig();
      const llmKeys = await decryptLLMKeys(llmConfig, this.env.ENCRYPTION_KEY);

      const agentConfig = AgentRouter.route({
        labels: issueData.issueLabels,
        agentType: issueData.agentType,
        agentProvider: issueData.agentProvider,
        agentModel: issueData.agentModel,
      });

      logWithContext("QUEUE_CONSUMER", "Agent config determined", {
        agentType: agentConfig.type,
        agentProvider: agentConfig.provider,
        agentModel: agentConfig.model,
        fromLabel: AgentRouter.getClarityLabel(issueData.issueLabels || []),
      });

      // Resolve Slack user ID to display name for follow-up author if needed
      let resolvedFollowUpAuthor = issueData.followUpAuthor;
      if (resolvedFollowUpAuthor?.match(/^U[A-Z0-9]+$/)) {
        const slackConfig = await this.configRepo.getSlackConfig();
        if (slackConfig?.botTokenEncrypted) {
          const botToken = await decrypt(slackConfig.botTokenEncrypted, this.env.ENCRYPTION_KEY!);
          const userInfo = await getSlackUserInfo(resolvedFollowUpAuthor, botToken);
          resolvedFollowUpAuthor = userInfo.displayName;
        }
      }

      // Build container context (includes session for follow-ups - ADR-001)
      const issueContext = await this.buildIssueContext(issueData, installationToken, llmKeys, agentConfig, resolvedFollowUpAuthor);

      // Add conversation history
      await this.addConversationHistory(issueData.requestId, issueContext);

      // Process in container
      const containerResponse = await this.processInContainer(issueData, issueContext);

      // Handle response
      await this.handleContainerResponse(message, issueData, containerResponse);

    } catch (error) {
      await this.handleIssueError(message, issueData, error, installationToken, attemptNumber, isLastAttempt);
    }
  }

  /**
   * Send Slack acknowledgment for follow-up requests
   */
  private async sendFollowUpAcknowledgment(issueData: IssueQueueMessage): Promise<void> {
    try {
      const slackConfig = await this.configRepo.getSlackConfig();
      const request = await this.requestService.requests.findByRequestId(issueData.requestId);

      if (slackConfig?.botTokenEncrypted && request?.slackChannelId) {
        const botToken = await decrypt(slackConfig.botTokenEncrypted, this.env.ENCRYPTION_KEY!);

        // Resolve Slack user ID to display name if needed
        let authorName = issueData.followUpAuthor || 'user';
        if (authorName.match(/^U[A-Z0-9]+$/)) {
          // Looks like a Slack user ID - resolve to display name
          const userInfo = await getSlackUserInfo(authorName, botToken);
          authorName = userInfo.displayName;
        }

        const truncatedMessage = issueData.followUpRequest!.length > 200
          ? issueData.followUpRequest!.substring(0, 200) + "..."
          : issueData.followUpRequest!;

        const acknowledgmentText = issueData.existingPrNumber
          ? `:pencil2: *Change request from ${authorName}:*\n>${truncatedMessage}\n\n_Clarity AI is now working on these changes..._`
          : `:white_check_mark: *Clarification received from ${authorName}:*\n>${truncatedMessage}\n\n_Clarity AI is now continuing with the implementation..._`;

        await postSlackMessage(
          botToken,
          request.slackChannelId,
          acknowledgmentText,
          request.slackThreadTs || undefined
        );

        logWithContext("QUEUE_CONSUMER", "Slack follow-up acknowledgment sent", {
          requestId: issueData.requestId,
          hasExistingPR: !!issueData.existingPrNumber,
          channelId: request.slackChannelId,
        });
      }
    } catch (slackError) {
      logWithContext("QUEUE_CONSUMER", "Failed to send Slack follow-up acknowledgment", {
        error: slackError instanceof Error ? slackError.message : String(slackError),
        requestId: issueData.requestId,
      });
    }
  }

  /**
   * Build container context from issue data
   */
  private async buildIssueContext(
    issueData: IssueQueueMessage,
    installationToken: string,
    llmKeys: Awaited<ReturnType<typeof decryptLLMKeys>>,
    agentConfig: ReturnType<typeof AgentRouter.route>,
    resolvedFollowUpAuthor?: string
  ): Promise<Record<string, string>> {
    const issueContext: Record<string, string> = {
      ...buildLLMEnvVars(llmKeys),
      GITHUB_TOKEN: installationToken,
      ISSUE_ID: issueData.issueId.toString(),
      ISSUE_NUMBER: issueData.issueNumber.toString(),
      ISSUE_TITLE: issueData.issueTitle,
      ISSUE_BODY: issueData.issueBody,
      ISSUE_LABELS: JSON.stringify(issueData.issueLabels),
      REPOSITORY_URL: issueData.repositoryUrl,
      REPOSITORY_NAME: issueData.repositoryName,
      ISSUE_AUTHOR: issueData.issueAuthor,
      MESSAGE: `Processing issue #${issueData.issueNumber}: ${issueData.issueTitle}`,
      AGENT_TYPE: agentConfig.type,
      AGENT_PROVIDER: agentConfig.provider || '',
      AGENT_MODEL: agentConfig.model || '',
    };

    if (issueData.followUpRequest) {
      issueContext.FOLLOW_UP_REQUEST = issueData.followUpRequest;
      issueContext.FOLLOW_UP_AUTHOR = resolvedFollowUpAuthor || issueData.followUpAuthor || "unknown";
    }

    if (issueData.existingPrNumber) {
      issueContext.EXISTING_PR_NUMBER = issueData.existingPrNumber.toString();
      issueContext.EXISTING_PR_URL = issueData.existingPrUrl || "";
      issueContext.MESSAGE = `Changes for PR #${issueData.existingPrNumber}: ${(issueData.followUpRequest || '').substring(0, 100)}`;

      logWithContext("QUEUE_CONSUMER", "Processing PR changes request", {
        requestId: issueData.requestId,
        prNumber: issueData.existingPrNumber,
        hasUserMessage: !!issueData.followUpRequest,
      });
    } else if (issueData.followUpRequest) {
      issueContext.MESSAGE = `Processing issue #${issueData.issueNumber} with user clarification`;

      logWithContext("QUEUE_CONSUMER", "Processing with user clarification", {
        requestId: issueData.requestId,
        messageLength: issueData.followUpRequest.length,
      });
    }

    // Pass Slack file attachments for container to download
    if (issueData.attachments?.length) {
      issueContext.SLACK_ATTACHMENTS = JSON.stringify(issueData.attachments);
    }
    if (issueData.slackBotToken) {
      issueContext.SLACK_BOT_TOKEN = issueData.slackBotToken;
    }

    // Pass Slack routing info for container progress streaming
    const request = await this.requestService.requests.findByRequestId(issueData.requestId);
    if (request?.slackChannelId) {
      issueContext.SLACK_CHANNEL_ID = request.slackChannelId;
      if (request.slackThreadTs) {
        issueContext.SLACK_THREAD_TS = request.slackThreadTs;
      }
      // Ensure bot token is available for progress streaming (not just attachments)
      if (!issueContext.SLACK_BOT_TOKEN) {
        try {
          const slackConfig = await this.configRepo.getSlackConfig();
          if (slackConfig?.botTokenEncrypted && this.env.ENCRYPTION_KEY) {
            issueContext.SLACK_BOT_TOKEN = await decrypt(slackConfig.botTokenEncrypted, this.env.ENCRYPTION_KEY);
          }
        } catch (error) {
          logWithContext("QUEUE_CONSUMER", "Failed to decrypt bot token for progress streaming", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // ADR-001: For follow-ups, pass session ID + download URL instead of blob in POST body
    // Container will fetch the blob separately to avoid HTTP body size issues
    if (issueData.isFollowUp) {
      const latestSession = await this.sessionsRepo.getForRequest(issueData.requestId);
      if (latestSession?.sessionId) {
        issueContext.AGENT_SESSION_ID = latestSession.sessionId;

        // Generate signed URL for container to fetch session blob
        const { generateSignedToken } = await import('../utils/signed-url');
        const secret = this.env.JWT_SECRET || this.env.ENCRYPTION_KEY || '';
        const { token } = await generateSignedToken(issueData.requestId, secret);
        const baseUrl = this.env.CLARITY_ENDPOINT;
        if (!baseUrl) {
          throw new ClarityError({
            category: "CONFIG",
            operation: "build session download URL",
            message: "CLARITY_ENDPOINT not configured",
            suggestion: "Set CLARITY_ENDPOINT in wrangler.jsonc vars or .dev.vars",
          });
        }
        issueContext.SESSION_DOWNLOAD_URL = `${baseUrl}/api/requests/${issueData.requestId}/handover?token=${token}&format=session`;

        logWithContext("QUEUE_CONSUMER", "Session download URL attached for follow-up", {
          requestId: issueData.requestId,
          sessionId: latestSession.sessionId,
          blobSizeBytes: latestSession.blobSizeBytes,
        });
      } else {
        logWithContext("QUEUE_CONSUMER", "No session found for follow-up request", {
          requestId: issueData.requestId,
        });
      }
    }

    return issueContext;
  }

  /**
   * Add conversation history to context (fallback when no session blob)
   *
   * ADR-001: With session blob persistence, the SDK session contains full context.
   * This is only used as fallback when session blob is not available.
   */
  private async addConversationHistory(requestId: string, issueContext: Record<string, string>): Promise<void> {
    // Skip if session blob is attached - SDK session already has full context
    if (issueContext.AGENT_SESSION_BLOB) {
      logWithContext("QUEUE_CONSUMER", "Skipping conversation history - session blob attached", {
        requestId,
      });
      return;
    }

    const conversationMessages = await this.requestService.messages.getAgentConversationContext(requestId, 10);

    if (conversationMessages.length > 0) {
      // Resolve any unresolved Slack user IDs in actorName
      const unresolvedIds = new Set<string>();
      for (const msg of conversationMessages) {
        if (msg.actorName?.match(/^U[A-Z0-9]+$/)) {
          unresolvedIds.add(msg.actorName);
        }
      }

      const resolvedNames = new Map<string, string>();
      if (unresolvedIds.size > 0) {
        const slackConfig = await this.configRepo.getSlackConfig();
        if (slackConfig?.botTokenEncrypted) {
          const botToken = await decrypt(slackConfig.botTokenEncrypted, this.env.ENCRYPTION_KEY!);
          await Promise.all(
            Array.from(unresolvedIds).map(async (userId) => {
              const userInfo = await getSlackUserInfo(userId, botToken);
              if (userInfo.displayName !== userId) {
                resolvedNames.set(userId, userInfo.displayName);
              }
            })
          );
        }
      }

      const formattedHistory = conversationMessages.map(msg => {
        let actorName = msg.actorName || 'User';
        if (resolvedNames.has(actorName)) {
          actorName = resolvedNames.get(actorName)!;
        }
        const role = msg.type === 'clarification_ask' ? 'Clarity AI' :
                     msg.type === 'clarification_answer' ? actorName :
                     msg.type === 'follow_up_request' ? actorName : 'System';
        return `**${role}:** ${msg.content}`;
      }).join('\n\n');

      issueContext.CONVERSATION_HISTORY = formattedHistory;

      logWithContext("QUEUE_CONSUMER", "Conversation history included (fallback - no session blob)", {
        requestId,
        messageCount: conversationMessages.length,
      });
    }
  }

  /**
   * Process issue in sandbox (provider-agnostic)
   */
  private async processInContainer(
    issueData: IssueQueueMessage,
    issueContext: Record<string, string>
  ): Promise<ContainerResponse> {
    const sandboxName = `claude-issue-${issueData.issueId}`;
    const sandbox = this.sandboxClient.getSandbox(sandboxName);

    logWithContext("QUEUE_CONSUMER", "Calling sandbox", {
      sandboxName,
      issueNumber: issueData.issueNumber,
    });

    const response = await sandbox.fetch(
      new Request("http://internal/process-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(issueContext),
      }),
      { sandboxName, route: "/process-issue" }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unable to read error");
      throw new ClarityError({
        category: "CONTAINER",
        operation: "call container sandbox",
        message: `Sandbox error: ${response.status} - ${errorText}`,
        suggestion: "Container may have crashed or timed out — retry the request",
      });
    }

    const containerResponse = await response.json() as ContainerResponse;

    logWithContext("QUEUE_CONSUMER", "Sandbox response received", {
      success: containerResponse.success,
      message: containerResponse.message,
      error: containerResponse.error,
    });

    return containerResponse;
  }

  /**
   * Handle container response (success, clarification, or PR)
   */
  private async handleContainerResponse(
    message: IQueueMessage<IssueQueueMessage>,
    issueData: IssueQueueMessage,
    containerResponse: ContainerResponse
  ): Promise<void> {
    // ADR-001: Save session blob on EVERY container execution, regardless of outcome
    // This ensures we capture the session even if the task fails or needs clarification
    if (containerResponse.agentSessionId && containerResponse.agentSessionBlob) {
      try {
        await this.sessionsRepo.save({
          requestId: issueData.requestId,
          sessionId: containerResponse.agentSessionId,
          agentType: containerResponse.agentType || 'claude-code',
          sessionBlob: containerResponse.agentSessionBlob,
          blobSizeBytes: containerResponse.agentSessionBlob.length,
        });

        logWithContext("QUEUE_CONSUMER", "Session blob saved", {
          requestId: issueData.requestId,
          sessionId: containerResponse.agentSessionId,
          blobSizeBytes: containerResponse.agentSessionBlob.length,
          outcome: containerResponse.success ? (containerResponse.needsClarification ? 'clarification' : 'success') : 'error',
        });
      } catch (sessionError) {
        // Log but don't fail - session persistence is non-critical
        logWithContext("QUEUE_CONSUMER", "Failed to save session blob", {
          error: sessionError instanceof Error ? sessionError.message : String(sessionError),
          requestId: issueData.requestId,
        });
      }
    }

    if (!containerResponse.success) {
      throw new ClarityError({
        category: "AGENT",
        operation: "process issue in container",
        message: containerResponse.error || "Container processing failed",
        suggestion: "Check container logs or retry the request",
      });
    }

    if (containerResponse.needsClarification) {
      await this.handleClarificationNeeded(message, issueData, containerResponse);
    } else {
      await this.handleSuccessfulCompletion(message, issueData, containerResponse);
    }
  }

  /**
   * Handle clarification needed response
   */
  private async handleClarificationNeeded(
    message: IQueueMessage<IssueQueueMessage>,
    issueData: IssueQueueMessage,
    containerResponse: ContainerResponse
  ): Promise<void> {
    logWithContext("QUEUE_CONSUMER", "Clarification needed - awaiting user response", {
      message: containerResponse.message,
      hasQuestions: !!containerResponse.clarifyingQuestions,
    });

    // Note: Session blob is already saved in handleContainerResponse (ADR-001)

    await this.requestService.requestClarification(
      issueData.requestId,
      containerResponse.clarifyingQuestions || ""
    );

    try {
      await handleSlackClarificationNotification(
        this.env,
        issueData.issueNumber,
        issueData.repositoryName,
        containerResponse.clarifyingQuestions || "",
        issueData.requestId
      );
      logWithContext("QUEUE_CONSUMER", "Slack clarification notification sent", {
        requestId: issueData.requestId,
        issueNumber: issueData.issueNumber,
      });
    } catch (slackError) {
      logWithContext("QUEUE_CONSUMER", "Failed to send Slack clarification notification", {
        error: slackError instanceof Error ? slackError.message : String(slackError),
        requestId: issueData.requestId,
      });
    }

    message.ack();
    logWithContext("QUEUE_CONSUMER", "Message acknowledged (awaiting clarification)", {
      requestId: issueData.requestId,
    });
  }

  /**
   * Handle successful completion (PR created or processed)
   */
  private async handleSuccessfulCompletion(
    message: IQueueMessage<IssueQueueMessage>,
    issueData: IssueQueueMessage,
    containerResponse: ContainerResponse
  ): Promise<void> {
    // Use container response PR info, or fall back to existing PR info for follow-ups
    const prUrl = containerResponse.prUrl || issueData.existingPrUrl;
    const prNumber = containerResponse.prNumber || issueData.existingPrNumber;

    logWithContext("QUEUE_CONSUMER", "Container task completed successfully", {
      message: containerResponse.message,
      prUrl,
      prNumber,
      isFollowUp: issueData.isFollowUp,
      isDocOnlyChanges: containerResponse.isDocOnlyChanges,
      usedExistingPrInfo: !containerResponse.prUrl && !!issueData.existingPrUrl,
    });

    // Note: Session blob is already saved in handleContainerResponse (ADR-001)

    // Parse AI-generated title from summary — only set if user didn't provide one
    const aiTitle = containerResponse.summary?.match(/##\s*Title\s*\n+([^\n#]+)/i)?.[1]?.trim();
    if (aiTitle) {
      const existing = await this.requestService.requests.findByRequestId(issueData.requestId);
      if (!existing?.title) {
        await this.requestService.requests.updateTitle(issueData.requestId, aiTitle);
      }
    }

    if (prUrl && prNumber) {
      await this.requestService.completeWithPR(
        issueData.requestId,
        prUrl,
        prNumber,
        containerResponse.prBranchName || "",
        containerResponse.durationMs || 0,
        containerResponse.costUsd || 0,
        containerResponse.summary || containerResponse.message,
        containerResponse.agentSessionId  // Store session ID for persistence (ADR-001)
      );

      try {
        await handleSlackPRNotification(
          this.env,
          prUrl,
          prNumber,
          issueData.requestId,
          containerResponse.costUsd,
          containerResponse.durationMs,
          issueData.isFollowUp,
          containerResponse.summary
        );
        logWithContext("QUEUE_CONSUMER", "Slack PR notification sent", {
          requestId: issueData.requestId,
          prNumber,
          isFollowUp: issueData.isFollowUp,
        });
      } catch (slackError) {
        logWithContext("QUEUE_CONSUMER", "Failed to send Slack notification", {
          error: slackError instanceof Error ? slackError.message : String(slackError),
          requestId: issueData.requestId,
        });
      }
    } else {
      // No PR created - either doc-only changes or no changes at all
      await this.requestService.requests.markProcessed(
        issueData.requestId,
        containerResponse.durationMs || 0,
        containerResponse.costUsd || 0,
        containerResponse.agentSessionId  // Store session ID for persistence (ADR-001)
      );

      if (containerResponse.summary || containerResponse.message) {
        await this.requestService.logAgentSummary(
          issueData.requestId,
          containerResponse.summary || containerResponse.message,
          containerResponse.durationMs || 0,
          Math.round((containerResponse.costUsd || 0) * 100)
        );
      }

      // Send Slack notification for no-code-changes case
      try {
        await handleSlackNoCodeChangesNotification(
          this.env,
          issueData.requestId,
          containerResponse.summary || containerResponse.message,
          issueData.issueNumber,
          containerResponse.costUsd,
          containerResponse.durationMs
        );
        logWithContext("QUEUE_CONSUMER", "Slack no-code-changes notification sent", {
          requestId: issueData.requestId,
          isDocOnlyChanges: containerResponse.isDocOnlyChanges,
        });
      } catch (slackError) {
        logWithContext("QUEUE_CONSUMER", "Failed to send Slack no-code-changes notification", {
          error: slackError instanceof Error ? slackError.message : String(slackError),
          requestId: issueData.requestId,
        });
      }
    }

    message.ack();
    logWithContext("QUEUE_CONSUMER", "Message acknowledged", {
      requestId: issueData.requestId,
    });
  }

  /**
   * Handle issue processing error
   */
  private async handleIssueError(
    message: IQueueMessage<IssueQueueMessage>,
    issueData: IssueQueueMessage,
    error: unknown,
    installationToken: string | null,
    attemptNumber: number,
    isLastAttempt: boolean
  ): Promise<void> {
    const errorDetails = getErrorDetails(error);

    logWithContext("QUEUE_CONSUMER", "Failed to process issue", {
      requestId: issueData.requestId,
      issueNumber: issueData.issueNumber,
      error: errorDetails.message,
      category: errorDetails.category,
      suggestion: errorDetails.suggestion,
      stack: errorDetails.stack,
      attempt: attemptNumber,
      isLastAttempt,
    });

    if (isLastAttempt) {
      try {
        await this.requestService.markError(
          issueData.requestId,
          errorDetails.code || "PROCESSING_ERROR",
          errorDetails.message,
          errorDetails.stack,
          attemptNumber
        );
      } catch (updateError) {
        logWithContext("QUEUE_CONSUMER", "Failed to update error status", {
          updateError: updateError instanceof Error ? updateError.message : String(updateError),
        });
      }

      try {
        await handleSlackErrorNotification(
          this.env,
          issueData.requestId,
          errorDetails.message,
          issueData.issueNumber
        );
        logWithContext("QUEUE_CONSUMER", "Slack error notification sent", {
          requestId: issueData.requestId,
        });
      } catch (slackError) {
        logWithContext("QUEUE_CONSUMER", "Failed to send Slack error notification", {
          error: slackError instanceof Error ? slackError.message : String(slackError),
        });
      }

      if (installationToken) {
        try {
          const githubApi = new GitHubAPI(installationToken);
          await githubApi.createComment(
            issueData.repositoryOwner,
            issueData.repositoryNameOnly,
            issueData.issueNumber,
            buildErrorCommentBody(errorDetails.message, attemptNumber, errorDetails.suggestion)
          );
          logWithContext("QUEUE_CONSUMER", "GitHub error comment posted", {
            requestId: issueData.requestId,
            issueNumber: issueData.issueNumber,
          });
        } catch (ghError) {
          logWithContext("QUEUE_CONSUMER", "Failed to post GitHub error comment", {
            error: ghError instanceof Error ? ghError.message : String(ghError),
          });
        }
      }
    } else {
      try {
        await this.requestService.messages.addRetry(
          issueData.requestId,
          attemptNumber,
          { id: 'system', name: 'Queue Consumer' },
          'system',
          errorDetails.message
        );
      } catch {
        /* ignore */
      }
    }

    handleMessageRetryOrFail(message, isLastAttempt, () => {
      logWithContext("QUEUE_CONSUMER", "Final failure for issue processing", {
        requestId: issueData.requestId,
      });
    });
  }

  /**
   * Handle Slack feature request messages
   * Creates GitHub issue, stores tracking data, and posts confirmation to Slack
   */
  private async handleSlackFeatureRequest(message: IQueueMessage<SlackFeatureRequestMessage>): Promise<void> {
    const data = message.body;
    const { attemptNumber, isLastAttempt } = getMessageRetryInfo(message);

    logWithContext("QUEUE_CONSUMER", "Processing Slack feature request", {
      requestId: data.requestId,
      repo: data.repo,
      channelId: data.channelId,
      agentType: data.agentType,
      agentProvider: data.agentProvider,
      attempt: attemptNumber,
      isLastAttempt,
    });

    try {
      const githubConfig = await this.configRepo.getGitHubConfig();
      if (!githubConfig) {
        throw new ClarityError({
          category: "CONFIG",
          operation: "load GitHub config",
          message: "GitHub config not found",
          suggestion: "Configure GitHub App at /gh-setup",
        });
      }

      const githubOrg = githubConfig.ownerLogin;
      const appId = githubConfig.appId;

      if (!this.env.ENCRYPTION_KEY) {
        throw new ClarityError({
          category: "CONFIG",
          operation: "decrypt credentials",
          message: "ENCRYPTION_KEY not configured",
          suggestion: "Set ENCRYPTION_KEY in wrangler.jsonc vars or .dev.vars",
        });
      }

      const githubToken = await getOrRefreshGitHubToken(this.configRepo, githubConfig, this.env.ENCRYPTION_KEY);

      if (!githubOrg) {
        throw new ClarityError({
          category: "GITHUB",
          operation: "resolve GitHub organization",
          message: "Missing GitHub organization",
          suggestion: "Re-install the GitHub App to set the organization",
        });
      }

      const typeEmoji = getRequestTypeEmoji(data.requestType);

      const githubApi = new GitHubAPI(githubToken);

      // Check if issue already exists (idempotency for retries)
      // Search for existing issue by requestId in body
      let issue: { number: number; id: number; html_url: string };
      const existingRequest = await this.requestService.requests.findByRequestId(data.requestId);

      if (existingRequest?.issueNumber && existingRequest?.issueId && existingRequest?.issueUrl) {
        // Issue already exists from previous attempt
        issue = {
          number: existingRequest.issueNumber,
          id: existingRequest.issueId,
          html_url: existingRequest.issueUrl,
        };
        logWithContext("QUEUE_CONSUMER", "Using existing GitHub issue from previous attempt", {
          requestId: data.requestId,
          issueNumber: issue.number,
          attemptNumber,
        });
      } else {
        // Create new issue
        issue = await githubApi.createIssue(
          githubOrg,
          data.repo,
          `${typeEmoji} ${data.title}`,
          `## Feature Request from Slack\n\n**Requested by:** @${data.slackUserName}\n**Type:** ${data.requestType}\n**Tracking ID:** \`${data.requestId}\`\n\n## Description\n\n${data.description}\n\n---\n*Created via Slack interactive form*`,
          ["clarity-ai", data.requestType, "slack"]
        );

        logWithContext("QUEUE_CONSUMER", "GitHub issue created from Slack", {
          requestId: data.requestId,
          issueNumber: issue.number,
          issueUrl: issue.html_url,
        });
      }

      const isFromMention = !!data.triggerMessageTs;
      const slackThreadTs = isFromMention
        ? (data.triggerThreadTs || data.triggerMessageTs)
        : undefined;

      logWithContext("QUEUE_CONSUMER", "Slack feature request thread info", {
        requestId: data.requestId,
        isFromMention,
        triggerMessageTs: data.triggerMessageTs,
        triggerThreadTs: data.triggerThreadTs,
        slackThreadTs,
        channelId: data.channelId,
      });

      await this.requestService.createRequest(
        {
          requestId: data.requestId,
          origin: 'slack',
          repo: `${githubOrg}/${data.repo}`,
          title: data.title,
          description: data.description,
          slackUserId: data.slackUserId,
          slackUserName: data.slackUserName,
          slackChannelId: data.channelId,
          slackThreadTs,
          slackTriggerMessageTs: data.triggerMessageTs,
          status: 'issue_created',
          issueUrl: issue.html_url,
          issueNumber: issue.number,
          issueId: issue.id,
          issueTitle: `${typeEmoji} ${data.title}`,
          issueBody: data.description,
          issueLabels: ["clarity-ai", data.requestType, "slack"],
          issueAuthor: data.slackUserName,
          repositoryUrl: `https://github.com/${githubOrg}/${data.repo}.git`,
          repositoryName: `${githubOrg}/${data.repo}`,
          repositoryOwner: githubOrg,
          repositoryNameOnly: data.repo,
          appId: appId || "",
          agentType: data.agentType || 'claude-code',
          agentProvider: data.agentProvider || 'anthropic',
        },
        { id: data.slackUserId, name: data.slackUserName },
        'slack'
      );

      // Only post confirmation message on first attempt to avoid duplicates on retry
      if (data.channelId && data.botToken && attemptNumber === 1) {
        const replyToTs = isFromMention
          ? (data.triggerThreadTs || data.triggerMessageTs)
          : undefined;

        const confirmResult = await postConfirmationMessage(
          data.channelId,
          data.botToken,
          data.requestId,
          issue.number,
          issue.html_url,
          data.title,
          data.description,
          data.repo,
          data.slackUserName,
          replyToTs,
          isFromMention // Skip title display for @clarity mentions (title is auto-generated)
        );

        logWithContext("QUEUE_CONSUMER", "Slack confirmation message result", {
          ok: confirmResult.ok,
          ts: confirmResult.ts,
          channelId: data.channelId,
          isFromMention,
          replyToTs,
        });

        if (confirmResult.ok && confirmResult.ts) {
          const threadTsToStore = isFromMention
            ? (data.triggerThreadTs || data.triggerMessageTs)
            : confirmResult.ts;

          if (threadTsToStore) {
            await this.requestService.updateSlackThreadTs(data.requestId, threadTsToStore);
          }
        }
      }

      // Queue the actual processing using abstract producer
      await this.queueProducer.send({
        requestId: data.requestId,
        repo: `${githubOrg}/${data.repo}`,
        description: data.description,
        issueId: issue.id,
        issueNumber: issue.number,
        issueTitle: `${typeEmoji} ${data.title}`,
        issueBody: data.description,
        issueLabels: ["clarity-ai", data.requestType, "slack"],
        issueAuthor: data.slackUserName,
        repositoryUrl: `https://github.com/${githubOrg}/${data.repo}.git`,
        repositoryName: `${githubOrg}/${data.repo}`,
        repositoryId: 0,
        repositoryOwner: githubOrg,
        repositoryNameOnly: data.repo,
        appId: appId || "",
        triggeredBy: 'slack' as const,
        attachments: data.attachments,
        slackBotToken: data.botToken,
      });

      logWithContext("QUEUE_CONSUMER", "Slack feature request processed, container work queued", {
        requestId: data.requestId,
        issueNumber: issue.number,
      });

      message.ack();
    } catch (error) {
      logWithContext("QUEUE_CONSUMER", "Failed to process Slack feature request", {
        requestId: data.requestId,
        error: getErrorMessage(error),
        stack: error instanceof Error ? error.stack : undefined,
        attempt: attemptNumber,
        isLastAttempt,
      });

      const errorMsg = getErrorMessage(error);

      if (isLastAttempt) {
        try {
          await this.requestService.markError(
            data.requestId,
            "SLACK_REQUEST_ERROR",
            errorMsg,
            undefined,
            attemptNumber
          );
        } catch {
          /* ignore */
        }
      } else {
        try {
          await this.requestService.messages.addRetry(
            data.requestId,
            attemptNumber,
            { id: 'system', name: 'Queue Consumer' },
            'system',
            errorMsg
          );
        } catch {
          /* ignore */
        }
      }

      handleMessageRetryOrFail(message, isLastAttempt, () => {
        logWithContext("QUEUE_CONSUMER", "Final failure for Slack feature request", {
          requestId: data.requestId,
        });
      });
    }
  }

  /**
   * Handle Slack retry request messages
   * Re-queues the request for processing and sends a Slack notification
   */
  private async handleSlackRetryRequest(message: IQueueMessage<SlackRetryRequestMessage>): Promise<void> {
    const data = message.body;

    logWithContext("QUEUE_CONSUMER", "Processing Slack retry request", {
      requestId: data.requestId,
      issueNumber: data.issueNumber,
      userId: data.userId,
    });

    try {
      const request = await this.requestService.requests.findByRequestId(data.requestId);

      if (!request) {
        logWithContext("QUEUE_CONSUMER", "No request found for retry", { requestId: data.requestId });
        message.ack();
        return;
      }

      await this.requestService.handleRetry(
        data.requestId,
        { id: data.userId, name: data.userName },
        "slack"
      );

      // Re-queue using abstract producer
      await this.queueProducer.send({
        requestId: data.requestId,
        repo: request.repositoryName || request.repo,
        description: request.issueBody || request.description || "",
        issueId: request.issueId ?? 0,
        issueNumber: request.issueNumber || data.issueNumber,
        issueTitle: request.issueTitle ?? "",
        issueBody: request.issueBody || request.description || "",
        issueLabels: request.issueLabels || [],
        issueAuthor: request.issueAuthor ?? "",
        repositoryUrl: request.repositoryUrl ?? "",
        repositoryName: request.repositoryName || request.repo,
        repositoryId: request.repositoryId ?? 0,
        repositoryOwner: request.repositoryOwner ?? "",
        repositoryNameOnly: request.repositoryNameOnly ?? "",
        appId: request.appId ?? "",
        isRetry: true,
        triggeredBy: 'slack' as const,
      });

      logWithContext("QUEUE_CONSUMER", "Request re-queued for retry", {
        requestId: data.requestId,
        issueNumber: data.issueNumber,
      });

      const channelId = data.channelId || request.slackChannelId;
      const threadTs = data.threadTs || request.slackThreadTs;

      if (channelId && data.botToken) {
        await postSlackMessage(
          data.botToken,
          channelId,
          `*Retrying...* Processing has been restarted for this request.`,
          threadTs ?? undefined
        );
      }

      message.ack();
    } catch (error) {
      logWithContext("QUEUE_CONSUMER", "Failed to process Slack retry request", {
        requestId: data.requestId,
        error: getErrorMessage(error),
      });

      message.retry();
    }
  }

  /**
   * Handle Slack clarification answer messages.
   * Moved from interactivity handler to avoid Slack's 3-second timeout.
   * Performs DB lookup, logs the answer, and re-queues for processing.
   */
  private async handleSlackClarificationAnswer(message: IQueueMessage<SlackClarificationAnswerMessage>): Promise<void> {
    const data = message.body;

    logWithContext("QUEUE_CONSUMER", "Processing Slack clarification answer", {
      requestId: data.requestId,
      issueNumber: data.issueNumber,
    });

    try {
      const request = await this.requestService.requests.findByRequestId(data.requestId);

      if (!request) {
        logWithContext("QUEUE_CONSUMER", "No request found for clarification answer", { requestId: data.requestId });
        message.ack();
        return;
      }

      // Resolve Slack user ID to display name
      let resolvedUserName = data.slackUserId;
      if (data.slackUserId?.match(/^U[A-Z0-9]+$/)) {
        const slackConfig = await this.configRepo.getSlackConfig();
        if (slackConfig?.botTokenEncrypted) {
          const botToken = await decrypt(slackConfig.botTokenEncrypted, this.env.ENCRYPTION_KEY!);
          const userInfo = await getSlackUserInfo(data.slackUserId, botToken);
          resolvedUserName = userInfo.displayName;
        }
      }

      // Log clarification answer and update status
      await this.requestService.handleClarificationAnswer(
        data.requestId,
        data.answers,
        { id: data.slackUserId, name: resolvedUserName },
        "slack",
        { modal: true, issueNumber: data.issueNumber }
      );

      // Process directly as an issue message instead of re-queuing
      const issueMessage: IQueueMessage<IssueQueueMessage> = {
        body: {
          requestId: data.requestId,
          repo: request.repositoryName || request.repo || "",
          description: request.issueBody || request.description || "",
          issueId: request.issueId ?? 0,
          issueNumber: request.issueNumber || data.issueNumber,
          issueTitle: request.issueTitle ?? "",
          issueBody: request.issueBody || request.description || "",
          issueLabels: request.issueLabels || [],
          issueAuthor: request.issueAuthor ?? "",
          repositoryUrl: request.repositoryUrl ?? "",
          repositoryName: request.repositoryName || request.repo || "",
          repositoryId: request.repositoryId ?? 0,
          repositoryOwner: request.repositoryOwner ?? "",
          repositoryNameOnly: request.repositoryNameOnly ?? "",
          appId: request.appId ?? "",
          isFollowUp: true,
          followUpRequest: data.answers,
          followUpAuthor: data.slackUserId,
          existingPrNumber: request.prNumber ?? undefined,
          existingPrUrl: request.prUrl ?? undefined,
          triggeredBy: 'slack' as const,
        },
        attempts: message.attempts,
        ack: () => message.ack(),
        retry: () => message.retry(),
      };

      logWithContext("QUEUE_CONSUMER", "Clarification answer processed, dispatching to issue handler", {
        requestId: data.requestId,
        issueNumber: data.issueNumber,
      });

      await this.handleIssueMessage(issueMessage);
    } catch (error) {
      logWithContext("QUEUE_CONSUMER", "Failed to process clarification answer", {
        requestId: data.requestId,
        error: getErrorMessage(error),
      });

      message.retry();
    }
  }

  /**
   * Handle Slack suggest changes modal submission
   * Moved from interactivity handler to avoid Slack's 3-second timeout.
   * Performs DB lookup, logs the follow-up, and dispatches to issue handler.
   */
  private async handleSlackSuggestChanges(message: IQueueMessage<SlackSuggestChangesMessage>): Promise<void> {
    const data = message.body;

    logWithContext("QUEUE_CONSUMER", "Processing Slack suggest changes", {
      requestId: data.requestId,
      changesLength: data.suggestedChanges.length,
    });

    try {
      const request = await this.requestService.requests.findByRequestId(data.requestId);

      if (!request) {
        logWithContext("QUEUE_CONSUMER", "No request found for suggest changes", { requestId: data.requestId });
        message.ack();
        return;
      }

      // Resolve Slack user ID to display name
      let resolvedUserName = data.slackUserId;
      if (data.slackUserId?.match(/^U[A-Z0-9]+$/)) {
        const slackConfig = await this.configRepo.getSlackConfig();
        if (slackConfig?.botTokenEncrypted) {
          const botToken = await decrypt(slackConfig.botTokenEncrypted, this.env.ENCRYPTION_KEY!);
          const userInfo = await getSlackUserInfo(data.slackUserId, botToken);
          resolvedUserName = userInfo.displayName;
        }
      }

      // Log follow-up request and update status
      await this.requestService.addFollowUpRequest(
        data.requestId,
        data.suggestedChanges,
        { id: data.slackUserId, name: resolvedUserName },
        "slack",
        { prNumber: request.prNumber, prUrl: request.prUrl, issueNumber: request.issueNumber }
      );

      // Process directly as an issue message instead of re-queuing
      const issueMessage: IQueueMessage<IssueQueueMessage> = {
        body: {
          requestId: data.requestId,
          repo: request.repositoryName || request.repo || "",
          description: request.issueBody || request.description || "",
          issueId: request.issueId ?? 0,
          issueNumber: request.issueNumber ?? 0,
          issueTitle: request.issueTitle ?? "",
          issueBody: request.issueBody || request.description || "",
          issueLabels: request.issueLabels || [],
          issueAuthor: request.issueAuthor ?? "",
          repositoryUrl: request.repositoryUrl ?? "",
          repositoryName: request.repositoryName || request.repo || "",
          repositoryId: request.repositoryId ?? 0,
          repositoryOwner: request.repositoryOwner ?? "",
          repositoryNameOnly: request.repositoryNameOnly ?? "",
          appId: request.appId ?? "",
          isFollowUp: true,
          followUpRequest: data.suggestedChanges,
          followUpAuthor: resolvedUserName,
          existingPrNumber: request.prNumber ?? undefined,
          existingPrUrl: request.prUrl ?? undefined,
          triggeredBy: 'slack' as const,
        },
        attempts: message.attempts,
        ack: () => message.ack(),
        retry: () => message.retry(),
      };

      logWithContext("QUEUE_CONSUMER", "Suggest changes processed, dispatching to issue handler", {
        requestId: data.requestId,
        prNumber: request.prNumber,
        issueNumber: request.issueNumber,
      });

      await this.handleIssueMessage(issueMessage);
    } catch (error) {
      logWithContext("QUEUE_CONSUMER", "Failed to process suggest changes", {
        requestId: data.requestId,
        error: getErrorMessage(error),
      });

      message.retry();
    }
  }

  /**
   * Handle Slack app_mention events
   * This is where all the heavy processing happens (moved from events.ts handler)
   * - Fetch configs
   * - Parse command
   * - Handle help/validation
   * - Check for follow-ups
   * - Resolve repository
   * - Add reactions
   * - Fetch thread context
   * - Queue for processing
   */
  private async handleSlackAppMention(message: IQueueMessage<SlackAppMentionMessage>): Promise<void> {
    const data = message.body;
    const { text, channel, ts, threadTs, user } = data;

    logWithContext("QUEUE_CONSUMER", "Processing Slack app_mention", {
      channel,
      ts,
      threadTs,
      user,
      textLength: text?.length,
    });

    try {
      // Get bot token and configs in parallel
      const [slackConfig, githubConfig, llmConfig, systemDefaultsConfig] = await Promise.all([
        this.configRepo.getSlackConfig(),
        this.configRepo.getGitHubConfig(),
        this.configRepo.getLLMConfig(),
        this.configRepo.getSystemDefaultsConfig(),
      ]);

      if (!slackConfig?.botTokenEncrypted) {
        logWithContext("QUEUE_CONSUMER", "No bot token configured for app_mention");
        message.ack();
        return;
      }

      const botToken = await decrypt(slackConfig.botTokenEncrypted, this.env.ENCRYPTION_KEY!);

      // Parse the command from the mention text
      const { options, prompt, forceNewAgent } = parseClarityCommand(text);

      logWithContext("QUEUE_CONSUMER", "Parsed clarity command", {
        options,
        promptLength: prompt.length,
        hasPrompt: !!prompt,
      });

      // Note: Help command is handled directly in the HTTP handler (events.ts) for fast response

      // Validate prompt
      if (!prompt || prompt.trim().length === 0) {
        await postSlackMessage(
          botToken,
          channel,
          "Please provide a description of what you'd like me to do. For example:\n`@clarity fix the login bug`\n`@clarity [repo=myrepo] add dark mode support`\n\n_Type `@clarity help` for more options._",
          threadTs || ts
        );
        message.ack();
        return;
      }

      // Check for existing active agent in thread (for follow-up handling)
      if (threadTs && !forceNewAgent) {
        const existingAgent = await this.requestService.findActiveAgentInThread(channel, threadTs);

        logWithContext("QUEUE_CONSUMER", "Follow-up check result", {
          foundAgent: !!existingAgent,
          agentRequestId: existingAgent?.requestId,
          agentStatus: existingAgent?.status,
        });

        if (existingAgent) {
          // Deduplication: Check if this exact message was already processed
          const alreadyProcessed = await this.requestService.hasFollowUpWithMessageTs(
            existingAgent.requestId,
            ts
          );

          if (alreadyProcessed) {
            logWithContext("QUEUE_CONSUMER", "Duplicate follow-up detected, skipping", {
              requestId: existingAgent.requestId,
              messageTs: ts,
            });
            message.ack();
            return;
          }

          logWithContext("QUEUE_CONSUMER", "Processing follow-up for existing agent", {
            requestId: existingAgent.requestId,
            status: existingAgent.status,
          });

          // Add processing reaction
          await addSlackReaction(botToken, channel, ts, REACTION_PROCESSING);

          // Update trigger message ts
          await this.requestService.updateSlackThreadTs(existingAgent.requestId, threadTs, ts);

          // Fetch user info
          const userInfo = await getSlackUserInfo(user, botToken);

          // Log the follow-up request
          await this.requestService.addFollowUpRequest(
            existingAgent.requestId,
            prompt,
            { id: user, name: userInfo.displayName },
            "slack",
            { channelId: channel, threadTs, messageTs: ts }
          );

          // Re-queue the request with follow-up information
          await this.queueProducer.send({
            requestId: existingAgent.requestId,
            repo: existingAgent.repositoryName ?? "",
            description: existingAgent.issueBody || existingAgent.issueTitle || "",
            issueId: existingAgent.issueId ?? 0,
            issueNumber: existingAgent.issueNumber ?? 0,
            issueTitle: existingAgent.issueTitle ?? "",
            issueBody: existingAgent.issueBody || "",
            issueLabels: existingAgent.issueLabels || [],
            issueAuthor: existingAgent.issueAuthor ?? "",
            repositoryUrl: existingAgent.repositoryUrl ?? "",
            repositoryName: existingAgent.repositoryName ?? "",
            repositoryId: existingAgent.repositoryId ?? 0,
            repositoryOwner: existingAgent.repositoryOwner ?? "",
            repositoryNameOnly: existingAgent.repositoryNameOnly ?? "",
            appId: existingAgent.appId ?? "",
            isFollowUp: true,
            followUpRequest: prompt,
            followUpAuthor: userInfo.displayName,
            existingPrNumber: existingAgent.prNumber ?? undefined,
            existingPrUrl: existingAgent.prUrl ?? undefined,
            triggeredBy: 'slack' as const,
            attachments: data.attachments,
            slackBotToken: botToken,
          });

          // Post acknowledgment
          await postSlackMessage(
            botToken,
            channel,
            `Adding follow-up instructions to the existing request: *${prompt.length > 50 ? prompt.substring(0, 50) + '...' : prompt}*\n\n_Tip: Use \`@clarity agent <prompt>\` to start a completely new agent instead._`,
            threadTs
          );

          message.ack();
          return;
        }
      }

      // Get available repositories
      const availableRepos = githubConfig?.repositories || [];

      if (availableRepos.length === 0) {
        await postSlackMessage(
          botToken,
          channel,
          "No repositories are configured. Please ensure the GitHub App is installed on at least one repository.",
          threadTs || ts
        );
        message.ack();
        return;
      }

      // Resolve repository
      let resolvedRepo: string | undefined;

      if (options.repo) {
        resolvedRepo = resolveRepository(
          options.repo,
          availableRepos.map(r => ({ name: r.name, fullName: r.fullName }))
        );

        if (!resolvedRepo) {
          const repoNames = availableRepos.map(r => `\`${r.name}\``).join(", ");
          await postSlackMessage(
            botToken,
            channel,
            `Repository "${options.repo}" not found. Available repositories: ${repoNames}`,
            threadTs || ts
          );
          message.ack();
          return;
        }
      } else if (systemDefaultsConfig?.defaultRepository) {
        resolvedRepo = resolveRepository(
          systemDefaultsConfig.defaultRepository,
          availableRepos.map(r => ({ name: r.name, fullName: r.fullName }))
        );
      }

      if (!resolvedRepo && availableRepos.length === 1) {
        resolvedRepo = availableRepos[0].fullName;
      }

      if (!resolvedRepo) {
        const repoNames = availableRepos.map(r => `\`${r.name}\``).join(", ");
        await postSlackMessage(
          botToken,
          channel,
          `Please specify a repository. Available: ${repoNames}\n\nExample: \`@clarity [repo=myrepo] ${prompt.substring(0, 30)}...\``,
          threadTs || ts
        );
        message.ack();
        return;
      }

      // Check LLM configuration
      const llmProviders = detectLLMProviders(llmConfig);

      if (!llmProviders.hasAnyProvider) {
        await postSlackMessage(
          botToken,
          channel,
          "No LLM provider is configured. Please configure at least one API key in Settings before using @clarity.",
          threadTs || ts
        );
        message.ack();
        return;
      }

      const { agentType, agentProvider } = getDefaultAgentConfig(llmProviders, systemDefaultsConfig);

      // Add processing reaction
      await addSlackReaction(botToken, channel, ts, REACTION_PROCESSING);

      // Fetch thread context if in a thread
      let threadContext: string | null = null;
      if (threadTs) {
        threadContext = await this.getThreadContext(channel, threadTs, botToken);
      }

      // Generate request ID
      const requestId = `fr-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      // Extract title and build description
      const title = extractTitle(prompt);
      const requestType = options.type || "feature";

      let fullDescription = prompt;
      if (threadContext) {
        fullDescription = `## Thread Context\n\nThe following is the conversation context from the Slack thread where this request was made:\n\n${threadContext}\n\n---\n\n## Request\n\n${prompt}`;
      }

      // Fetch user info
      const userInfo = await getSlackUserInfo(user, botToken);

      logWithContext("QUEUE_CONSUMER", "Queueing app_mention as feature request", {
        requestId,
        repo: resolvedRepo,
        title,
        requestType,
        agentType,
        agentProvider,
      });

      // Queue the feature request
      await this.queueProducer.send({
        type: "slack_feature_request",
        requestId,
        repo: resolvedRepo.split("/").pop() ?? "",
        title,
        description: fullDescription,
        requestType,
        agentType: agentType as AgentType,
        agentProvider: agentProvider as AgentProvider | undefined,
        channelId: channel,
        slackUserId: user,
        slackUserName: userInfo.displayName,
        botToken,
        triggerMessageTs: ts,
        triggerThreadTs: threadTs,
        hasThreadContext: !!threadContext,
        attachments: data.attachments,
      });

      message.ack();
    } catch (error) {
      logWithContext("QUEUE_CONSUMER", "Error processing app_mention", {
        error: getErrorMessage(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      // Acknowledge to avoid infinite retries - errors should be logged but not block
      message.ack();
    }
  }

  /**
   * Fetch thread context when @clarity is invoked in a thread
   */
  private async getThreadContext(
    channelId: string,
    threadTs: string,
    botToken: string,
    limit: number = 50
  ): Promise<string | null> {
    try {
      const response = await fetch(
        `https://slack.com/api/conversations.replies?channel=${channelId}&ts=${threadTs}&limit=${limit}`,
        {
          headers: {
            Authorization: `Bearer ${botToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      const data = await response.json() as {
        ok: boolean;
        messages?: Array<{
          user?: string;
          bot_id?: string;
          text?: string;
          ts?: string;
        }>;
        error?: string;
      };

      if (!data.ok || !data.messages || data.messages.length <= 1) {
        return null;
      }

      const filteredMessages = data.messages
        .slice(0, -1)
        .filter((m) => !m.bot_id);

      if (filteredMessages.length === 0) {
        return null;
      }

      // Collect user IDs
      const userIds = new Set<string>();
      for (const m of filteredMessages) {
        if (m.user) userIds.add(m.user);
        const mentions = m.text?.matchAll(/<@([A-Z0-9]+)>/g);
        if (mentions) {
          for (const match of mentions) userIds.add(match[1]);
        }
      }

      // Fetch user names
      const userNameMap = new Map<string, string>();
      await Promise.all(
        Array.from(userIds).map(async (userId) => {
          const info = await getSlackUserInfo(userId, botToken);
          userNameMap.set(userId, info.displayName);
        })
      );

      // Format messages
      const contextMessages = filteredMessages.map((m) => {
        const userName = m.user ? userNameMap.get(m.user) || m.user : "User";
        const messageText = m.text?.replace(/<@([A-Z0-9]+)>/g, (_, uid) => {
          const name = userNameMap.get(uid);
          return name ? `@${name}` : `<@${uid}>`;
        }) || "(no text)";
        return `${userName}: ${messageText}`;
      });

      logWithContext("QUEUE_CONSUMER", "Fetched thread context", {
        channelId,
        threadTs,
        messageCount: contextMessages.length,
      });

      return contextMessages.join("\n\n");
    } catch (error) {
      logWithContext("QUEUE_CONSUMER", "Error fetching thread context", {
        error: getErrorMessage(error),
      });
      return null;
    }
  }
}

/**
 * Factory function for Cloudflare Workers
 * Wraps Cloudflare-specific types and creates a QueueConsumer
 */
export async function handleQueueMessage(
  batch: MessageBatch<QueueMessage>,
  env: Env
): Promise<void> {
  const consumer = new QueueConsumer(env);
  const abstractBatch = createQueueBatch<QueueMessage>(batch);
  return consumer.processBatch(abstractBatch);
}
