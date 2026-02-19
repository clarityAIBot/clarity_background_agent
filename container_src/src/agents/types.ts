/**
 * Agent types and interfaces for the Strategy Pattern implementation.
 * These types are used in the container for actual agent execution.
 */

// Agent type enum - matches database enum
export type AgentType = 'claude-code' | 'opencode';

// Provider enum - matches database enum
export type AgentProvider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'groq'
  | 'deepseek'
  | 'mistral'
  | 'together'
  | 'fireworks';

/**
 * Configuration for agent execution
 */
export interface AgentConfig {
  type: AgentType;
  provider?: AgentProvider;   // For OpenCode: which LLM provider to use
  model?: string;             // Specific model override (e.g., 'claude-3-5-sonnet-20241022')
  maxTurns?: number;          // Maximum agent turns (default: 100)
  timeout?: number;           // Execution timeout in ms (default: 600000 = 10 min)
}

/** Slack file attachment metadata (URLs, not content) */
export interface SlackFileAttachment {
  name: string;
  mimetype: string;
  filetype: string;
  size: number;
  urlPrivateDownload: string;
}

/** Downloaded attachment info after container fetches the file */
export interface DownloadedAttachment {
  originalName: string;
  localPath: string;      // Absolute path in workspace
  relativePath: string;   // Relative to workspace root
  mimetype: string;
  filetype: string;
  isImage: boolean;
}

/**
 * Issue context passed to agent
 *
 * Simplified approach (like vibe-kanban):
 * - If existingPrNumber exists: This is a follow-up to modify existing PR
 * - Otherwise: This is a new request (may have user message from clarification)
 */
export interface IssueContext {
  issueId: string;
  issueNumber: string;
  title: string;
  description: string;
  labels: string[];
  repositoryUrl: string;
  repositoryName: string;
  author: string;
  // Optional user message (clarification response or change request)
  followUpRequest?: string;
  followUpAuthor?: string;
  // Existing PR info (if present, we're modifying an existing PR)
  existingPrNumber?: string;
  existingPrUrl?: string;
  // Conversation history (last N clarification Q&A messages)
  conversationHistory?: string;
  // Slack file attachments (metadata only — container downloads the files)
  slackAttachments?: SlackFileAttachment[];
  slackBotToken?: string;
  // Slack progress streaming (container posts updates directly)
  slackChannelId?: string;
  slackThreadTs?: string;
}

/**
 * Context passed to agent for execution
 */
export interface AgentContext {
  workspaceDir: string;
  prompt: string;
  config: AgentConfig;
  issueContext: IssueContext;
  githubToken: string;
  requestId?: string;

  // Session resumption (ADR-001)
  resumeSessionId?: string;  // SDK session ID to resume from previous execution
  sessionBlob?: string;      // Gzipped base64 session data to restore

  // Optional callbacks
  onProgress?: (event: AgentProgressEvent) => void;
  signal?: AbortSignal;
}

/**
 * Result returned from agent execution
 */
export interface AgentResult {
  success: boolean;
  message: string;
  sessionId?: string;         // SDK session ID for persistence (ADR-001)
  sessionBlob?: string;       // Gzipped base64 session data to persist (ADR-001)
  prUrl?: string;
  prNumber?: number;
  prBranchName?: string;
  summary?: string;           // AI task summary from doc/ai-task/issue-<N>.md
  needsClarification?: boolean;
  clarifyingQuestions?: string;
  error?: string;
  /** True when only doc/markdown files were changed (no actual code changes) */
  isDocOnlyChanges?: boolean;

  // Execution metadata
  costUsd?: number;
  durationMs?: number;
  metadata?: {
    agent: AgentType;
    provider?: AgentProvider;
    model?: string;
    [key: string]: unknown;
  };
}

/**
 * Message in agent conversation
 */
export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
}

/**
 * Tool call made by agent
 */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  durationMs?: number;
}

/**
 * Progress event emitted during execution
 */
export interface AgentProgressEvent {
  type: 'started' | 'thinking' | 'tool_use' | 'file_change' | 'completed' | 'error';
  message?: string;
  data?: unknown;
  timestamp: Date;
}

/**
 * Agent capabilities descriptor
 */
export interface AgentCapabilities {
  supportsStreaming: boolean;
  supportsSessionManagement: boolean;
  supportsSkills?: boolean;  // Skills loaded from user/project directories
  supportedProviders: AgentProvider[];
  maxContextLength?: number;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}
