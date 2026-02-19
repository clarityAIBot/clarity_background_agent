# ADR-003: Migrate from Durable Objects to PostgreSQL with Drizzle ORM

**Status**: Completed
**Date**: 2026-01-13
**Last Updated**: 2026-01-14
**Author**: Engineering Team

## Context

### Current State

Clarity AI currently uses Cloudflare Durable Objects with embedded SQLite for persistent storage. There are two main Durable Object classes:

1. **GitHubAppConfigDO** - Stores:
   - GitHub App configuration (app_id, private_key, webhook_secret, installation_id)
   - Installation tokens with expiry
   - Claude API key configuration
   - Slack configuration (signing_secret, bot_token)
   - Issue-request mappings for tracking
   - Slack thread mappings for reply tracking
   - Request history with status

2. **FeatureRequestDO** - Stores per-request state:
   - Request metadata (requestId, repo, description)
   - Slack context (userId, channelId, threadTs)
   - GitHub issue details (issueNumber, issueUrl, labels)
   - Processing status and errors
   - PR details when created

### Problems with Current Approach

1. **Data Isolation**: Each Durable Object instance has its own isolated SQLite database
   - `FeatureRequestDO` creates one instance per request (keyed by requestId)
   - Cross-request queries are impossible without iterating all instances
   - Dashboard/reporting requires complex aggregation logic

2. **Schema Management**: Manual migrations with try/catch blocks
   ```typescript
   try {
     this.storage.sql.exec('ALTER TABLE ... ADD COLUMN ...');
   } catch (e) { /* Ignore if column exists */ }
   ```

3. **No Type Safety**: Raw SQL strings with manual type casting
   ```typescript
   const row = results[0];
   this.data = {
     requestId: row.request_id as string,
     issueNumber: (row.issue_number as number) || undefined,
     // ... 30+ more fields with manual casting
   };
   ```

4. **Limited Query Capabilities**:
   - No JOINs across Durable Object instances
   - No complex aggregations for analytics
   - No full-text search

5. **Cost at Scale**: Each Durable Object instance has compute and storage costs
   - Currently ~50-100 requests/day = 50-100 DO instances created
   - No instance cleanup/garbage collection

6. **Testing Difficulty**: Durable Objects require Miniflare or deployed environment

### Business Drivers

- Need for analytics dashboard showing request metrics, success rates, costs
- Future multi-tenant support requires proper relational data model
- Better debugging with proper database inspection tools
- Simplified backup and disaster recovery

## Decision

Migrate from Cloudflare Durable Objects to **PostgreSQL** (hosted on PlanetScale) with **Drizzle ORM** for type-safe database access.

### Why PostgreSQL with PlanetScale

- Industry-standard relational database with mature tooling
- Native support for JSON columns for flexible schema evolution
- PlanetScale's serverless PostgreSQL with horizontal scaling
- Database branching for safe schema changes and dev/staging environments
- Full SQL capabilities including JOINs, aggregations, CTEs
- Can be accessed from both Cloudflare Workers and Containers

### Cloudflare Hyperdrive Integration

We use **Cloudflare Hyperdrive** to connect Workers to PlanetScale PostgreSQL for:
- Connection pooling at the edge (reduces cold start latency)
- Automatic connection caching and reuse
- Regional routing to nearest database replica

```
┌─────────────────┐      HTTP API       ┌─────────────────┐    Hyperdrive     ┌─────────────────┐
│    Container    │ ─────────────────▶  │     Worker      │ ───────────────▶  │   PostgreSQL    │
│  (Claude Code)  │                     │   (Hono API)    │   (connection     │  (PlanetScale)  │
└─────────────────┘                     └─────────────────┘    pooling)        └─────────────────┘
```

**Setup:**
```bash
# Create Hyperdrive instance
npx wrangler hyperdrive create clarity-db \
  --connection-string="postgres://user:password@host:5432/clarity"
```

**wrangler.jsonc configuration:**
```jsonc
{
  "compatibility_flags": ["nodejs_compat"],
  "compatibility_date": "2024-09-23",
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "<hyperdrive-id>"
    }
  ]
}
```

**Database client with Hyperdrive:**
```typescript
// src/db/client.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export function getDb(env: { HYPERDRIVE: Hyperdrive }) {
  const pool = new Pool({
    connectionString: env.HYPERDRIVE.connectionString,
  });
  return drizzle(pool, { schema });
}
```

### Architecture: API-Only Access from Containers

Containers will **NOT** have direct database access. Instead, they communicate with the database exclusively through the Worker API:

```
┌─────────────────┐      HTTP API       ┌─────────────────┐    Hyperdrive     ┌─────────────────┐
│    Container    │ ─────────────────▶  │     Worker      │ ───────────────▶  │   PostgreSQL    │
│  (Claude Code)  │                     │   (Hono API)    │                   │  (PlanetScale)  │
└─────────────────┘                     └─────────────────┘                   └─────────────────┘
```

