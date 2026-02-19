import { pgTable, text, integer, bigint, timestamp, boolean, jsonb, pgEnum, varchar, uuid, index, unique } from 'drizzle-orm/pg-core';

// Enums
export const requestStatusEnum = pgEnum('request_status', [
    'pending',
    'issue_created',
    'processing',
    'awaiting_clarification',
    'pr_created',
    'completed',
    'cancelled',
    'error'
]);

export const taskStatusEnum = pgEnum('task_status', [
    'pending',
    'processing',
    'completed',
    'error'
]);

// Config type enum for app_config table
export const configTypeEnum = pgEnum('config_type', [
    'github',
    'claude',
    'slack',
    'llm',
    'system_defaults'
]);

// Agent type enum for multi-agent support
export const agentTypeEnum = pgEnum('agent_type', [
    'claude-code',
    'opencode'
]);

// Agent provider enum (LLM providers)
export const agentProviderEnum = pgEnum('agent_provider', [
    'anthropic',
    'openai',
    'google',
    'groq',
    'deepseek',
    'mistral',
    'together',
    'fireworks'
]);

// TypeScript types for typed JSONB columns
export interface GitHubConfig {
    appId: string;
    privateKeyEncrypted: string;
    webhookSecretEncrypted: string;
    installationId?: string;
    ownerLogin: string;
    ownerType: string;
    ownerId: number;
    permissions: Record<string, string>;
    events: string[];
    repositories: Array<{ id: number; name: string; fullName: string }>;
    webhookCount?: number;
    lastWebhookAt?: string;
    setupAt?: string;
    // Cached installation token (expires ~1 hour)
    installationToken?: string;
    tokenExpiresAt?: string;
}

// LLM Configuration - stores API keys for all supported providers
export interface LLMConfig {
    // Anthropic (Claude) - primary provider
    anthropicApiKeyEncrypted?: string;
    // OpenAI
    openaiApiKeyEncrypted?: string;
    // Google (Gemini)
    googleApiKeyEncrypted?: string;
    // Groq (fast inference)
    groqApiKeyEncrypted?: string;
    // DeepSeek
    deepseekApiKeyEncrypted?: string;
    // Mistral
    mistralApiKeyEncrypted?: string;
    // Together AI
    togetherApiKeyEncrypted?: string;
    // Fireworks AI
    fireworksApiKeyEncrypted?: string;
    // Metadata
    setupAt?: string;
    updatedAt?: string;
}

// Backwards compatibility alias
export type ClaudeConfig = LLMConfig;

export interface SlackConfig {
    signingSecretEncrypted: string;
    botTokenEncrypted: string;
    setupAt?: string;
}

// Auth Configuration - controls who can login and default policies
export interface AuthConfig {
    // Domain restrictions (Google Workspace domains)
    allowedDomains?: string[];              // e.g., ['cleartax.in', 'cleartax.com'] - empty = allow all

    // Email allowlist (specific emails allowed regardless of domain)
    allowedEmails?: string[];               // e.g., ['contractor@gmail.com'] - empty = domain-only check

    // Default policy for new users
    defaultPolicyId?: string;               // Default: 'developer' - auto-assigned to new users
}

// System Defaults Configuration - deployment-level settings
export interface SystemDefaultsConfig {
    // Default agent settings
    defaultAgentType: AgentType;           // 'claude-code' | 'opencode'
    defaultAgentProvider: AgentProvider;    // 'anthropic' | 'openai' | etc.
    defaultAgentModel?: string;             // e.g., 'claude-sonnet-4-5-20250514'

    // Default repository (for Slack requests without repo context)
    defaultRepository?: string;             // e.g., 'owner/repo-name'
    defaultBranch?: string;                 // e.g., 'main' or 'develop'

    // Organization info
    githubOrganizationName?: string;        // e.g., 'ClearTax' - GitHub org for repo selection

    // Custom prompt
    customDefaultPrompt?: string;           // Custom system prompt to prepend to all agent requests

