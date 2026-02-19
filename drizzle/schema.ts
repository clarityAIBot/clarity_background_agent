import { pgTable, unique, integer, jsonb, timestamp, text, bigint, foreignKey, index, uuid, varchar, boolean, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const agentProvider = pgEnum("agent_provider", ['anthropic', 'openai', 'google', 'groq', 'deepseek', 'mistral', 'together', 'fireworks'])
export const agentType = pgEnum("agent_type", ['claude-code', 'opencode'])
export const configType = pgEnum("config_type", ['github', 'claude', 'slack', 'llm', 'system_defaults'])
export const messageSource = pgEnum("message_source", ['slack', 'github', 'web', 'system'])
export const messageType = pgEnum("message_type", ['initial_request', 'clarification_ask', 'clarification_answer', 'follow_up_request', 'processing_started', 'processing_update', 'pr_created', 'pr_updated', 'error', 'retry', 'cancelled', 'agent_thinking', 'agent_tool_call', 'agent_tool_result', 'agent_file_change', 'agent_terminal', 'agent_summary'])
export const requestOrigin = pgEnum("request_origin", ['slack', 'github_issue', 'web'])
export const requestStatus = pgEnum("request_status", ['pending', 'issue_created', 'processing', 'awaiting_clarification', 'pr_created', 'completed', 'cancelled', 'error'])
export const taskStatus = pgEnum("task_status", ['pending', 'processing', 'completed', 'error'])
export const userStatus = pgEnum("user_status", ['active', 'inactive'])


export const appConfig = pgTable("app_config", {
	id: integer().primaryKey().generatedAlwaysAsIdentity({ name: "app_config_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	type: configType().notNull(),
	config: jsonb().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("app_config_type_unique").on(table.type),
]);

export const featureRequests = pgTable("feature_requests", {
	id: integer().primaryKey().generatedAlwaysAsIdentity({ name: "feature_requests_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	requestId: text("request_id").notNull(),
	origin: requestOrigin().notNull(),
	repo: text().notNull(),
	title: text(),
	description: text().notNull(),
	requestType: text("request_type"),
	status: requestStatus().default('pending').notNull(),
	slackUserId: text("slack_user_id"),
	slackUserName: text("slack_user_name"),
	slackChannelId: text("slack_channel_id"),
	slackChannelName: text("slack_channel_name"),
	slackThreadTs: text("slack_thread_ts"),
	responseUrl: text("response_url"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	issueId: bigint("issue_id", { mode: "number" }),
	issueNumber: integer("issue_number"),
	issueTitle: text("issue_title"),
	issueBody: text("issue_body"),
	issueLabels: jsonb("issue_labels"),
	issueAuthor: text("issue_author"),
	issueUrl: text("issue_url"),
	webUserId: text("web_user_id"),
	webUserEmail: text("web_user_email"),
	repositoryUrl: text("repository_url"),
	repositoryName: text("repository_name"),
	repositoryId: integer("repository_id"),
	repositoryOwner: text("repository_owner"),
	repositoryNameOnly: text("repository_name_only"),
	appId: text("app_id"),
	taskStatus: taskStatus("task_status").default('pending'),
	prUrl: text("pr_url"),
	prNumber: integer("pr_number"),
	prBranchName: text("pr_branch_name"),
	retryCount: integer("retry_count").default(0),
	lastRetryAt: timestamp("last_retry_at", { mode: 'string' }),
	costUsd: integer("cost_usd"),
	durationMs: integer("duration_ms"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	processedAt: timestamp("processed_at", { mode: 'string' }),
	agentType: agentType("agent_type").default('claude-code'),
	agentProvider: agentProvider("agent_provider").default('anthropic'),
	agentModel: text("agent_model"),
	agentSessionId: text("agent_session_id"),
	slackTriggerMessageTs: text("slack_trigger_message_ts"),
}, (table) => [
	unique("feature_requests_request_id_unique").on(table.requestId),
	unique("feature_requests_issue_id_unique").on(table.issueId),
]);

export const requestMessages = pgTable("request_messages", {
	id: integer().primaryKey().generatedAlwaysAsIdentity({ name: "request_messages_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	requestId: text("request_id").notNull(),
	type: messageType().notNull(),
	source: messageSource().notNull(),
	content: text().notNull(),
	actorId: text("actor_id"),
	actorName: text("actor_name"),
	metadata: jsonb(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.requestId],
			foreignColumns: [featureRequests.requestId],
			name: "request_messages_request_id_feature_requests_request_id_fk"
		}),
]);

export const userPolicies = pgTable("user_policies", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	policyId: varchar("policy_id", { length: 50 }).notNull(),
	enabled: boolean().default(true).notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }),
	createdBy: varchar("created_by", { length: 255 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("user_policy_policy_idx").using("btree", table.policyId.asc().nullsLast().op("text_ops")),
	index("user_policy_unique_idx").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.policyId.asc().nullsLast().op("uuid_ops")),
	index("user_policy_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.policyId],
			foreignColumns: [policies.id],
			name: "user_policies_policy_id_policies_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_policies_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const policyVersions = pgTable("policy_versions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	policyId: varchar("policy_id", { length: 50 }).notNull(),
	versionNumber: integer("version_number").notNull(),
	name: varchar({ length: 255 }),
	description: text(),
	statements: jsonb(),
	changedBy: varchar("changed_by", { length: 255 }),
	changeType: varchar("change_type", { length: 50 }),
	changeComment: text("change_comment"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("policy_version_idx").using("btree", table.policyId.asc().nullsLast().op("int4_ops"), table.versionNumber.asc().nullsLast().op("int4_ops")),
]);

export const policies = pgTable("policies", {
	id: varchar({ length: 50 }).primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	description: text(),
	statements: jsonb().notNull(),
	isBuiltIn: boolean("is_built_in").default(false).notNull(),
	createdBy: varchar("created_by", { length: 255 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("policy_name_idx").using("btree", table.name.asc().nullsLast().op("text_ops")),
	unique("policies_name_unique").on(table.name),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: varchar({ length: 255 }).notNull(),
	name: varchar({ length: 255 }),
	pictureUrl: text("picture_url"),
	googleId: varchar("google_id", { length: 100 }),
	oauthTokens: jsonb("oauth_tokens"),
	isSuperAdmin: boolean("is_super_admin").default(false).notNull(),
	status: userStatus().default('active').notNull(),
	lastLoginAt: timestamp("last_login_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("user_email_idx").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("user_google_id_idx").using("btree", table.googleId.asc().nullsLast().op("text_ops")),
	unique("users_email_unique").on(table.email),
	unique("users_google_id_unique").on(table.googleId),
]);

export const sessions = pgTable("sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	tokenHash: varchar("token_hash", { length: 64 }).notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	ipAddress: varchar("ip_address", { length: 45 }),
	userAgent: text("user_agent"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("session_expires_idx").using("btree", table.expiresAt.asc().nullsLast().op("timestamp_ops")),
	index("session_token_idx").using("btree", table.tokenHash.asc().nullsLast().op("text_ops")),
	index("session_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "sessions_user_id_users_id_fk"
		}).onDelete("cascade"),
]);

export const agentSessions = pgTable("agent_sessions", {
	id: integer().primaryKey().generatedAlwaysAsIdentity({ name: "agent_sessions_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	requestId: text("request_id").notNull(),
	sessionId: text("session_id").notNull(),
	agentType: agentType("agent_type").notNull(),
	sessionBlob: text("session_blob").notNull(),
	blobSizeBytes: integer("blob_size_bytes").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("agent_sessions_expires_at_idx").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")),
	index("agent_sessions_request_id_idx").using("btree", table.requestId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.requestId],
			foreignColumns: [featureRequests.requestId],
			name: "agent_sessions_request_id_feature_requests_request_id_fk"
		}).onDelete("cascade"),
	unique("agent_sessions_session_id_unique").on(table.sessionId),
]);