**Rationale:**
1. **Security**: Database credentials only exist in Worker secrets, not in container environment
2. **Centralized Logic**: All data validation, business rules, and transformations happen in one place
3. **Rate Limiting**: Worker can enforce rate limits and quotas on database operations
4. **Audit Trail**: All database mutations go through a single entry point for logging
5. **Simpler Container**: Container only needs to call HTTP endpoints, no database driver required

**Container API Endpoints:**
- `POST /api/requests` - Create new feature request
- `PATCH /api/requests/:id/status` - Update request status
- `POST /api/requests/:id/messages` - Add message to thread
- `GET /api/requests/:id` - Get request details
- `GET /api/config/github` - Get GitHub config (tokens)
- `GET /api/config/claude` - Get Claude API key

### Why Drizzle ORM

- TypeScript-first with excellent type inference
- Lightweight (~7kb) compared to Prisma (~2MB)
- Works in edge environments (Cloudflare Workers)
- SQL-like syntax that's familiar to developers
- Automatic migrations with `drizzle-kit`

### Database Schema Design

```typescript
// schema.ts
import { pgTable, text, integer, timestamp, boolean, jsonb, pgEnum } from 'drizzle-orm/pg-core';

// Enums
export const requestStatusEnum = pgEnum('request_status', [
  'pending',
  'issue_created',
  'processing',
  'awaiting_clarification',
  'pr_created',
  'completed',
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
  'slack'
]);

// TypeScript types for typed JSONB columns
interface GitHubConfig {
  appId: string;
  privateKeyEncrypted: string;
  webhookSecretEncrypted: string;
  installationId: string;
  ownerLogin: string;
  ownerType: string;
  ownerId: number;
  permissions: Record<string, string>;
  events: string[];
  repositories: Array<{ id: number; name: string; fullName: string }>;
  webhookCount: number;
  lastWebhookAt?: string;
  setupAt?: string;
  // Cached installation token (expires ~1 hour)
  installationToken?: string;
  tokenExpiresAt?: string;
}

interface ClaudeConfig {
  apiKeyEncrypted: string;
  setupAt?: string;
}

interface SlackConfig {
  signingSecretEncrypted: string;
  botTokenEncrypted: string;
  setupAt?: string;
}

// Union type for all config types
type ConfigData = GitHubConfig | ClaudeConfig | SlackConfig;

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
  responseUrl: text('response_url'),

  // GitHub issue details (populated when origin='github_issue')
  issueId: integer('issue_id').unique(), // Unique - one request per issue
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

  // Cost tracking
  costUsd: integer('cost_usd'), // stored as cents
  durationMs: integer('duration_ms'),

  // Timestamps
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  processedAt: timestamp('processed_at'),
});

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

// Message source enum
export const messageSourceEnum = pgEnum('message_source', [
  'slack',
  'github',
  'web',     // UI dashboard
  'system'
]);

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
  }>(),

  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Indexes for common queries
// - app_config: type (unique)
// - featureRequests: status, slackChannelId, issueNumber+repositoryName
// - requestMessages: requestId, createdAt (for thread retrieval)
```

### Implementation Approach

#### Phase 1: Setup and Parallel Write (Week 1)

1. Set up PostgreSQL database (Neon serverless recommended)
2. Install Drizzle ORM and configure
3. Define schema with proper types
4. Create migration from current DO schema
5. Implement parallel write: write to both DO and PostgreSQL
6. Add feature flag to control migration

#### Phase 2: Read Migration (Week 2)

1. Implement read-through caching from PostgreSQL
2. Add fallback to Durable Objects for missing data
3. Monitor query performance and optimize indexes
4. Validate data consistency between DO and PostgreSQL

#### Phase 3: Cutover and Cleanup (Week 3)

1. Switch primary reads to PostgreSQL
2. Remove Durable Object writes (except for compatibility)
3. Deprecate DO classes
4. Update wrangler.jsonc to remove DO bindings
5. Clean up migration code and feature flags

## Consequences

### Positive

1. **Type-Safe Queries**: Full TypeScript inference for all database operations
   ```typescript
   const request = await db.query.featureRequests.findFirst({
     where: eq(featureRequests.requestId, id)
   });
   // request is fully typed
   ```

2. **Cross-Request Analytics**: Query across all requests
   ```typescript
   const stats = await db
     .select({
       status: featureRequests.status,
       count: count(),
       avgCost: avg(featureRequests.costUsd),
     })
     .from(featureRequests)
     .where(gte(featureRequests.createdAt, lastWeek))
     .groupBy(featureRequests.status);
   ```

3. **Automatic Migrations**: Drizzle-kit generates and applies migrations
   ```bash
   npx drizzle-kit generate
   npx drizzle-kit migrate
   ```

