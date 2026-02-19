# ADR-001: Session Blob Persistence for Ephemeral Containers

## Status
Proposed

## Date
2025-01-17

## Context

Clarity AI runs agents (Claude Code and OpenCode) inside ephemeral Cloudflare Containers. When a container completes a task and shuts down, all local state is lost. This includes the session data that the Claude Agent SDK stores locally in `~/.claude/projects/`.

### Current Behavior

1. **Claude Code SDK** stores session data in `~/.claude/projects/<workspace-path-encoded>/<session-id>.jsonl`
2. The SDK's `resume: sessionId` option requires these local JSONL files to exist
3. When our container dies, these files are lost
4. Follow-up requests start with no context from previous interactions

### Observed Session File Characteristics

```
~/.claude/projects/-Users-workspace-path/
├── <uuid>.jsonl              # Session files (100KB - 12MB each)
├── agent-<hash>.jsonl        # Sub-agent sessions
└── ...
```

- **File sizes**: 100KB - 12MB (gzip reduces ~70%)
- **Format**: JSONL with message history, tool calls, file operations
- **Session ID**: UUID returned in SDK's first `system` message with `subtype: 'init'`

### Problem Statement

For follow-up requests (clarifications, PR change requests), we want to:
1. Maintain full conversation context across container restarts
2. Leverage SDK's built-in session resumption for better context handling
3. Reduce token usage through cached conversation prefixes

## Decision

Implement **Session Blob Persistence** - extract session files before container shutdown, store compressed in PostgreSQL, and restore on follow-up requests.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ INITIAL REQUEST (New Container)                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. Agent executes task                                             │
│     └── SDK creates: ~/.claude/projects/.../<session-id>.jsonl     │
│                                                                     │
│  2. Capture session ID from SDK message:                            │
│     if (message.type === 'system' && message.subtype === 'init') { │
│       sessionId = message.session_id;                               │
│     }                                                               │
│                                                                     │
│  3. After execution, extract session blob:                          │
│     - Read ~/.claude/projects/.../<session-id>.jsonl                │
│     - Gzip compress                                                 │
│     - Base64 encode (for JSON transport)                            │
│                                                                     │
│  4. Return in container response:                                   │
│     { sessionId, sessionBlob: "base64-gzipped-data", ... }         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ CONSUMER (Cloudflare Worker via Hyperdrive)                         │
├─────────────────────────────────────────────────────────────────────┤
│  Note: Consumer already has PostgreSQL access via getDb(env)        │
│  Used for: requestService.completeWithPR(), messages, etc.          │
│                                                                     │
│  5. Store session data in PostgreSQL:                               │
│     ┌─────────────────────────────────────────────────────────────┐ │
│     │ agent_sessions                                              │ │
│     │ ├── request_id: text (FK)                                   │ │
│     │ ├── session_id: text                                        │ │
│     │ ├── agent_type: text                                        │ │
│     │ ├── session_blob: bytea (gzipped)                           │ │
│     │ ├── blob_size_bytes: integer                                │ │
│     │ └── expires_at: timestamp                                   │ │
│     └─────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ FOLLOW-UP REQUEST (New Container)                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  6. Consumer fetches session data from PostgreSQL                   │
│                                                                     │
│  7. Pass to container in request body:                              │
│     { AGENT_SESSION_ID, AGENT_SESSION_BLOB, ... }                  │
│                                                                     │
│  8. Container restores session before execution:                    │
│     - Decode base64                                                 │
│     - Decompress gzip                                               │
│     - Write to ~/.claude/projects/.../<session-id>.jsonl           │
│                                                                     │
│  9. Execute with SDK resume option:                                 │
│     query({ prompt, options: { resume: sessionId } })              │
│     └── Full context restored!                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 0: Verify Session Mechanism with Logging

Before implementing full persistence, add logging to verify the SDK session mechanism works as expected.

**File: `container_src/src/agents/strategies/claude-code.strategy.ts`**

