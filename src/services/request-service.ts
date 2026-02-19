import type { DrizzleDb } from "../db/client";
import { FeatureRequestRepository, RequestMessagesRepository, AppConfigRepository } from "../db/repositories";
import type { FeatureRequest, NewFeatureRequest, MessageSource } from "../db/schema";
import {
  getSlackContext,
  setProcessingReaction,
  setClarificationReaction,
  setSuccessReaction,
  setErrorReaction,
  setRetryReaction,
  type SlackContext,
} from "../integrations/slack/reactions";

/**
 * Service layer that coordinates FeatureRequest and RequestMessages operations atomically.
 * Ensures status updates, message logging, and Slack reactions happen together.
 */
export class RequestService {
  private featureRequestRepo: FeatureRequestRepository;
  private messagesRepo: RequestMessagesRepository;
  private configRepo: AppConfigRepository | null;
  private encryptionKey: string | null;

  constructor(
    private db: DrizzleDb,
    configRepo?: AppConfigRepository,
    encryptionKey?: string
  ) {
    this.featureRequestRepo = new FeatureRequestRepository(db);
    this.messagesRepo = new RequestMessagesRepository(db);
    this.configRepo = configRepo ?? null;
    this.encryptionKey = encryptionKey ?? null;
  }

  /**
   * Get Slack context for a request (if config is available)
   */
  private async getSlackContextForRequest(requestId: string): Promise<SlackContext | null> {
    if (!this.configRepo || !this.encryptionKey) {
      return null;
    }
    return getSlackContext(this.configRepo, this, requestId, this.encryptionKey);
  }

  // Expose repos for direct access when needed
  get requests() {
    return this.featureRequestRepo;
  }

  get messages() {
    return this.messagesRepo;
  }

  /**
   * Create a new feature request with initial message
   */
  async createRequest(
    data: NewFeatureRequest,
    actor: { id: string; name: string },
    source: MessageSource
  ): Promise<FeatureRequest> {
    const request = await this.featureRequestRepo.create(data);

    await this.messagesRepo.addInitialRequest(
      data.requestId,
      data.description || data.title || "New request",
      actor,
      source,
      {
        issueNumber: data.issueNumber,
        issueUrl: data.issueUrl,
        repo: data.repo,
      }
    );

    return request;
  }

  /**
   * Start processing a request - update status, log message, and update Slack reaction
   */
  async startProcessing(requestId: string, triggeredBy?: 'slack' | 'github' | 'web'): Promise<void> {
    await this.featureRequestRepo.updateStatus(requestId, "processing", {
      taskStatus: "processing",
    });

    await this.messagesRepo.addProcessingStarted(requestId, triggeredBy);

    // Update Slack reaction: remove 💬, add ⏳
    const slackContext = await this.getSlackContextForRequest(requestId);
    if (slackContext) {
      await setProcessingReaction(slackContext, requestId);
    }
  }

  /**
   * Update processing status with a message
   */
  async updateProcessingStatus(
    requestId: string,
    update: string,
    metadata?: { fromStatus?: string; toStatus?: string }
  ): Promise<void> {
    await this.messagesRepo.addProcessingUpdate(requestId, update, metadata);
  }

  /**
   * Mark request as awaiting clarification with questions and update Slack reaction
   */
  async requestClarification(
    requestId: string,
    questions: string,
    metadata?: { slackThreadTs?: string; issueCommentId?: number }
  ): Promise<void> {
    await this.featureRequestRepo.updateStatus(requestId, "awaiting_clarification");

    await this.messagesRepo.addClarificationAsk(requestId, questions, metadata);

    // Update Slack reaction: remove ⏳, add 💬
    const slackContext = await this.getSlackContextForRequest(requestId);
    if (slackContext) {
      await setClarificationReaction(slackContext, requestId);
    }
  }

  /**
   * Handle clarification answer and resume processing
   */
  async handleClarificationAnswer(
    requestId: string,
    answer: string,
    actor: { id: string; name: string },
    source: MessageSource,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.messagesRepo.addClarificationAnswer(
      requestId,
      answer,
      actor,
      source,
      metadata
    );

    // Resume processing
    await this.featureRequestRepo.updateStatus(requestId, "processing", {
      taskStatus: "processing",
    });
  }