4. **Standard Database Tooling**: Use pgAdmin, DBeaver, or any SQL client for debugging

5. **Improved Observability**: Database metrics, query logs, slow query analysis

6. **Cost Predictability**: Fixed database cost vs. per-instance DO costs

7. **Multi-Region Support**: PostgreSQL providers offer global read replicas

### Negative

1. **Additional Infrastructure**: External database dependency (vs. built-in DO storage)

2. **Network Latency**: Database calls add network round-trip (~20-50ms to Neon)
   - Mitigation: Connection pooling, edge caching for config data

3. **Cold Start Impact**: Database connection establishment on first request
   - Mitigation: Neon serverless has <100ms cold starts

4. **Secrets Management**: Database credentials need secure storage
   - Store in Cloudflare secrets, not environment variables

5. **Migration Complexity**: Need careful data migration to avoid data loss

### Neutral

1. **Learning Curve**: Team needs to learn Drizzle ORM syntax
2. **Different Testing Approach**: Use test database instead of Miniflare
3. **Backup Strategy Change**: Rely on provider backups vs. DO durability

## Alternatives Considered

### Option 1: Cloudflare D1 (SQLite at the Edge)

**Description**: Use Cloudflare's managed D1 database, which provides SQLite at the edge with automatic replication.

**Pros:**
- Native Cloudflare integration
- Low latency (edge-deployed)
- Simple pricing model
- No external dependencies

**Cons:**
- Still in beta with limitations
- 10GB max database size
- Limited query capabilities vs. PostgreSQL
- No native ORM support as mature as Drizzle/PostgreSQL

**Why not chosen**: D1 is promising but still maturing. PostgreSQL offers better query capabilities and Drizzle support.

### Option 2: Keep Durable Objects with Refactoring

**Description**: Refactor current DO implementation to use a central "index" DO that tracks all requests.

**Pros:**
- No new infrastructure
- Keep existing investment
- Native Cloudflare primitives

**Cons:**
- Still limited query capabilities
- Complex cross-DO coordination
- Doesn't solve type safety issues
- Scaling challenges remain

**Why not chosen**: Doesn't address fundamental limitations of DO SQLite for relational data.

### Option 3: Turso (libSQL)

**Description**: Use Turso's globally distributed SQLite database.

**Pros:**
- SQLite compatibility
- Edge replication
- Good Drizzle support

**Cons:**
- Smaller ecosystem than PostgreSQL
- Limited advanced query features
- Less mature tooling

**Why not chosen**: PostgreSQL ecosystem is more mature and team has more experience with it.

### Option 4: PlanetScale (MySQL)

**Description**: Use PlanetScale's serverless MySQL platform.

**Pros:**
- Excellent serverless support
- Database branching for dev/staging
- Good Drizzle support

**Cons:**
- MySQL vs. PostgreSQL (less JSON support)
- Pricing changes made it less attractive
- Foreign keys require workarounds

**Why not chosen**: PostgreSQL has better JSON column support which is useful for flexible schema.

## Implementation Plan

### Phase 1: Infrastructure Setup (3 days)

1. **Day 1**: Create Neon project and configure
   - Set up production and development databases
   - Configure connection pooling
   - Store credentials in Cloudflare secrets

2. **Day 2**: Install and configure Drizzle
   ```bash
   npm install drizzle-orm @neondatabase/serverless
   npm install -D drizzle-kit
   ```
   - Create `drizzle.config.ts`
   - Define schema in `src/db/schema.ts`
   - Generate initial migration

3. **Day 3**: Create database access layer
   - Create `src/db/client.ts` with connection management
   - Implement repository pattern for each entity
   - Add logging and error handling

### Phase 2: Parallel Write Implementation (4 days)

1. **Day 4-5**: Implement dual-write for `FeatureRequestDO`
   - Create `FeatureRequestRepository` class
   - Update all write paths to write to both DO and PostgreSQL
   - Add feature flag `USE_POSTGRES` to control behavior

2. **Day 6-7**: Implement dual-write for `GitHubAppConfigDO`
   - Create repositories for config tables
   - Update configuration endpoints
   - Test credential encryption/decryption

3. **Day 7.5**: Backfill App Config tables
   - Create script to read `GitHubAppConfigDO` (id=1) and write to PostgreSQL
   - Verify `app_config` rows (GitHub, Claude, Slack) are populated correctly
   - Verify `installation_tokens` are migrated
   - This ensures keys are available before switching any read traffic

### Phase 3: Read Migration (3 days)

1. **Day 8**: Implement PostgreSQL reads with DO fallback
   ```typescript
   async function getFeatureRequest(requestId: string) {
     // Try PostgreSQL first
     const pgResult = await db.query.featureRequests.findFirst({
       where: eq(featureRequests.requestId, requestId)
     });
     if (pgResult) return pgResult;

     // Fallback to DO
     const doResult = await getDOFeatureRequest(requestId);
     if (doResult) {
       // Backfill to PostgreSQL
       await db.insert(featureRequests).values(doResult);
     }
     return doResult;
   }
   ```

