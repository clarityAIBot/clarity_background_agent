# Automaker vs Clarity AI: Architecture Comparison & Inspirations

## Executive Summary

This document compares **Automaker** (a desktop-first AI coding assistant) with **Clarity AI** (a cloud-native GitHub automation platform) to identify patterns and features that could enhance Clarity AI.

| Aspect | Automaker | Clarity AI |
|--------|-----------|------------|
| **Deployment** | Desktop (Electron) + Web | Cloud (Cloudflare Workers + Containers) |
| **Storage** | File-based (JSON) | PostgreSQL (Drizzle ORM) |
| **Agent Execution** | Local process | Cloudflare Containers |
| **Multi-Agent** | 4 providers (Claude, Cursor, Codex, OpenCode) | 2 agents (Claude Code, OpenCode) |
| **Trigger** | Manual (Kanban board) | Automated (GitHub webhooks, Slack) |
| **Git Strategy** | Worktree isolation | Direct branch creation |

---

## High-Priority Inspirations for Clarity AI

### 1. Git Worktree Isolation

**Automaker's Approach:**
Each feature executes in an isolated `git worktree`, protecting the main branch during AI execution.

```typescript
// Automaker creates isolated worktrees per feature
worktreeInfo: {
  path: '/projects/repo/.worktrees/feature-123',
  branch: 'feature/add-login',
  isActive: boolean
}
```

**Why Clarity Should Adopt:**
- Prevents race conditions when multiple issues are processed simultaneously
- Allows safe rollback without affecting main branch
- Enables parallel processing of independent features

**Implementation Effort:** Medium
- Add worktree creation in `AgentExecutor.setupWorkspace()`
- Store worktree path in `feature_requests` table
- Clean up worktrees after PR merge/close

---

### 2. Extended Thinking Levels

**Automaker's Approach:**
Configurable thinking token budgets for different task complexities:

```typescript
type ThinkingLevel = 'none' | 'low' | 'medium' | 'high' | 'ultrathink';

const thinkingTokens = {
  none: undefined,
  low: 1024,
  medium: 10000,
  high: 16000,      // Recommended for complex tasks
  ultrathink: 32000 // Maximum safe
};
```

**Why Clarity Should Adopt:**
- Simple issues (typos) don't need expensive thinking
- Complex features benefit from deeper reasoning
- Cost optimization per request

**Implementation Effort:** Low
- Add `thinkingLevel` to `AgentConfig`
- Map levels to `maxThinkingTokens` in Claude SDK options
- Allow setting via GitHub labels (e.g., `clarity-ai-thinking-high`)

---

### 3. Planning Modes with Approval Gates

**Automaker's Approach:**
Four planning modes before implementation:

| Mode | Description |
|------|-------------|
| `skip` | Direct implementation, no planning |
| `lite` | Quick outline, no formal breakdown |
| `spec` | Detailed spec with task breakdown + approval gate |
| `full` | Phased execution with intermediate approvals |

**Why Clarity Should Adopt:**
- Prevents AI from implementing unwanted changes
- Gives users visibility before code is written
- Reduces wasted compute on misunderstood requirements

**Proposed Implementation for Clarity:**
```typescript
// New status: 'awaiting_plan_approval'
// New message type: 'plan_proposed'
// Slack button: "Approve Plan" / "Request Changes"
```

**Implementation Effort:** Medium-High

---

### 4. Real-Time WebSocket Streaming

**Automaker's Approach:**
Event-driven architecture with WebSocket streaming:

```typescript
// Central EventEmitter broadcasts to all connected clients
eventEmitter.emit('agent:thinking', { sessionId, content });
eventEmitter.emit('agent:tool_use', { sessionId, tool, input });
eventEmitter.emit('agent:complete', { sessionId, result });
```

**Why Clarity Should Adopt:**
- Users see AI progress in real-time (thinking, tool calls)
- Better UX than polling for status
- Enables "live view" of agent execution

**Current Clarity Approach:**
- Stores messages in `request_messages` table
- Frontend polls for updates

**Implementation Effort:** Medium
- Add WebSocket endpoint to Cloudflare Worker
- Stream container logs via Durable Objects
- Update frontend to subscribe to WebSocket

---

### 5. Context File System