  /**
   * Record a follow-up request
   */
  async addFollowUpRequest(
    requestId: string,
    description: string,
    actor: { id: string; name: string },
    source: MessageSource,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.messagesRepo.addFollowUpRequest(
      requestId,
      description,
      actor,
      source,
      metadata
    );

    // Update status to processing for follow-up
    await this.featureRequestRepo.updateStatus(requestId, "processing", {
      taskStatus: "processing",
    });
  }

  /**
   * Mark request as completed with PR details and update Slack reaction
   */
  async completeWithPR(
    requestId: string,
    prUrl: string,
    prNumber: number,
    prBranchName: string,
    durationMs: number,
    costUsd: number,
    summary?: string,
    sessionId?: string  // SDK session ID for persistence (ADR-001)
  ): Promise<void> {
    // Update PR details
    await this.featureRequestRepo.updatePRDetails(
      requestId,
      prUrl,
      prNumber,
      prBranchName
    );

    // Mark as processed (includes sessionId for session persistence)
    await this.featureRequestRepo.markProcessed(requestId, durationMs, costUsd, sessionId);

    // Convert cost to cents for message
    const costCents = Math.round(costUsd * 100);

    // Log PR created message
    await this.messagesRepo.addPRCreated(requestId, prUrl, durationMs, costCents);

    // Log agent summary if provided
    if (summary) {
      await this.messagesRepo.addAgentSummary(requestId, summary, durationMs, costCents);
    }

    // Update Slack reaction: remove ⏳, add ✅
    const slackContext = await this.getSlackContextForRequest(requestId);
    if (slackContext) {
      await setSuccessReaction(slackContext, requestId);
    }
  }

  /**
   * Mark request as error with message and update Slack reaction
   */
  async markError(
    requestId: string,
    errorCode: string,
    errorMessage: string,
    errorStack?: string,
    retryCount?: number
  ): Promise<void> {
    await this.featureRequestRepo.markError(requestId);

    await this.messagesRepo.addError(
      requestId,
      errorCode,
      errorMessage,
      errorStack,
      retryCount
    );

    // Update Slack reaction: remove ⏳, add ❌
    const slackContext = await this.getSlackContextForRequest(requestId);
    if (slackContext) {
      await setErrorReaction(slackContext, requestId);
    }
  }

  /**
   * Handle retry attempt and update Slack reaction
   */
  async handleRetry(
    requestId: string,
    triggeredBy: { id: string; name: string },
    source: MessageSource
  ): Promise<number> {
    await this.featureRequestRepo.incrementRetryCount(requestId);

    const request = await this.featureRequestRepo.findByRequestId(requestId);
    const retryCount = request?.retryCount ?? 1;

    await this.messagesRepo.addRetry(requestId, retryCount, triggeredBy, source);

    // Update Slack reaction: remove ❌, add ⏳
    const slackContext = await this.getSlackContextForRequest(requestId);
    if (slackContext) {
      await setRetryReaction(slackContext, requestId);
    }

    return retryCount;
  }

  /**
   * Cancel a request
   */
  async cancelRequest(
    requestId: string,
    reason: string,
    cancelledBy: { id: string; name: string }
  ): Promise<void> {
    await this.featureRequestRepo.updateStatus(requestId, "cancelled");

    await this.messagesRepo.addCancelled(requestId, reason, cancelledBy);
  }

  // Agent activity logging methods (passthrough to messages repo)
  async logAgentThinking(
    requestId: string,
    thinking: string,
    turnId: string,
    turnNumber: number
  ) {
    return this.messagesRepo.addAgentThinking(requestId, thinking, turnId, turnNumber);
  }

  async logAgentToolCall(
    requestId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    turnId: string,
    turnNumber: number
  ) {
    return this.messagesRepo.addAgentToolCall(requestId, toolName, toolInput, turnId, turnNumber);
  }

  async logAgentToolResult(
    requestId: string,
    toolName: string,
    toolOutput: string,
    toolDurationMs: number,
    turnId: string,
    costCents?: number
  ) {
    return this.messagesRepo.addAgentToolResult(
      requestId,
      toolName,
      toolOutput,
      toolDurationMs,
      turnId,
      costCents
    );
  }