2. **Day 9**: Data validation and consistency checks
   - Compare DO data with PostgreSQL data
   - Fix any discrepancies
   - Add monitoring alerts

3. **Day 10**: Switch primary reads to PostgreSQL
   - Update feature flag
   - Monitor error rates
   - Keep DO as backup

### Phase 4: Cleanup (2 days)

1. **Day 11**: Remove dual-write code
   - Remove DO write paths
   - Remove fallback logic
   - Clean up feature flags

2. **Day 12**: Final cleanup
   - Update documentation
   - Remove DO bindings from wrangler.jsonc
   - Archive DO-related code

## Code Examples

### Database Client Setup

```typescript
// src/db/client.ts
import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool } from '@neondatabase/serverless';
import * as schema from './schema';

let pool: Pool | null = null;

export function getDb(env: { DATABASE_URL: string }) {
  if (!pool) {
    pool = new Pool({ connectionString: env.DATABASE_URL });
  }
  return drizzle(pool, { schema });
}
```

### Repository Pattern

```typescript
// src/db/repositories/app-config.ts
import { eq } from 'drizzle-orm';
import { appConfig, type GitHubConfig, type ClaudeConfig, type SlackConfig } from '../schema';
import type { DrizzleDb } from '../client';

export class AppConfigRepository {
  constructor(private db: DrizzleDb) {}

  async getGitHubConfig(): Promise<GitHubConfig | null> {
    const result = await this.db.query.appConfig.findFirst({
      where: eq(appConfig.type, 'github'),
    });
    return result?.config as GitHubConfig ?? null;
  }

  async setGitHubConfig(config: GitHubConfig) {
    await this.db
      .insert(appConfig)
      .values({ type: 'github', config })
      .onConflictDoUpdate({
        target: appConfig.type,
        set: { config, updatedAt: new Date() },
      });
  }

  async updateGitHubToken(token: string, expiresAt: string) {
    const current = await this.getGitHubConfig();
    if (!current) throw new Error('GitHub config not found');

    await this.setGitHubConfig({
      ...current,
      installationToken: token,
      tokenExpiresAt: expiresAt,
    });
  }

  async getClaudeConfig(): Promise<ClaudeConfig | null> {
    const result = await this.db.query.appConfig.findFirst({
      where: eq(appConfig.type, 'claude'),
    });
    return result?.config as ClaudeConfig ?? null;
  }

  async getSlackConfig(): Promise<SlackConfig | null> {
    const result = await this.db.query.appConfig.findFirst({
      where: eq(appConfig.type, 'slack'),
    });
    return result?.config as SlackConfig ?? null;
  }
}

// src/db/repositories/feature-request.ts
import { eq, gte, count, avg, sum } from 'drizzle-orm';
import { featureRequests, type FeatureRequest } from '../schema';
import type { DrizzleDb } from '../client';

export class FeatureRequestRepository {
  constructor(private db: DrizzleDb) {}

  async findByRequestId(requestId: string): Promise<FeatureRequest | null> {
    const result = await this.db.query.featureRequests.findFirst({
      where: eq(featureRequests.requestId, requestId),
    });
    return result ?? null;
  }

  async create(data: Omit<FeatureRequest, 'id' | 'createdAt' | 'updatedAt'>) {
    const [result] = await this.db
      .insert(featureRequests)
      .values(data)
      .returning();
    return result;
  }

  async updateStatus(requestId: string, status: string, updates: Partial<FeatureRequest> = {}) {
    await this.db
      .update(featureRequests)
      .set({ status, ...updates, updatedAt: new Date() })
      .where(eq(featureRequests.requestId, requestId));
  }

  async getRecentRequests(limit: number = 50) {
    return this.db.query.featureRequests.findMany({
      orderBy: (requests, { desc }) => [desc(requests.createdAt)],
      limit,
    });
  }

  async getRequestStats(since: Date) {
    return this.db
      .select({
        status: featureRequests.status,
        count: count(),
        avgDurationMs: avg(featureRequests.durationMs),
        totalCostCents: sum(featureRequests.costUsd),
      })
      .from(featureRequests)
      .where(gte(featureRequests.createdAt, since))
      .groupBy(featureRequests.status);
  }
}

// src/db/repositories/request-messages.ts
import { eq, asc } from 'drizzle-orm';
import { requestMessages, type MessageType, type MessageSource } from '../schema';
import type { DrizzleDb } from '../client';

export class RequestMessagesRepository {
  constructor(private db: DrizzleDb) {}

  async getThread(requestId: string) {
    return this.db.query.requestMessages.findMany({
      where: eq(requestMessages.requestId, requestId),
      orderBy: [asc(requestMessages.createdAt)],
    });
  }

  async addMessage(data: {
    requestId: string;
    type: MessageType;
    source: MessageSource;
    content: string;
    actorId?: string;
    actorName?: string;
    metadata?: Record<string, any>;
  }) {
    const [result] = await this.db
      .insert(requestMessages)
      .values(data)
      .returning();
    return result;
  }

  async addClarificationAsk(requestId: string, questions: string, slackThreadTs?: string) {
    return this.addMessage({
      requestId,
      type: 'clarification_ask',
      source: 'system',
      content: questions,
      actorId: 'system',
      actorName: 'Clarity AI',
      metadata: slackThreadTs ? { slackThreadTs } : undefined,
    });
  }

  async addClarificationAnswer(
    requestId: string,
    answer: string,
    actor: { id: string; name: string },
    source: 'slack' | 'github',
    metadata?: Record<string, any>
  ) {
    return this.addMessage({
      requestId,
      type: 'clarification_answer',
      source,
      content: answer,
      actorId: actor.id,
      actorName: actor.name,
      metadata,
    });
  }

  async addFollowUpRequest(
    requestId: string,
    description: string,
    actor: { id: string; name: string }
  ) {
    return this.addMessage({
      requestId,
      type: 'follow_up_request',
      source: 'slack',
      content: description,
      actorId: actor.id,
      actorName: actor.name,
    });
  }

  async addPRCreated(requestId: string, durationMs: number, costCents: number) {
    return this.addMessage({
      requestId,
      type: 'pr_created',
      source: 'system',
      content: 'Pull Request created',
      actorId: 'system',
      actorName: 'Clarity AI',
      metadata: { durationMs, costCents },
    });
  }

  async addPRUpdated(requestId: string, commitSha: string, durationMs: number, costCents: number) {
    return this.addMessage({
      requestId,
      type: 'pr_updated',
      source: 'system',
      content: 'Pull Request updated',
      actorId: 'system',
      actorName: 'Clarity AI',
      metadata: { commitSha, durationMs, costCents },
    });
  }

  async addError(requestId: string, errorCode: string, errorMessage: string, errorStack?: string) {
    return this.addMessage({
      requestId,
      type: 'error',
      source: 'system',
      content: errorMessage,
      actorId: 'system',
      actorName: 'Clarity AI',
      metadata: { errorCode, errorMessage, errorStack },
    });
  }

  async addRetry(requestId: string, retryCount: number, triggeredBy: { id: string; name: string }) {
    return this.addMessage({
      requestId,
      type: 'retry',
      source: 'slack',
      content: `Retry attempt #${retryCount}`,
      actorId: triggeredBy.id,
      actorName: triggeredBy.name,
      metadata: { retryCount },
    });
  }

  // Calculate total cost/duration by summing all messages for a request
  async getTotalMetrics(requestId: string) {
    const messages = await this.getThread(requestId);
    let totalDurationMs = 0;
    let totalCostCents = 0;

    for (const msg of messages) {
      if (msg.metadata) {
        totalDurationMs += msg.metadata.durationMs || 0;
        totalCostCents += msg.metadata.costCents || 0;
      }
    }

    return { totalDurationMs, totalCostCents };
  }

  // Agent activity tracking (for Claude Code-like UI)
  async addAgentThinking(requestId: string, thinking: string, turnId: string, turnNumber: number) {
    return this.addMessage({
      requestId,
      type: 'agent_thinking',
      source: 'system',
      content: thinking,
      actorId: 'system',
      actorName: 'Clarity AI',
      metadata: { turnId, turnNumber },
    });
  }

  async addAgentToolCall(
    requestId: string,
    toolName: string,
    toolInput: Record<string, any>,
    turnId: string,
    turnNumber: number
  ) {
    return this.addMessage({
      requestId,
      type: 'agent_tool_call',
      source: 'system',
      content: `Calling ${toolName}`,
      actorId: 'system',
      actorName: 'Clarity AI',
      metadata: { toolName, toolInput, turnId, turnNumber },
    });
  }

  async addAgentToolResult(
    requestId: string,
    toolName: string,
    toolOutput: string,
    toolDurationMs: number,
    turnId: string
  ) {
    return this.addMessage({
      requestId,
      type: 'agent_tool_result',
      source: 'system',
      content: toolOutput.substring(0, 500), // Truncate for display
      actorId: 'system',
      actorName: 'Clarity AI',
      metadata: { toolName, toolOutput, toolDurationMs, turnId },
    });
  }

  async addAgentFileChange(
    requestId: string,
    filePath: string,
    fileAction: 'created' | 'modified' | 'deleted',
    diffPreview?: string
  ) {
    return this.addMessage({
      requestId,
      type: 'agent_file_change',
      source: 'system',
      content: `${fileAction} ${filePath}`,
      actorId: 'system',
      actorName: 'Clarity AI',
      metadata: { filePath, fileAction, diffPreview },
    });
  }

  async addAgentTerminal(
    requestId: string,
    command: string,
    exitCode: number,
    stdout?: string,
    stderr?: string
  ) {
    return this.addMessage({
      requestId,
      type: 'agent_terminal',
      source: 'system',
      content: command,
      actorId: 'system',
      actorName: 'Clarity AI',
      metadata: { command, exitCode, stdout, stderr },
    });
  }

  async addAgentSummary(requestId: string, summary: string, durationMs: number, costCents: number) {
    return this.addMessage({
      requestId,
      type: 'agent_summary',
      source: 'system',
      content: summary,
      actorId: 'system',
      actorName: 'Clarity AI',
      metadata: { durationMs, costCents },
    });
  }

  // Get agent activity for UI display (grouped by turn)
  async getAgentActivity(requestId: string) {
    const messages = await this.getThread(requestId);
    const agentTypes = [
      'agent_thinking', 'agent_tool_call', 'agent_tool_result',
      'agent_file_change', 'agent_terminal', 'agent_summary'
    ];

    const agentMessages = messages.filter(m => agentTypes.includes(m.type));

    // Group by turnId for UI display
    const turns = new Map<string, typeof agentMessages>();
    for (const msg of agentMessages) {
      const turnId = msg.metadata?.turnId || 'unknown';
      if (!turns.has(turnId)) {
        turns.set(turnId, []);
      }
      turns.get(turnId)!.push(msg);
    }

    return {
      messages: agentMessages,
      turns: Object.fromEntries(turns),
      totalTurns: turns.size,
    };
  }
}
```

### Migration from DO Handler

```typescript
// Before (Durable Object)
if (url.pathname === '/store' && request.method === 'POST') {
  const data = await request.json() as FeatureRequest;
  await this.storeRequest(data);
  return new Response('OK');
}