**Automaker's Approach:**
Project-specific context in `.automaker/context/`:

```
.automaker/
├── context/
│   ├── coding-standards.md
│   ├── api-guidelines.md
│   └── component-library.png
├── spec.md           # Project specification
└── settings.json     # Project-specific settings
```

These files are auto-loaded into agent prompts via `loadContextFiles()`.

**Why Clarity Should Adopt:**
- Repository-specific coding standards
- Architectural guidelines for the AI
- Reduces repetitive instructions in issues

**Proposed Implementation for Clarity:**
```
.clarity/
├── context.md        # Auto-loaded into prompts
├── guidelines.md     # Coding standards
└── settings.json     # Per-repo agent config
```

**Implementation Effort:** Low
- Check for `.clarity/context.md` during workspace setup
- Append content to system prompt
- Document convention for users

---

### 6. Multi-Agent Task Execution

**Automaker's Approach:**
Spec mode generates task breakdown, each task gets a dedicated agent:

```typescript
interface TaskBreakdown {
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    dependencies: string[]; // Other task IDs
    status: 'pending' | 'in_progress' | 'completed';
  }>;
}

// Parallel execution of independent tasks
const independentTasks = tasks.filter(t => t.dependencies.length === 0);
await Promise.all(independentTasks.map(executeTask));
```

**Why Clarity Should Adopt:**
- Complex issues can be split into parallel work
- Faster completion for multi-file changes
- Better tracking of progress

**Implementation Effort:** High
- New task breakdown phase
- Dependency resolution
- Parallel agent execution
- Task status aggregation

---

### 7. Session Resumption

**Automaker's Approach:**
Conversation history persisted, can resume with SDK session ID:

```typescript
// Store session metadata
await saveSessionMetadata(sessionId, {
  sdkSessionId: result.sessionId,
  messages: conversationHistory,
  lastUpdated: new Date()
});

// Resume later
const session = await loadSession(sessionId);
await query({
  ...options,
  resume: session.sdkSessionId  // SDK's resume option
});
```

**Why Clarity Should Adopt:**
- Follow-up requests maintain full context
- Reduces token usage (cached prefix)
- Better continuity for multi-turn interactions

**Current Clarity Approach:**
- Passes last 10 messages as text in prompt
- No SDK session resumption

**⚠️ CRITICAL FINDING: SDK Session Data is LOCAL, Not Cloud-Based**

The Claude Agent SDK stores session data **locally** in `~/.claude/projects/` as JSONL files. The `resume: sessionId` option requires these files to exist on the filesystem. When a container dies, these files are lost.

**Options for Clarity (Ephemeral Containers):**

| Option | Description | Effort | Effectiveness |
|--------|-------------|--------|---------------|
| **A. Hybrid Session Pattern** | Extract session files before shutdown, store in DB, restore on resume | High | Full context |
| **B. Conversation History** (Current) | Pass last N messages in prompt | Low | Good enough |
| **C. Extended History** | Store full conversation in DB, rebuild on each request | Medium | Near-full context |

**Recommended: Enhanced Conversation History (Option C)**

Since true SDK session resumption requires local file persistence (incompatible with ephemeral containers), the practical approach is:

```typescript
// Store full conversation in request_messages table (already done)
// On follow-up, fetch more messages (e.g., 50 instead of 10)
const conversationMessages = await requestService.messages.getAgentConversationContext(
  requestId,
  50  // Increase from 10 for better context
);
```

**Why Hybrid Session (Option A) is Complex:**
1. Session files in `~/.claude/` are Claude SDK internal format
2. Would need to extract before container shutdown (timing issues)
3. Restore process is undocumented and may break with SDK updates
4. Session files may be large (100s of MB for long conversations)

**Implementation Effort:** Low (keep current approach, increase message count)
- Current approach of passing conversation history is the right pattern for ephemeral containers
- Consider increasing from 10 to 50 messages for better context
- Full SDK session resumption is better suited for desktop apps like Automaker

---

### 8. Pipeline-Based Workflow

**Automaker's Approach:**
Customizable workflow columns between "in_progress" and "waiting_approval":

```typescript
interface PipelineStep {
  id: string;
  name: string;          // e.g., "Code Review", "Testing"
  description: string;
  order: number;
}

// Feature moves through pipeline
feature.status = 'in_progress';
feature.pipelineStep = 'code_review';
```

