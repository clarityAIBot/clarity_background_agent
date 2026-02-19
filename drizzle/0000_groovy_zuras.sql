CREATE TYPE "public"."agent_provider" AS ENUM('anthropic', 'openai', 'google', 'groq', 'deepseek', 'mistral', 'together', 'fireworks');--> statement-breakpoint
CREATE TYPE "public"."agent_type" AS ENUM('claude-code', 'opencode');--> statement-breakpoint
CREATE TYPE "public"."config_type" AS ENUM('github', 'claude', 'slack', 'llm', 'system_defaults');--> statement-breakpoint
CREATE TYPE "public"."message_source" AS ENUM('slack', 'github', 'web', 'system');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('initial_request', 'clarification_ask', 'clarification_answer', 'follow_up_request', 'processing_started', 'processing_update', 'pr_created', 'pr_updated', 'error', 'retry', 'cancelled', 'agent_thinking', 'agent_tool_call', 'agent_tool_result', 'agent_file_change', 'agent_terminal', 'agent_summary');--> statement-breakpoint
CREATE TYPE "public"."request_origin" AS ENUM('slack', 'github_issue', 'web');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('pending', 'issue_created', 'processing', 'awaiting_clarification', 'pr_created', 'completed', 'cancelled', 'error');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'processing', 'completed', 'error');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"request_id" text NOT NULL,
	"session_id" text NOT NULL,
	"agent_type" "agent_type" NOT NULL,
	"session_blob" text NOT NULL,
	"blob_size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "agent_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "app_config" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app_config_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" "config_type" NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_config_type_unique" UNIQUE("type")
);
--> statement-breakpoint
CREATE TABLE "feature_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "feature_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"request_id" text NOT NULL,
	"origin" "request_origin" NOT NULL,
	"repo" text NOT NULL,
	"title" text,
	"description" text NOT NULL,
	"request_type" text,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"slack_user_id" text,
	"slack_user_name" text,
	"slack_channel_id" text,
	"slack_channel_name" text,
	"slack_thread_ts" text,
	"slack_trigger_message_ts" text,
	"response_url" text,
	"issue_id" bigint,
	"issue_number" integer,
	"issue_title" text,
	"issue_body" text,
	"issue_labels" jsonb,
	"issue_author" text,
	"issue_url" text,
	"web_user_id" text,
	"web_user_email" text,
	"repository_url" text,
	"repository_name" text,
	"repository_id" integer,
	"repository_owner" text,
	"repository_name_only" text,
	"app_id" text,
	"task_status" "task_status" DEFAULT 'pending',
	"pr_url" text,
	"pr_number" integer,
	"pr_branch_name" text,
	"retry_count" integer DEFAULT 0,
	"last_retry_at" timestamp,
	"agent_type" "agent_type" DEFAULT 'claude-code',
	"agent_provider" "agent_provider" DEFAULT 'anthropic',
	"agent_model" text,
	"agent_session_id" text,
	"cost_usd" integer,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	CONSTRAINT "feature_requests_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "feature_requests_issue_id_unique" UNIQUE("issue_id")
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"statements" jsonb NOT NULL,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"created_by" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "policies_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" varchar(50) NOT NULL,
	"version_number" integer NOT NULL,
	"name" varchar(255),
	"description" text,
	"statements" jsonb,
	"changed_by" varchar(255),
	"change_type" varchar(50),
	"change_comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "request_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"request_id" text NOT NULL,
	"type" "message_type" NOT NULL,
	"source" "message_source" NOT NULL,
	"content" text NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"policy_id" varchar(50) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp,
	"created_by" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"picture_url" text,
	"google_id" varchar(100),
	"oauth_tokens" jsonb,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_request_id_feature_requests_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."feature_requests"("request_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_messages" ADD CONSTRAINT "request_messages_request_id_feature_requests_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."feature_requests"("request_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_policies" ADD CONSTRAINT "user_policies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_policies" ADD CONSTRAINT "user_policies_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_sessions_request_id_idx" ON "agent_sessions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "agent_sessions_expires_at_idx" ON "agent_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "policy_name_idx" ON "policies" USING btree ("name");--> statement-breakpoint
CREATE INDEX "policy_version_idx" ON "policy_versions" USING btree ("policy_id","version_number");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_token_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "session_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "user_policy_user_idx" ON "user_policies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_policy_policy_idx" ON "user_policies" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "user_policy_unique_idx" ON "user_policies" USING btree ("user_id","policy_id");--> statement-breakpoint
CREATE INDEX "user_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "user_google_id_idx" ON "users" USING btree ("google_id");