// After (PostgreSQL with Drizzle)
app.post('/api/feature-requests', async (c) => {
  const data = await c.req.json<CreateFeatureRequestInput>();
  const repo = new FeatureRequestRepository(getDb(c.env));
  const result = await repo.create(data);
  return c.json(result, 201);
});
```

## Entity Relationships

```
┌─────────────────────────────────────────────────────────────────────┐
│                         app_config                                  │
│                   (one row per config type)                         │
├─────────────────────────────────────────────────────────────────────┤
│  id          │ integer PK (auto-increment)                          │
│  type        │ enum ('github', 'claude', 'slack') - UNIQUE          │
│  config      │ jsonb - typed based on 'type'                        │
│  createdAt   │ timestamp                                            │
│  updatedAt   │ timestamp                                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  type='github' → config: GitHubConfig                               │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  appId: string                                              │    │
│  │  privateKeyEncrypted: string                                │    │
│  │  webhookSecretEncrypted: string                             │    │
│  │  installationId: string                                     │    │
│  │  ownerLogin: string                                         │    │
│  │  ownerType: string                                          │    │
│  │  ownerId: number                                            │    │
│  │  permissions: Record<string, string>                        │    │
│  │  events: string[]                                           │    │
│  │  repositories: Array<{id, name, fullName}>                  │    │
│  │  webhookCount: number                                       │    │
│  │  lastWebhookAt?: string                                     │    │
│  │  setupAt?: string                                           │    │
│  │  installationToken?: string  ◄── cached (~1hr TTL)          │    │
│  │  tokenExpiresAt?: string                                    │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  type='claude' → config: ClaudeConfig                               │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  apiKeyEncrypted: string                                    │    │
│  │  setupAt?: string                                           │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  type='slack' → config: SlackConfig                                 │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  signingSecretEncrypted: string                             │    │
│  │  botTokenEncrypted: string                                  │    │
│  │  setupAt?: string                                           │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────┐
│                feature_requests                   │ (one row per request)
├───────────────────────────────────────────────────┤
│  Identity:                                        │
│   - id (auto-increment PK)                        │
│   - requestId (unique) ◄─────────────────────┐    │
│   - origin (enum: slack, github_issue, web)  │    │
├───────────────────────────────────────────────────┤
│  Request Details:                                 │
│   - repo, title, description                      │
│   - requestType (feature/bug_fix/refactor/docs)   │
│   - status (enum: pending, processing, etc.)      │
├───────────────────────────────────────────────────┤
│  Slack Context (when origin='slack'):             │
│   - slackUserId, slackUserName                    │
│   - slackChannelId, slackChannelName              │
│   - slackThreadTs ◄── indexed for thread lookup   │
│   - responseUrl                                   │
├───────────────────────────────────────────────────┤
│  GitHub Issue (when origin='github_issue'):       │
│   - issueId ◄── unique (one request per issue)    │
│   - issueNumber                                   │
│   - issueTitle, issueBody                         │
│   - issueLabels (jsonb), issueAuthor              │
│   - issueUrl                                      │
├───────────────────────────────────────────────────┤
│  Web UI (when origin='web'):                      │
│   - webUserId, webUserEmail                       │
├───────────────────────────────────────────────────┤
│  Repository:                                      │
│   - repositoryUrl, repositoryName ◄── indexed     │
│   - repositoryId, repositoryOwner                 │
│   - repositoryNameOnly                            │
├───────────────────────────────────────────────────┤
│  Processing:                                      │
│   - appId                                         │
│   - taskStatus (enum), taskError                  │
│   - clarifyingQuestions                           │
├───────────────────────────────────────────────────┤
│  PR Details:                                      │
│   - prUrl, prNumber                               │
├───────────────────────────────────────────────────┤
│  PR Details:                                      │
│   - prUrl, prNumber                               │
│   - prBranchName ◄── for follow-up requests       │
├───────────────────────────────────────────────────┤
│  Retry Tracking:                                  │
│   - retryCount (default 0)                        │
│   - lastRetryAt                                   │
├───────────────────────────────────────────────────┤
│  Metrics:                                         │
│   - costUsd (cents), durationMs                   │
├───────────────────────────────────────────────────┤
│  Timestamps:                                      │
│   - createdAt, updatedAt, processedAt             │
└───────────────────────────────────────────────────┘

                                                    │
                        ┌───────────────────────────┘
                        │ FK: requestId
                        ▼