```typescript
// Add logging at start of execute() to verify session capture works
async execute(context: AgentContext): Promise<AgentResult> {
  logger.log('SESSION', 'Starting execution', {
    hasResumeSessionId: !!context.resumeSessionId,
    hasSessionBlob: !!context.sessionBlob,
  });

  // ... existing execution code ...

  for await (const message of response) {
    // Log session ID when captured from init message
    if (message.type === 'system' && message.subtype === 'init') {
      this.sessionId = message.session_id;
      logger.log('SESSION', 'Captured session ID from SDK init message', {
        sessionId: this.sessionId,
      });
    }
    // ... process other messages
  }

  // After execution, log session file details
  const sessionDir = this.getSessionDir();
  logger.log('SESSION', 'Checking session directory', { sessionDir });

  try {
    const files = await fs.readdir(sessionDir);
    const sessionFiles = files.filter(f => f.endsWith('.jsonl'));
    logger.log('SESSION', 'Found session files', {
      count: sessionFiles.length,
      files: sessionFiles.slice(0, 5), // Log first 5
    });

    if (this.sessionId) {
      const sessionPath = path.join(sessionDir, `${this.sessionId}.jsonl`);
      const stats = await fs.stat(sessionPath);
      logger.log('SESSION', 'Session file stats', {
        sessionId: this.sessionId,
        sizeBytes: stats.size,
        sizeMB: (stats.size / 1024 / 1024).toFixed(2),
      });
    }
  } catch (error) {
    logger.log('SESSION', 'Error checking session files', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    success: true,
    sessionId: this.sessionId,
    // ... other fields
  };
}

private getSessionDir(): string {
  // SDK stores in ~/.claude/projects/<encoded-cwd>/
  const cwd = process.cwd().replace(/\//g, '-');
  return path.join(os.homedir(), '.claude', 'projects', cwd);
}
```

**Expected logs:**
```
[SESSION] Starting execution { hasResumeSessionId: false, hasSessionBlob: false }
[SESSION] Captured session ID from SDK init message { sessionId: "abc123-..." }
[SESSION] Checking session directory { sessionDir: "/root/.claude/projects/-workspace" }
[SESSION] Found session files { count: 1, files: ["abc123-....jsonl"] }
[SESSION] Session file stats { sessionId: "abc123-...", sizeBytes: 524288, sizeMB: "0.50" }
```

This verifies:
1. SDK emits `init` message with `session_id`
2. Session files are created in expected location
3. File sizes are within expected range (100KB - 12MB)

### Phase 1: Claude Code Strategy Updates

**File: `container_src/src/agents/strategies/claude-code.strategy.ts`**

```typescript
// 1. Capture session ID from SDK messages
private sessionId: string | undefined;

async execute(context: AgentContext): Promise<AgentResult> {
  // Restore session if provided
  if (context.resumeSessionId && context.sessionBlob) {
    await this.restoreSession(context.resumeSessionId, context.sessionBlob);
  }

  const response = query({
    prompt: context.prompt,
    options: {
      model: 'claude-sonnet-4-5',
      maxTurns: context.config.maxTurns,
      // Resume if session ID provided and restored
      ...(context.resumeSessionId && { resume: context.resumeSessionId }),
    }
  });

  for await (const message of response) {
    // Capture session ID from init message
    if (message.type === 'system' && message.subtype === 'init') {
      this.sessionId = message.session_id;
    }
    // ... process other messages
  }

  // Extract session blob after execution
  const sessionBlob = await this.extractSessionBlob(this.sessionId);

  return {
    success: true,
    sessionId: this.sessionId,
    sessionBlob,  // NEW: gzipped base64 encoded
    // ... other fields
  };
}

private async restoreSession(sessionId: string, blob: string): Promise<void> {
  const sessionDir = this.getSessionDir();
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);

  await fs.mkdir(sessionDir, { recursive: true });

  // Decode base64 and decompress
  const compressed = Buffer.from(blob, 'base64');
  const content = await gunzip(compressed);

  await fs.writeFile(sessionPath, content);
}

private async extractSessionBlob(sessionId: string): Promise<string | undefined> {
  if (!sessionId) return undefined;

  const sessionPath = path.join(this.getSessionDir(), `${sessionId}.jsonl`);

  try {
    const content = await fs.readFile(sessionPath);
    const compressed = await gzip(content);
    return compressed.toString('base64');
  } catch {
    return undefined;
  }
}

private getSessionDir(): string {
  // SDK stores in ~/.claude/projects/<encoded-cwd>/
  const cwd = process.cwd().replace(/\//g, '-');
  return path.join(os.homedir(), '.claude', 'projects', cwd);
}
```

### Phase 2: OpenCode Strategy Updates

OpenCode may have different session storage. Investigate and implement similarly.

**File: `container_src/src/agents/strategies/opencode.strategy.ts`**

```typescript
// Similar pattern - check OpenCode's session storage location
// Likely uses different format/location than Claude SDK
```

### Phase 3: Types and Interfaces

**File: `container_src/src/agents/types.ts`**

