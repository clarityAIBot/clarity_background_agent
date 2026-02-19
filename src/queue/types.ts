import type { AgentType, AgentProvider } from "../agents";

/** Slack file attachment metadata extracted from app_mention event */
export interface SlackFileAttachment {
  name: string;
  mimetype: string;
  filetype: string;
  size: number;
  urlPrivateDownload: string;
}

export interface IssueQueueMessage {
  type?: string; // "slack_feature_request" or undefined (GitHub webhook)
  requestId: string;
  repo: string;
  description: string;
  issueId: number;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  issueLabels: string[];
  issueAuthor: string;
  repositoryUrl: string;
  repositoryName: string;
  repositoryId: number;
  repositoryOwner: string;
  repositoryNameOnly: string;
  appId: string;
  // Trigger source tracking (to detect duplicate triggers)
  triggeredBy?: 'slack' | 'github' | 'web';
  // Optional user message (clarification response or change request)
  isFollowUp?: boolean;
  followUpRequest?: string;
  followUpAuthor?: string;
  // Existing PR info (if present, container will modify existing PR)
  existingPrNumber?: number;
  existingPrUrl?: string;
  // Agent configuration (from Slack interactivity or labels)
  agentType?: AgentType;
  agentProvider?: AgentProvider;
  agentModel?: string;
  // Retry flag
  isRetry?: boolean;
  // Slack file attachments (images, code files, etc.)
  attachments?: SlackFileAttachment[];
  // Bot token needed for container to download Slack files
  slackBotToken?: string;
}

export interface SlackFeatureRequestMessage {
  type: "slack_feature_request";
  requestId: string;
  repo: string;
  title: string;
  description: string;
  requestType: string;
  agentType?: AgentType;
  agentProvider?: AgentProvider;
  channelId?: string;
  slackUserId: string;
  slackUserName: string;
  botToken: string;
  // For @mention flow - reply in existing thread instead of creating new one
  triggerMessageTs?: string;
  triggerThreadTs?: string;
  hasThreadContext?: boolean;
  // Slack file attachments
  attachments?: SlackFileAttachment[];
}

export interface SlackRetryRequestMessage {
  type: "slack_retry_request";
  requestId: string;
  issueNumber: number;
  userId: string;
  userName: string;
  channelId?: string;
  threadTs?: string;
  botToken: string;
}

/**
 * Minimal Slack app_mention event - queued immediately for fast response.
 * All heavy processing (config fetching, validation, reactions, etc.) happens in consumer.
 */
export interface SlackAppMentionMessage {
  type: "slack_app_mention";
  // Raw event data
  text: string;
  channel: string;
  ts: string;  // Message timestamp (unique ID)
  threadTs?: string;  // Thread timestamp (if in thread)
  user: string;  // Slack user ID
  // File attachments from the Slack event
  attachments?: SlackFileAttachment[];
}

/**
 * Slack clarification answer - queued immediately from modal submission to avoid 3-second timeout.
 * Consumer handles DB lookup, status update, and re-queuing for processing.
 */
export interface SlackClarificationAnswerMessage {
  type: "slack_clarification_answer";
  requestId: string;
  issueNumber: number;
  answers: string;
  slackUserId: string;
}

/**
 * Slack suggest changes - queued immediately from modal submission.
 * Consumer handles DB lookup, follow-up logging, and re-queuing for processing.
 */
export interface SlackSuggestChangesMessage {
  type: "slack_suggest_changes";
  requestId: string;
  suggestedChanges: string;
  slackUserId: string;
}

export type QueueMessage = IssueQueueMessage | SlackFeatureRequestMessage | SlackRetryRequestMessage | SlackAppMentionMessage | SlackClarificationAnswerMessage | SlackSuggestChangesMessage;

// Request type emoji mapping
export const REQUEST_TYPE_EMOJI: Record<string, string> = {
  feature: "✨",
  bug: "🐛",
  refactor: "♻️",
  docs: "📚",
};

export function getRequestTypeEmoji(requestType: string): string {
  return REQUEST_TYPE_EMOJI[requestType] || "✨";
}

// GitHub error comment template
export function buildErrorCommentBody(errorMsg: string, attemptNumber: number, suggestion?: string): string {
  const truncatedError = errorMsg.length > 500 ? errorMsg.substring(0, 500) + "..." : errorMsg;
  const suggestionBlock = suggestion ? `\n### 💡 Suggestion\n${suggestion}\n` : "";
  return `❌ **Processing Failed**

I encountered an error while working on this issue after ${attemptNumber} attempts:

\`\`\`
${truncatedError}
\`\`\`
${suggestionBlock}
### 🔄 To Retry
Add the \`clarity-ai-retry\` label to this issue to trigger another attempt.

---
🤖 Powered by Clarity AI`;
}