┌───────────────────────────────────────────────────┐
│                request_messages                   │ (conversation thread)
├───────────────────────────────────────────────────┤
│  Identity:                                        │
│   - id (auto-increment PK)                        │
│   - requestId (FK → feature_requests)             │
├───────────────────────────────────────────────────┤
│  Message Details:                                 │
│   - type (enum: initial_request, clarification,  │
│           follow_up, pr_created, pr_updated,     │
│           error, agent_thinking, agent_tool_call,│
│           agent_tool_result, agent_file_change,  │
│           agent_terminal, agent_summary)         │
│   - source (enum: slack, github, system)          │
│   - content (text)                                │
├───────────────────────────────────────────────────┤
│  Actor:                                           │
│   - actorId (user ID or 'system')                 │
│   - actorName (display name)                      │
├───────────────────────────────────────────────────┤
│  Metadata (jsonb):                                │
│   - slackTs, issueCommentId, prCommentId          │
│   - durationMs, costCents (per-attempt)           │
│   - fromStatus, toStatus (state changes)          │
│   - errorCode, errorMessage, errorStack           │
│   - Agent UI fields:                              │
│     - toolName, toolInput, toolOutput             │
│     - filePath, fileAction, diffPreview           │
│     - command, exitCode, stdout, stderr           │
│     - turnId, turnNumber (for grouping)           │
├───────────────────────────────────────────────────┤
│  Timestamps:                                      │
│   - createdAt                                     │
└───────────────────────────────────────────────────┘