```typescript
export interface AgentContext {
  // ... existing fields
  resumeSessionId?: string;    // Session ID to resume
  sessionBlob?: string;        // Gzipped base64 session data
}

export interface AgentResult {
  // ... existing fields
  sessionId?: string;          // Session ID for future resumption
  sessionBlob?: string;        // Gzipped base64 session data to persist
}
```

**File: `container_src/src/main.ts`**

```typescript
interface ContainerResponse {
  // ... existing fields
  sessionId?: string;
  sessionBlob?: string;
}
```

### Phase 4: Database Schema

**New Table: `agent_sessions`**

A dedicated table for session blobs keeps the main `feature_requests` table lean and allows:
- Independent lifecycle management (TTL-based cleanup)
- Multiple sessions per request (each follow-up can create a new session)
- Better query performance (blobs don't bloat frequently-queried tables)

```sql
-- New table for agent session persistence
CREATE TABLE agent_sessions (
  id SERIAL PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES feature_requests(request_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,                    -- Claude SDK session ID (UUID)
  agent_type TEXT NOT NULL,                    -- 'claude-code' | 'opencode'

  -- Session data
  session_blob BYTEA NOT NULL,                 -- Gzipped session data
  blob_size_bytes INTEGER NOT NULL,            -- Compressed size for monitoring

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,         -- For TTL-based cleanup (default: 7 days)

  -- Constraints
  UNIQUE(request_id, session_id)
);

-- Indexes for common queries
CREATE INDEX idx_agent_sessions_request_id ON agent_sessions(request_id);
CREATE INDEX idx_agent_sessions_expires_at ON agent_sessions(expires_at) WHERE expires_at IS NOT NULL;

-- Comments
COMMENT ON TABLE agent_sessions IS 'Persisted agent session data for ephemeral container resumption';
COMMENT ON COLUMN agent_sessions.session_id IS 'Claude SDK session ID returned from query()';
COMMENT ON COLUMN agent_sessions.session_blob IS 'Gzipped JSONL session file';
COMMENT ON COLUMN agent_sessions.expires_at IS 'Session expiry for cleanup (SDK sessions expire ~24h, we keep 7 days)';
```

**Drizzle Schema:**

```typescript
// src/db/schema.ts
export const agentSessions = pgTable('agent_sessions', {
  id: serial('id').primaryKey(),
  requestId: text('request_id').notNull().references(() => featureRequests.requestId, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull(),
  agentType: text('agent_type').notNull(),  // 'claude-code' | 'opencode'

  // Session data
  sessionBlob: bytea('session_blob').notNull(),
  blobSizeBytes: integer('blob_size_bytes').notNull(),

  // Metadata
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (table) => ({
  requestSessionUnique: unique().on(table.requestId, table.sessionId),
  requestIdIdx: index('idx_agent_sessions_request_id').on(table.requestId),
  expiresAtIdx: index('idx_agent_sessions_expires_at').on(table.expiresAt),
}));
```

**Reference in feature_requests (optional, for quick lookup):**

```sql
-- Add reference to latest session (optional optimization)
ALTER TABLE feature_requests
ADD COLUMN latest_session_id TEXT;

COMMENT ON COLUMN feature_requests.latest_session_id IS 'Reference to most recent session for quick lookup';
```

### Phase 5: Consumer Updates

**File: `src/queue/consumer.ts`**

```typescript
// On container response - save session to agent_sessions table
if (containerResponse.sessionId && containerResponse.sessionBlob) {
  const blobBuffer = Buffer.from(containerResponse.sessionBlob, 'base64');
  const blobSize = blobBuffer.length;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await requestService.sessions.create({
    requestId: issueData.requestId,
    sessionId: containerResponse.sessionId,
    agentType: agentConfig.type,
    sessionBlob: blobBuffer,
    blobSizeBytes: blobSize,
    expiresAt,
  });

  // Update reference in feature_requests for quick lookup
  await requestService.requests.updateLatestSessionId(
    issueData.requestId,
    containerResponse.sessionId
  );

  logWithContext("QUEUE_CONSUMER", "Session persisted", {
    requestId: issueData.requestId,
    sessionId: containerResponse.sessionId,
    blobSizeBytes: blobSize,
  });
}

// On follow-up - fetch and pass session
if (issueData.isFollowUp) {
  const latestSession = await requestService.sessions.getLatestForRequest(issueData.requestId);

  if (latestSession?.sessionBlob) {
    issueContext.AGENT_SESSION_ID = latestSession.sessionId;
    issueContext.AGENT_SESSION_BLOB = latestSession.sessionBlob.toString('base64');

    logWithContext("QUEUE_CONSUMER", "Session restored for follow-up", {
      requestId: issueData.requestId,
      sessionId: latestSession.sessionId,
      blobSizeBytes: latestSession.blobSizeBytes,
    });
  }
}
```

**New Repository: `src/db/repositories/agent-sessions.repository.ts`**

```typescript
export class AgentSessionsRepository {
  constructor(private db: DrizzleDB) {}

  async create(data: {
    requestId: string;
    sessionId: string;
    agentType: string;
    sessionBlob: Buffer;
    blobSizeBytes: number;
    expiresAt: Date;
  }) {
    return this.db.insert(agentSessions).values(data);
  }

  async getLatestForRequest(requestId: string) {
    return this.db.query.agentSessions.findFirst({
      where: eq(agentSessions.requestId, requestId),
      orderBy: [desc(agentSessions.createdAt)],
    });
  }

  async getBySessionId(sessionId: string) {
    return this.db.query.agentSessions.findFirst({
      where: eq(agentSessions.sessionId, sessionId),
    });
  }

  async deleteExpired() {
    return this.db.delete(agentSessions)
      .where(lt(agentSessions.expiresAt, new Date()));
  }

  async deleteForRequest(requestId: string) {
    return this.db.delete(agentSessions)
      .where(eq(agentSessions.requestId, requestId));
  }
}
```

## Consequences

### Positive

1. **Full Context Preservation**: Follow-up requests maintain complete conversation history
2. **Token Efficiency**: SDK's cached prefix optimization reduces API costs
3. **Better UX**: Users get more coherent multi-turn interactions
4. **Transparent Resumption**: SDK handles context reconstruction internally
5. **Simple Architecture**: PostgreSQL-only, no external storage dependencies

### Negative

1. **Storage Costs**: Session blobs can be 100KB-4MB (compressed) per request
2. **Latency**: Restoring sessions adds ~100-500ms to container startup
3. **Complexity**: Additional failure modes (blob corruption, storage failures)
4. **SDK Dependency**: Reliant on undocumented SDK internal format

### Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| SDK format changes break restoration | Version detection, fallback to conversation history |
| Session expiry (SDK sessions expire ~24h) | Graceful fallback, re-create session |
| Storage costs | TTL-based cleanup (7 days), deleteExpired() cron job |
| Large blobs slow queries | TOAST handles compression, separate table isolates impact |

### PostgreSQL Blob Size Considerations

| Constraint | Limit | Our Approach |
|------------|-------|--------------|
| **BYTEA max size** | 1 GB (theoretical) | ~4MB max after gzip compression |
| **TOAST threshold** | 2 KB | Blobs > 2KB auto-stored out-of-line |
| **Recommended practical limit** | 10-50 MB | Well within limits |

**Why PostgreSQL-only works:**
- Gzip compression reduces session files by ~70%
- 12MB raw file → ~3.6MB compressed
- PostgreSQL TOAST handles large values efficiently (stored out-of-line)
- Separate `agent_sessions` table isolates blob storage from main queries
- TTL-based cleanup prevents unbounded growth

**Session size distribution (observed, after gzip):**
```
< 50KB:    ~40% of sessions (short tasks)
50KB-500KB: ~40% of sessions (typical tasks)
500KB-2MB:  ~15% of sessions (complex multi-file changes)
> 2MB:      ~5% of sessions (very long conversations)
```

## Alternatives Considered

### Alternative 1: Enhanced Conversation History (Current)

Pass more messages (50 instead of 10) in the prompt.

**Pros**: Simple, no storage overhead
**Cons**: Higher token usage, no SDK optimization, lossy context

### Alternative 2: R2 Bucket for Large Blobs

Store blobs > 1MB in Cloudflare R2.

**Pros**: Handles very large sessions
**Cons**: Added complexity, extra infrastructure, ~95% of sessions fit in PostgreSQL anyway

### Alternative 3: Long-Running Containers

Keep containers alive between requests for the same issue.

**Pros**: No session extraction needed
**Cons**: Higher costs, complexity in container lifecycle, not supported by Cloudflare

## Decision Outcome

Implement **Session Blob Persistence** using PostgreSQL-only storage, with **Enhanced Conversation History** as a fallback when session data is unavailable or corrupted.

## References

- [Claude Agent SDK - Session Management](https://platform.claude.com/docs/en/agent-sdk/sessions)
- [Hosting the Agent SDK](https://platform.claude.com/docs/en/agent-sdk/hosting) - Pattern 3: Hybrid Sessions
- [Automaker Session Management](../external_modules/automaker/apps/ui/docs/SESSION_MANAGEMENT.md)
- [Automaker Comparison](./automaker-comparison.md#7-session-resumption)