**Why Clarity Should Adopt:**
- Enterprises need custom approval workflows
- Integration points for CI/CD, security scans
- Visibility into where requests are stuck

**Implementation Effort:** Medium
- Add `pipelineStep` to `feature_requests`
- Admin UI to configure pipeline
- Webhook triggers for step transitions

---

## Medium-Priority Inspirations

### 9. Project Analysis & Suggestions

**Automaker's Approach:**
AI-powered codebase analysis generates feature suggestions:

```typescript
// Stored in .automaker/analysis.json
interface ProjectAnalysis {
  structure: DirectoryTree;
  technologies: string[];
  patterns: string[];
  suggestions: FeatureSuggestion[];
}
```

**Potential for Clarity:**
- Analyze repo on first issue
- Suggest related issues to work on
- Identify technical debt

---

### 10. MCP (Model Context Protocol) Integration

**Automaker's Approach:**
Configurable MCP servers for tool discovery:

```typescript
mcpServers: [
  { name: 'filesystem', command: 'mcp-filesystem' },
  { name: 'github', command: 'mcp-github' }
]
```

**Potential for Clarity:**
- Let users add custom tools per repository
- Integration with internal APIs
- Database access for data-driven features

---

### 11. Usage Tracking & Cost Budgets

**Automaker's Approach:**
`ClaudeUsageService` tracks token consumption:

```typescript
interface UsageRecord {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  costUsd: number;
}
```

**Clarity Already Has:**
- `costUsd` and `durationMs` per request
- Stored in `feature_requests` and `request_messages`

**Enhancement:**
- Daily/monthly budget limits per org
- Alert when approaching limits
- Usage dashboard with trends

---

### 12. Audio/Toast Notifications

**Automaker's Approach:**
- Completion sounds (optional, mutable)
- Toast notifications via Sonner

**Potential for Clarity:**
- Browser notifications when PR is created
- Email digest of completed requests
- Slack DM for high-priority completions

---

## Lower-Priority / Not Applicable

| Feature | Reason |
|---------|--------|
| Electron Desktop App | Clarity is cloud-first by design |
| Terminal Integration | Users have their own terminals |
| File-based Storage | PostgreSQL is more robust for multi-tenant |
| Keyboard Shortcuts | Web dashboard already has shortcuts |
| 25+ UI Themes | Nice-to-have, low business value |

---

## Implementation Roadmap

### Phase 1: Quick Wins (1-2 weeks)
1. **Extended Thinking Levels** - Add to `AgentConfig`, map to SDK
2. **Context File System** - Check for `.clarity/context.md`
3. **Session Resumption** - Store and pass `sdkSessionId`

### Phase 2: Core Improvements (2-4 weeks)
4. **Git Worktree Isolation** - Safer parallel execution
5. **Real-Time WebSocket** - Better progress visibility
6. **Planning Mode (Lite)** - Optional plan approval before implementation

### Phase 3: Advanced Features (4-8 weeks)
7. **Multi-Agent Tasks** - Parallel task execution
8. **Pipeline Workflow** - Custom approval steps
9. **MCP Integration** - User-defined tools

---

## Key Takeaways

1. **Automaker excels at local development experience** - Desktop app, real-time streaming, worktree isolation
2. **Clarity excels at automation & integration** - GitHub webhooks, Slack, multi-tenant cloud
3. **Best of both worlds possible** - Adopt Automaker's thinking levels, planning modes, and context system while keeping Clarity's cloud-native architecture

---

## Appendix: File References

### Automaker Key Files
| File | Purpose |
|------|---------|
| `apps/server/src/services/agent-service.ts` | Agent execution |
| `apps/server/src/services/auto-mode-service.ts` | Autonomous pipeline |
| `libs/git-utils/` | Worktree management |
| `apps/server/src/providers/` | Multi-provider support |

### Clarity Key Files
| File | Purpose |
|------|---------|
| `container_src/src/agents/executor.ts` | Agent orchestration |
| `src/queue/consumer.ts` | Request processing |
| `src/handlers/slack.ts` | Slack integration |
| `src/db/schema.ts` | Database schema |