Indexes:
  - app_config(type) - unique
  - feature_requests(requestId) - unique
  - feature_requests(issueId) - unique (one request per GitHub issue)
  - feature_requests(slackChannelId, slackThreadTs) - Slack thread lookup
  - feature_requests(issueNumber, repositoryName) - GitHub issue lookup
  - feature_requests(status) - filtering by status
  - feature_requests(createdAt) - sorting/pagination
  - request_messages(requestId, createdAt) - thread retrieval
```

### Benefits of Typed JSONB Approach

1. **Cleaner Schema**: 3 rows in `app_config` instead of 20+ columns
2. **Type Safety**: TypeScript interfaces ensure config shape at compile time
3. **Flexible Evolution**: Add new fields to config without migrations
4. **Query JSON**: PostgreSQL JSONB supports indexing and querying nested fields
5. **Partial Updates**: Update specific config type without affecting others

```typescript
// Example: Query specific field from JSONB config
const githubAppId = await db
  .select({ appId: sql<string>`config->>'appId'` })
  .from(appConfig)
  .where(eq(appConfig.type, 'github'));
```

## References

- [ADR-001: Slack to Claude Code Containers Bridge](./ADR-001-slack-to-github-actions-bridge.md) - Original architecture
- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [PlanetScale PostgreSQL](https://planetscale.com/docs)
- [Cloudflare Workers with PostgreSQL](https://developers.cloudflare.com/workers/tutorials/postgres/)

## Implementation Status

### Completed
- [x] Install Drizzle ORM dependencies (`drizzle-orm`, `pg`, `drizzle-kit`) - using `pg` driver with Hyperdrive
- [x] Define database schema (`src/db/schema.ts`)
- [x] Implement database client (`src/db/client.ts`)
- [x] Create Drizzle config (`drizzle.config.ts`)
- [x] Create repository classes:
  - `src/db/repositories/app-config.ts` - AppConfigRepository
  - `src/db/repositories/feature-request.ts` - FeatureRequestRepository
  - `src/db/repositories/request-messages.ts` - RequestMessagesRepository
- [x] Add npm scripts for migrations (`db:generate`, `db:migrate`, `db:push`, `db:studio`)
- [x] Create PlanetScale database and configure (set DATABASE_URL secret)
- [x] Generate and push schema to database
- [x] Configure Cloudflare Hyperdrive for connection pooling
- [x] Migrate all read/write paths from Durable Objects to PostgreSQL
- [x] Implement RequestService layer for business logic
- [x] Add pagination support for task history (100 items per page)
- [x] Add real-time polling (5 second intervals) for task list and detail views
- [x] Remove Durable Object dependencies from main application
- [x] Update frontend dashboard with PostgreSQL-backed data
- [x] Add "Last updated at" timestamp for polling feedback

### Migration Summary
The migration from Durable Objects to PostgreSQL with Drizzle ORM has been successfully completed. Key changes:

1. **Database**: PlanetScale PostgreSQL with Cloudflare Hyperdrive for edge connection pooling
2. **Schema**: Three main tables - `app_config`, `feature_requests`, `request_messages`
3. **ORM**: Drizzle ORM with full TypeScript type safety
4. **API**: All endpoints now use PostgreSQL via RequestService
5. **Frontend**: Dashboard supports pagination, real-time polling, and direct task links

## Notes

### Security Considerations

#### Encryption at Rest for Sensitive Data

All sensitive credentials are stored **encrypted** in the database using AES-256-GCM encryption. The encryption key (`ENCRYPTION_KEY`) is stored in Cloudflare Worker secrets, never in the database.

**Encrypted Fields:**
- `GitHubConfig.privateKeyEncrypted` - GitHub App private key
- `GitHubConfig.webhookSecretEncrypted` - GitHub webhook secret
- `GitHubConfig.installationToken` - Cached installation token (short-lived, ~1hr TTL)
- `ClaudeConfig.apiKeyEncrypted` - Claude/Anthropic API key
- `SlackConfig.signingSecretEncrypted` - Slack signing secret
- `SlackConfig.botTokenEncrypted` - Slack bot OAuth token

**Encryption Flow:**
```
┌─────────────┐     plaintext      ┌─────────────┐     encrypted      ┌─────────────┐
│   Worker    │ ────────────────▶  │   encrypt   │ ────────────────▶  │  PostgreSQL │
│  (secrets)  │                    │  (AES-256)  │                    │ (PlanetScale)│
└─────────────┘                    └─────────────┘                    └─────────────┘
       │                                  ▲
       │         ENCRYPTION_KEY           │
       └──────────────────────────────────┘