  async logAgentFileChange(
    requestId: string,
    filePath: string,
    fileAction: "created" | "modified" | "deleted",
    diffPreview?: string,
    turnId?: string
  ) {
    return this.messagesRepo.addAgentFileChange(
      requestId,
      filePath,
      fileAction,
      diffPreview,
      turnId
    );
  }

  async logAgentTerminal(
    requestId: string,
    command: string,
    exitCode: number,
    stdout?: string,
    stderr?: string,
    turnId?: string
  ) {
    return this.messagesRepo.addAgentTerminal(
      requestId,
      command,
      exitCode,
      stdout,
      stderr,
      turnId
    );
  }

  async logAgentSummary(
    requestId: string,
    summary: string,
    durationMs: number,
    costCents: number
  ) {
    return this.messagesRepo.addAgentSummary(requestId, summary, durationMs, costCents);
  }

  // Query methods
  async getRequestWithMessages(requestId: string) {
    const request = await this.featureRequestRepo.findByRequestId(requestId);
    if (!request) return null;

    const messages = await this.messagesRepo.getThread(requestId);
    const conversationHistory = await this.messagesRepo.getConversationHistory(requestId);
    const agentActivity = await this.messagesRepo.getAgentActivity(requestId);
    const metrics = await this.messagesRepo.getTotalMetrics(requestId);

    // Transform request to match frontend expected field names
    // DB uses: durationMs, costUsd (stored as cents)
    // Frontend expects: totalDurationMs, totalCostCents
    const transformedRequest = {
      ...request,
      totalDurationMs: request.durationMs,
      totalCostCents: request.costUsd, // Already stored as cents in DB
    };

    return {
      request: transformedRequest,
      messages,
      conversationHistory,
      agentActivity,
      metrics,
    };
  }

  /**
   * Get recent requests for history display
   */
  async getRecentRequests(limit: number = 50) {
    return this.featureRequestRepo.getRecentRequests(limit);
  }

  /**
   * Get recent requests with pagination
   */
  async getRecentRequestsPaginated(limit: number = 100, offset: number = 0) {
    return this.featureRequestRepo.getRecentRequestsPaginated(limit, offset);
  }

  /**
   * Get requests by status
   */
  async getRequestsByStatus(status: FeatureRequest["status"], limit: number = 50) {
    return this.featureRequestRepo.getRequestsByStatus(status, limit);
  }

  /**
   * Get requests by repository
   */
  async getRequestsByRepo(repo: string, limit: number = 50) {
    return this.featureRequestRepo.getRequestsByRepo(repo, limit);
  }

  /**
   * Get request statistics since a given date
   */
  async getRequestStats(since: Date) {
    return this.featureRequestRepo.getRequestStats(since);
  }

  /**
   * Get total request count
   */
  async getRequestCount() {
    return this.featureRequestRepo.getRequestCount();
  }

  /**
   * Find request by GitHub issue
   */
  async findByGitHubIssue(repositoryName: string, issueNumber: number) {
    return this.featureRequestRepo.findByGitHubIssue(repositoryName, issueNumber);
  }

  /**
   * Find request by Slack thread
   */
  async findBySlackThread(channelId: string, threadTs: string) {
    return this.featureRequestRepo.findBySlackThread(channelId, threadTs);
  }

  /**
   * Find an active agent in a Slack thread (for follow-up handling)
   * Returns agent with status: processing, awaiting_clarification, or pending
   */
  async findActiveAgentInThread(channelId: string, threadTs: string) {
    return this.featureRequestRepo.findActiveAgentInThread(channelId, threadTs);
  }

  /**
   * Update Slack thread timestamp and optionally the trigger message timestamp
   */
  async updateSlackThreadTs(requestId: string, slackThreadTs: string, slackTriggerMessageTs?: string) {
    return this.featureRequestRepo.updateSlackThreadTs(requestId, slackThreadTs, slackTriggerMessageTs);
  }

  /**
   * Check if a follow-up with a specific Slack messageTs already exists.
   * Used for deduplication when Slack retries events.
   */
  async hasFollowUpWithMessageTs(requestId: string, messageTs: string): Promise<boolean> {
    return this.messagesRepo.hasFollowUpWithMessageTs(requestId, messageTs);
  }
}