    // Auth configuration
    auth?: AuthConfig;                      // Controls login restrictions and default policies
}

// Union type for all config types
export type ConfigData = GitHubConfig | ClaudeConfig | SlackConfig | SystemDefaultsConfig;

// Unified App Configuration using typed JSONB columns
export const appConfig = pgTable('app_config', {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    type: configTypeEnum('type').notNull().unique(), // 'github', 'claude', 'slack'
    config: jsonb('config').notNull().$type<ConfigData>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Type-safe helper functions
export type GitHubConfigRow = typeof appConfig.$inferSelect & { config: GitHubConfig };
export type ClaudeConfigRow = typeof appConfig.$inferSelect & { config: ClaudeConfig };
export type SlackConfigRow = typeof appConfig.$inferSelect & { config: SlackConfig };
export type SystemDefaultsConfigRow = typeof appConfig.$inferSelect & { config: SystemDefaultsConfig };

// Request origin enum
export const requestOriginEnum = pgEnum('request_origin', [
    'slack',
    'github_issue',
    'web'  // UI dashboard
]);

// Feature Requests (main tracking table)
export const featureRequests = pgTable('feature_requests', {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    requestId: text('request_id').notNull().unique(),
    origin: requestOriginEnum('origin').notNull(), // Where the request came from

    // Request details
    repo: text('repo').notNull(),
    title: text('title'),                // Short title for UI (e.g., "Add dark mode toggle")
    description: text('description').notNull(),
    requestType: text('request_type'),   // 'feature', 'bug_fix', 'refactor', 'documentation'
    status: requestStatusEnum('status').notNull().default('pending'),

    // Slack context (populated when origin='slack')
    slackUserId: text('slack_user_id'),
    slackUserName: text('slack_user_name'),
    slackChannelId: text('slack_channel_id'),
    slackChannelName: text('slack_channel_name'),
    slackThreadTs: text('slack_thread_ts'),
    slackTriggerMessageTs: text('slack_trigger_message_ts'), // The message where reactions should be added/removed (for @mention flow)
    responseUrl: text('response_url'),

    // GitHub issue details (populated when origin='github_issue')
    issueId: bigint('issue_id', { mode: 'number' }).unique(), // Unique - one request per issue (bigint for large IDs)
    issueNumber: integer('issue_number'),
    issueTitle: text('issue_title'),
    issueBody: text('issue_body'),
    issueLabels: jsonb('issue_labels').$type<string[]>(),
    issueAuthor: text('issue_author'),
    issueUrl: text('issue_url'),

    // Web UI context (populated when origin='web')
    webUserId: text('web_user_id'),    // Auth user ID (OAuth/session)
    webUserEmail: text('web_user_email'),

    // Repository details
    repositoryUrl: text('repository_url'),
    repositoryName: text('repository_name'),
    repositoryId: integer('repository_id'),
    repositoryOwner: text('repository_owner'),
    repositoryNameOnly: text('repository_name_only'),

    // Processing details
    appId: text('app_id'),
    taskStatus: taskStatusEnum('task_status').default('pending'),
    // Note: errors are tracked in request_messages table with full context

    // PR details
    prUrl: text('pr_url'),
    prNumber: integer('pr_number'),
    prBranchName: text('pr_branch_name'), // For follow-up requests to same PR

    // Retry tracking
    retryCount: integer('retry_count').default(0),
    lastRetryAt: timestamp('last_retry_at'),

    // Agent configuration
    agentType: agentTypeEnum('agent_type').default('claude-code'),
    agentProvider: agentProviderEnum('agent_provider').default('anthropic'),
    agentModel: text('agent_model'),                     // specific model override (e.g., 'claude-3-5-sonnet-20241022')
    agentSessionId: text('agent_session_id'),            // session ID for session management

    // Cost tracking
    costUsd: integer('cost_usd'), // stored as cents
    durationMs: integer('duration_ms'),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    processedAt: timestamp('processed_at'),
});

export type FeatureRequest = typeof featureRequests.$inferSelect;
export type NewFeatureRequest = typeof featureRequests.$inferInsert;

// Agent types
export type AgentType = 'claude-code' | 'opencode';
export type AgentProvider = 'anthropic' | 'openai' | 'google' | 'groq' | 'deepseek' | 'mistral' | 'together' | 'fireworks';

// Message type enum for conversation tracking
export const messageTypeEnum = pgEnum('message_type', [
    // User interactions
    'initial_request',      // Original feature request
    'clarification_ask',    // AI asking for clarification
    'clarification_answer', // User answering clarification
    'follow_up_request',    // User requesting more changes

    // Processing lifecycle
    'processing_started',   // Container started processing
    'processing_update',    // Status updates during processing
    'pr_created',           // PR creation notification
    'pr_updated',           // PR update notification
    'error',                // Error/failure messages
    'retry',                // Retry attempt
    'cancelled',            // Request cancelled

    // Agent activity (for Claude Code-like UI)
    'agent_thinking',       // AI reasoning/planning
    'agent_tool_call',      // Tool invocation (Read, Edit, Bash, etc.)
    'agent_tool_result',    // Tool output/result
    'agent_file_change',    // File created/modified/deleted
    'agent_terminal',       // Terminal/bash command output
    'agent_summary',        // Summary of what was done
]);

export type MessageType = 'initial_request' | 'clarification_ask' | 'clarification_answer' | 'follow_up_request' |
    'processing_started' | 'processing_update' | 'pr_created' | 'pr_updated' | 'error' | 'retry' | 'cancelled' |
    'agent_thinking' | 'agent_tool_call' | 'agent_tool_result' | 'agent_file_change' | 'agent_terminal' | 'agent_summary';

// Message source enum
export const messageSourceEnum = pgEnum('message_source', [
    'slack',
    'github',
    'web',     // UI dashboard
    'system'
]);

export type MessageSource = 'slack' | 'github' | 'web' | 'system';

// Request Messages (conversation thread for each feature request)
export const requestMessages = pgTable('request_messages', {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    requestId: text('request_id').notNull().references(() => featureRequests.requestId),

    // Message details
    type: messageTypeEnum('type').notNull(),
    source: messageSourceEnum('source').notNull(),
    content: text('content').notNull(),

    // Actor info
    actorId: text('actor_id'),       // Slack user ID, GitHub user login, or 'system'
    actorName: text('actor_name'),   // Display name

    // Source-specific metadata
    metadata: jsonb('metadata').$type<{
        // Slack context
        slackTs?: string;
        slackThreadTs?: string;
        slackChannelId?: string;
        // GitHub context
        issueCommentId?: number;
        prCommentId?: number;
        commitSha?: string;
        // Processing context (for pr_created/pr_updated messages)
        durationMs?: number;
        costCents?: number;
        // State change context
        fromStatus?: string;
        toStatus?: string;
        // Error/failure tracking
        errorCode?: string;       // e.g., 'CONTAINER_TIMEOUT', 'GITHUB_API_ERROR', 'CLAUDE_RATE_LIMIT'
        errorMessage?: string;    // Human-readable error message
        errorStack?: string;      // Stack trace if available
        retryCount?: number;      // Which retry attempt this was

        // Agent activity (for Claude Code-like UI)
        toolName?: string;        // e.g., 'Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'
        toolInput?: Record<string, any>;  // Tool parameters
        toolOutput?: string;      // Tool result (truncated if large)
        toolDurationMs?: number;  // How long the tool took

        // File changes
        filePath?: string;
        fileAction?: 'created' | 'modified' | 'deleted';
        diffPreview?: string;     // First N lines of diff

        // Terminal output
        command?: string;
        exitCode?: number;
        stdout?: string;          // Truncated stdout
        stderr?: string;          // Truncated stderr

        // Turn tracking (for grouping tool calls in UI)
        turnNumber?: number;      // Which turn in the conversation
        turnId?: string;          // Unique ID for this turn (group related tool calls)

        // Trigger source tracking (to detect duplicate triggers)
        triggeredBy?: 'slack' | 'github' | 'web';
    }>(),

    createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type RequestMessage = typeof requestMessages.$inferSelect;
export type NewRequestMessage = typeof requestMessages.$inferInsert;

// ============================================================================
// AUTH SCHEMA - Users, Policies, Sessions (IAM-Style Authorization)
// ============================================================================

// User status enum
export const userStatusEnum = pgEnum('user_status', [
    'active',
    'inactive'
]);

export type UserStatus = 'active' | 'inactive';

// OAuth tokens stored per provider (encrypted)
export interface OAuthTokens {
    [provider: string]: {
        accessTokenEncrypted: string;
        refreshTokenEncrypted?: string;
        expiresAt?: string;  // ISO timestamp
        scope?: string;
    };
}
// Example: { google: { accessTokenEncrypted: '...', refreshTokenEncrypted: '...', expiresAt: '2025-01-21T12:00:00Z' } }

// Users table
export const users = pgTable('users', {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    name: varchar('name', { length: 255 }),
    pictureUrl: text('picture_url'),
    googleId: varchar('google_id', { length: 100 }).unique(),

    // OAuth tokens - supports multiple providers (google, github, etc.)
    oauthTokens: jsonb('oauth_tokens').$type<OAuthTokens>(),

    isSuperAdmin: boolean('is_super_admin').default(false).notNull(),
    status: userStatusEnum('status').default('active').notNull(),
    lastLoginAt: timestamp('last_login_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
    index('user_email_idx').on(table.email),
    index('user_google_id_idx').on(table.googleId),
]);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ============= Policies (IAM-Style) =============

export type PolicyEffect = 'Allow' | 'Deny';

export interface PolicyStatement {
    Sid?: string;           // Statement ID for documentation
    Effect: PolicyEffect;   // "Allow" or "Deny"
    Action: string[];       // Action patterns (supports wildcards)
    Resource: string[];     // Resource patterns (supports wildcards)
}

export interface PolicyDocument {
    Version: string;
    Statement: PolicyStatement[];
}

// Policies table - stores IAM-style policy documents
export const policies = pgTable('policies', {
    id: varchar('id', { length: 50 }).primaryKey(),  // e.g., 'super_admin', 'admin', 'developer'
    name: varchar('name', { length: 255 }).notNull().unique(),
    description: text('description'),
    statements: jsonb('statements').notNull().$type<PolicyDocument>(),
    isBuiltIn: boolean('is_built_in').default(false).notNull(),  // true for default policies
    createdBy: varchar('created_by', { length: 255 }),  // Email of creator
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
    index('policy_name_idx').on(table.name),
]);

export type Policy = typeof policies.$inferSelect;
export type NewPolicy = typeof policies.$inferInsert;

// ============= User Policies (Assignments) =============

// User-to-policy assignments
export const userPolicies = pgTable('user_policies', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    policyId: varchar('policy_id', { length: 50 }).references(() => policies.id, { onDelete: 'cascade' }).notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    expiresAt: timestamp('expires_at'),
    createdBy: varchar('created_by', { length: 255 }),  // Email of who assigned
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
    index('user_policy_user_idx').on(table.userId),
    index('user_policy_policy_idx').on(table.policyId),
    index('user_policy_unique_idx').on(table.userId, table.policyId),
]);

export type UserPolicy = typeof userPolicies.$inferSelect;
export type NewUserPolicy = typeof userPolicies.$inferInsert;

// ============= Policy Versions (Audit Trail) =============

// Tracks all changes to policies for audit purposes
export const policyVersions = pgTable('policy_versions', {
    id: uuid('id').primaryKey().defaultRandom(),
    policyId: varchar('policy_id', { length: 50 }).notNull(),
    versionNumber: integer('version_number').notNull(),
    name: varchar('name', { length: 255 }),
    description: text('description'),
    statements: jsonb('statements').$type<PolicyDocument>(),
    changedBy: varchar('changed_by', { length: 255 }),  // Email
    changeType: varchar('change_type', { length: 50 }),  // 'created', 'updated', 'deleted'
    changeComment: text('change_comment'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
    index('policy_version_idx').on(table.policyId, table.versionNumber),
]);

export type PolicyVersion = typeof policyVersions.$inferSelect;
export type NewPolicyVersion = typeof policyVersions.$inferInsert;

// ============= Sessions =============

// User sessions for JWT token tracking
export const sessions = pgTable('sessions', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
    index('session_user_idx').on(table.userId),
    index('session_token_idx').on(table.tokenHash),
    index('session_expires_idx').on(table.expiresAt),
]);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

// ============= Agent Sessions (ADR-001: Session Blob Persistence) =============

/**
 * Stores agent session blobs for ephemeral container resumption.
 *
 * When a container completes execution, the SDK session file is compressed
 * and stored here. On follow-up requests, the session is restored to the
 * new container allowing full context resumption.
 *
 * Session sizes (after gzip compression):
 * - Typical: 50KB - 500KB
 * - Large: 500KB - 2MB
 * - Very large: 2-4MB (complex multi-file changes)
 */
export const agentSessions = pgTable('agent_sessions', {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    requestId: text('request_id').notNull().references(() => featureRequests.requestId, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),           // SDK session ID (UUID)
    agentType: agentTypeEnum('agent_type').notNull(),  // 'claude-code' | 'opencode'

    // Session data - stored as bytea (binary)
    // Note: Drizzle doesn't have native bytea support, so we use text with base64 encoding
    // The blob is already gzipped and base64-encoded from the container
    sessionBlob: text('session_blob').notNull(),       // Gzipped + base64 encoded session data
    blobSizeBytes: integer('blob_size_bytes').notNull(), // Compressed size for monitoring

    // Metadata
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),  // TTL-based cleanup (default: 7 days)
}, (table) => [
    // Unique index on sessionId (SDK session IDs are globally unique UUIDs)
    unique('agent_sessions_session_id_unique').on(table.sessionId),
    // Index for quick lookup by requestId
    index('agent_sessions_request_id_idx').on(table.requestId),
    // Index for TTL cleanup queries
    index('agent_sessions_expires_at_idx').on(table.expiresAt),
]);

export type AgentSession = typeof agentSessions.$inferSelect;
export type NewAgentSession = typeof agentSessions.$inferInsert;

// ============= Default Policies =============

// Built-in policy documents (for seeding)
export const DEFAULT_POLICIES = {
    super_admin: {
        id: 'super_admin',
        name: 'Super Admin',
        description: 'Full access to all resources and actions',
        isBuiltIn: true,
        statements: {
            Version: '2025-01-01',
            Statement: [
                {
                    Sid: 'AllowEverything',
                    Effect: 'Allow' as PolicyEffect,
                    Action: ['*'],
                    Resource: ['*'],
                },
            ],
        },
    },
    admin: {
        id: 'admin',
        name: 'Admin',
        description: 'Configure access only - setup integrations, manage users and policies',
        isBuiltIn: true,
        statements: {
            Version: '2025-01-01',
            Statement: [
                {
                    Sid: 'AllowConfigureAccess',
                    Effect: 'Allow' as PolicyEffect,
                    Action: ['configure:*'],
                    Resource: ['clarity:config/*'],
                },
            ],
        },
    },
    developer: {
        id: 'developer',
        name: 'Developer',
        description: 'Repository access only - use Clarity AI on repositories (DEFAULT for new users)',
        isBuiltIn: true,
        statements: {
            Version: '2025-01-01',
            Statement: [
                {
                    Sid: 'AllowRepoAccess',
                    Effect: 'Allow' as PolicyEffect,
                    Action: ['repo:*'],
                    Resource: ['clarity:repo/*'],
                },
            ],
        },
    },
};