```

**Decryption:**
- Worker decrypts on read before passing to container via API
- Container never sees encryption key, only decrypted values
- Decrypted values are passed over internal network (Worker ↔ Container)

**Implementation:**
```typescript
// src/utils/encryption.ts
import { webcrypto } from 'crypto';

export async function encrypt(plaintext: string, key: string): Promise<string> {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const keyBuffer = await webcrypto.subtle.importKey(
    'raw',
    hexToBuffer(key),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const encrypted = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    keyBuffer,
    new TextEncoder().encode(plaintext)
  );
  return bufferToHex(iv) + ':' + bufferToHex(new Uint8Array(encrypted));
}

export async function decrypt(ciphertext: string, key: string): Promise<string> {
  const [ivHex, dataHex] = ciphertext.split(':');
  const keyBuffer = await webcrypto.subtle.importKey(
    'raw',
    hexToBuffer(key),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const decrypted = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBuffer(ivHex) },
    keyBuffer,
    hexToBuffer(dataHex)
  );
  return new TextDecoder().decode(decrypted);
}
```

#### Other Security Measures

1. **Connection Security**: Use SSL/TLS for all database connections (PlanetScale enforces this)
2. **Access Control**: Limit database user permissions to required operations
3. **Secrets Management**: Store `DATABASE_URL` and `ENCRYPTION_KEY` in Cloudflare secrets, not wrangler.jsonc
4. **API Authentication**: Container API endpoints validate internal request origin

### Performance Considerations

1. **Connection Pooling**: Cloudflare Hyperdrive provides edge connection pooling with PlanetScale
2. **Query Optimization**: Add indexes for common query patterns
3. **Caching**: Consider edge caching for frequently-read config data
4. **Cold Starts**: Hyperdrive eliminates connection cold starts by maintaining persistent connections at the edge

### Rollback Plan

If issues are discovered after cutover:
1. Feature flag can instantly revert to Durable Objects
2. PostgreSQL data is preserved for analysis
3. DO data remains intact during migration period
4. No data loss scenario with dual-write approach
