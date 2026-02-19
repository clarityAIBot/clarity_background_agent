# Vibe-Kanban Architecture Analysis

> Reference analysis of BloopAI/vibe-kanban for inspiring Clarity AI architecture improvements.

## Overview

Vibe-Kanban is a full-stack AI-powered task management system with multi-agent orchestration capabilities. This document analyzes its architecture to identify patterns applicable to Clarity AI's GitHub issue processing workflow.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              VIBE-KANBAN ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                           FRONTEND (React + TypeScript)                  │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │    │
│  │  │   Kanban    │  │    Task     │  │    Diff     │  │   Agent     │    │    │
│  │  │   Board     │  │   Details   │  │   Viewer    │  │   Monitor   │    │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │    │
│  │                                                                         │    │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │    │
│  │  │                    STATE MANAGEMENT                              │   │    │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │   │    │
│  │  │  │ React Query  │  │   Zustand    │  │   Context    │          │   │    │
│  │  │  │ (Server)     │  │  (UI State)  │  │  (WebSocket) │          │   │    │
│  │  │  └──────────────┘  └──────────────┘  └──────────────┘          │   │    │
│  │  └─────────────────────────────────────────────────────────────────┘   │    │
│  │                                                                         │    │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │    │
│  │  │                      88+ CUSTOM HOOKS                            │   │    │
│  │  │  useTask, useWorkspace, useAgent, useDiff, useApproval, etc.    │   │    │
│  │  └─────────────────────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                      │                                           │
│                                      │ REST API + WebSocket                      │
│                                      ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                        BACKEND (Rust + Axum)                            │    │
│  │                                                                         │    │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │    │
│  │  │                         API LAYER                                │   │    │
│  │  │  /api/tasks  /api/workspaces  /api/agents  /api/diffs  /ws      │   │    │
│  │  └─────────────────────────────────────────────────────────────────┘   │    │
│  │                                      │                                  │    │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │    │
│  │  │                      SERVICES LAYER                              │   │    │
│  │  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐ │   │    │
│  │  │  │   Task     │  │ Workspace  │  │   Agent    │  │    Diff    │ │   │    │
│  │  │  │  Service   │  │  Service   │  │  Service   │  │  Service   │ │   │    │
│  │  │  └────────────┘  └────────────┘  └────────────┘  └────────────┘ │   │    │
│  │  └─────────────────────────────────────────────────────────────────┘   │    │
│  │                                      │                                  │    │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │    │
│  │  │              EXECUTOR LAYER (Trait-based Plugin System)          │   │    │
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐│   │    │
│  │  │  │ Claude   │ │  Gemini  │ │  Cursor  │ │ Copilot  │ │OpenCode││   │    │
│  │  │  │  Code    │ │   CLI    │ │          │ │          │ │        ││   │    │
│  │  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └────────┘│   │    │
│  │  │                  All implement: trait Executor                   │   │    │
│  │  └─────────────────────────────────────────────────────────────────┘   │    │
│  │                                      │                                  │    │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │    │
│  │  │                      DATABASE LAYER                              │   │    │
│  │  │  ┌──────────────────────────────────────────────────────────┐   │   │    │
│  │  │  │              SQLite / PostgreSQL (SQLx)                   │   │   │    │
│  │  │  │  tasks, workspaces, agents, diffs, approvals, sessions   │   │   │    │
│  │  │  └──────────────────────────────────────────────────────────┘   │   │    │
│  │  └─────────────────────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                         GIT WORKSPACES                                   │    │
│  │   /workspaces/{id}/  - Isolated directories for each task execution     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack Breakdown

### Backend (Rust)

| Crate | Purpose |
|-------|---------|
| `vibe-kanban-server` | Main Axum HTTP server with WebSocket support |
| `vibe-kanban-db` | SQLx database layer (SQLite/PostgreSQL) |
| `vibe-kanban-services` | Business logic services |
| `vibe-kanban-executors` | AI agent executor trait + implementations |
| `vibe-kanban-deployment` | Deployment configuration |
| `vibe-kanban-mcp-server` | Model Context Protocol server |

### Frontend (React + TypeScript)

| Layer | Technology | Purpose |
|-------|------------|---------|
| State (Server) | React Query | API data fetching & caching |
| State (UI) | Zustand | Local UI state (4 stores) |
| State (Real-time) | Context | WebSocket connection management |
| Hooks | Custom (88+) | Reusable logic encapsulation |
| Contexts | React Context (21) | Dependency injection |

---

## Key Architectural Patterns

### 1. Executor Trait Pattern (Agent Abstraction)

```rust
// vibe-kanban pattern
pub trait Executor: Send + Sync {
    fn name(&self) -> &str;
    fn execute(&self, task: &Task, workspace: &Workspace) -> Result<ExecutionResult>;
    fn abort(&self) -> Result<()>;
    fn supports_streaming(&self) -> bool;
}

// Implementations
struct ClaudeCodeExecutor;
struct GeminiCliExecutor;
struct CursorExecutor;
struct CopilotExecutor;
struct OpenCodeExecutor;
```

**Clarity AI Equivalent**: Already implemented as `IAgentStrategy` interface ✓

### 2. Task/Workspace Separation

```
Vibe-Kanban Model:
┌─────────────────┐     ┌─────────────────┐
│      Task       │────▶│    Workspace    │
├─────────────────┤     ├─────────────────┤
│ id              │     │ id              │
│ title           │     │ task_id         │
│ description     │     │ path            │
│ status          │     │ git_branch      │
│ priority        │     │ git_status      │
│ labels          │     │ created_at      │
│ created_at      │     │ last_activity   │
│ updated_at      │     └─────────────────┘
└─────────────────┘

Clarity AI Current Model:
┌─────────────────────────┐
│     IssueContext        │  ← Flat structure
├─────────────────────────┤
│ issueId                 │
│ issueNumber             │
│ title                   │
│ description             │
│ labels                  │
│ repositoryUrl           │
│ repositoryName          │
│ author                  │
│ isFollowUp              │
│ followUpRequest         │
│ existingPrNumber        │
│ existingPrUrl           │
└─────────────────────────┘
```

### 3. Real-time Progress via WebSocket

```typescript
// Vibe-Kanban WebSocket events
type AgentEvent =
  | { type: 'agent.started'; taskId: string; agent: string }
  | { type: 'agent.thinking'; taskId: string; message: string }
  | { type: 'agent.tool_use'; taskId: string; tool: string; input: unknown }
  | { type: 'agent.file_change'; taskId: string; file: string; diff: string }
  | { type: 'agent.completed'; taskId: string; result: ExecutionResult }
  | { type: 'agent.error'; taskId: string; error: string };
```

### 4. Diff Service for Change Tracking

```rust
pub struct DiffEntry {
    pub file_path: String,
    pub change_type: ChangeType,  // Added, Modified, Deleted
    pub before: Option<String>,
    pub after: Option<String>,
    pub hunks: Vec<DiffHunk>,
}

pub struct DiffService {
    pub fn capture_changes(workspace: &Workspace) -> Vec<DiffEntry>;
    pub fn get_summary(diffs: &[DiffEntry]) -> String;
    pub fn apply_approval(diff_id: &str, approved: bool) -> Result<()>;
}
```

### 5. Agent Status State Machine

```rust
pub enum AgentStatus {
    Idle,
    Starting,
    Running { progress: f32, current_action: String },
    WaitingForApproval { changes: Vec<DiffEntry> },
    Completed { result: ExecutionResult },
    Failed { error: String, recoverable: bool },
    Aborted,
}
```

---

## Patterns to Apply to Clarity AI

### Priority 1: High Impact, Medium Effort

#### 1.1 Task/Workspace Entity Separation

**Current State**: `IssueContext` is a flat structure mixing task metadata with execution state.

**Proposed Change**:
```typescript
// New: Task entity (metadata)
interface Task {
  id: string;
  issueNumber: string;
  title: string;
  description: string;
  labels: string[];
  author: string;
  repositoryUrl: string;
  repositoryName: string;
  status: TaskStatus;
  createdAt: Date;
  updatedAt: Date;
}

// New: Workspace entity (execution state)
interface Workspace {
  id: string;
  taskId: string;
  path: string;
  gitBranch: string;
  gitStatus: 'clean' | 'dirty' | 'committed' | 'pushed';
  createdAt: Date;
  lastActivity: Date;
}

// Task status enum
enum TaskStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  WaitingForClarification = 'waiting_for_clarification',
  Completed = 'completed',
  Failed = 'failed',
}
```

#### 1.2 WebSocket Progress Streaming

**Current State**: `onProgress` callback is internal only.

**Proposed Change**: Add WebSocket endpoint for real-time frontend updates.

```typescript
// New WebSocket event types
interface ProgressEvent {
  type: 'started' | 'thinking' | 'tool_use' | 'file_change' | 'completed' | 'error';
  taskId: string;
  timestamp: Date;
  message: string;
  data?: Record<string, unknown>;
}

// WebSocket handler in main.ts
app.ws('/ws/progress/:taskId', (ws, req) => {
  const { taskId } = req.params;
  progressEmitter.on(taskId, (event: ProgressEvent) => {
    ws.send(JSON.stringify(event));
  });
});
```

### Priority 2: Medium Impact, Medium Effort

#### 2.1 Enhanced Agent Status Tracking

**Current State**: Binary success/failure result.

**Proposed Change**:
```typescript
enum AgentStatus {
  Idle = 'idle',
  Starting = 'starting',
  Cloning = 'cloning',
  Analyzing = 'analyzing',
  Executing = 'executing',
  CommittingChanges = 'committing_changes',
  CreatingPR = 'creating_pr',
  WaitingForClarification = 'waiting_for_clarification',
  Completed = 'completed',
  Failed = 'failed',
}

interface AgentResult {
  success: boolean;
  status: AgentStatus;
  message: string;
  error?: string;
  // ... existing fields
}
```

#### 2.2 Diff Capture Service

**Current State**: Changes go directly to PR without preview.

**Proposed Change**:
```typescript
interface DiffService {
  captureChanges(workspaceDir: string): Promise<DiffEntry[]>;
  getSummary(diffs: DiffEntry[]): string;
  formatForPR(diffs: DiffEntry[]): string;
}

interface DiffEntry {
  filePath: string;
  changeType: 'added' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
  patch?: string;
}
```

### Priority 3: Medium Impact, High Effort

#### 3.1 Retry/Resume Capability

**Current State**: Failed executions require full restart.

**Proposed Change**: Persist execution state for recovery.

```typescript
interface ExecutionCheckpoint {
  taskId: string;
  workspaceDir: string;
  status: AgentStatus;
  lastCompletedStep: string;
  context: Record<string, unknown>;
  createdAt: Date;
}

class CheckpointService {
  save(checkpoint: ExecutionCheckpoint): Promise<void>;
  load(taskId: string): Promise<ExecutionCheckpoint | null>;
  resume(taskId: string): Promise<AgentResult>;
}
```

---

## Architecture Comparison

| Aspect | Vibe-Kanban | Clarity AI |
|--------|-------------|------------|
| **Backend** | Rust (Axum) | Node.js (HTTP) |
| **Frontend** | React + TypeScript | Svelte |
| **Database** | SQLite/PostgreSQL | PostgreSQL |
| **Real-time** | WebSocket | Polling (current) |
| **Trigger** | Local UI | GitHub Webhooks |
| **Agents** | 5 executors | 2 strategies |
| **Output** | Local workspace | GitHub PR |
| **Diff View** | Built-in UI | GitHub PR diff |

---

## Deployment Model Comparison

### Vibe-Kanban: Local/Self-Hosted HTTP Server

Vibe-kanban is designed as a **local-first** or **self-hosted** application. It does NOT use Cloudflare Workers or any serverless infrastructure.

```
┌─────────────────────────────────────────────────────────────────┐
│                    VIBE-KANBAN DEPLOYMENT                        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           Rust/Axum HTTP Server                           │   │
│  │           (runs on localhost:3000 or VPS)                 │   │
│  │                                                           │   │
│  │  ┌─────────────────────────────────────────────────────┐ │   │
│  │  │  Agent Executors (run in same process)              │ │   │
│  │  │  - Claude Code (spawns subprocess)                  │ │   │
│  │  │  - Gemini CLI (spawns subprocess)                   │ │   │
│  │  │  - Cursor (spawns subprocess)                       │ │   │
│  │  │  - OpenCode (spawns subprocess)                     │ │   │
│  │  └─────────────────────────────────────────────────────┘ │   │
│  │                                                           │   │
│  │  ┌─────────────────────────────────────────────────────┐ │   │
│  │  │  SQLite Database (local file)                       │ │   │
│  │  └─────────────────────────────────────────────────────┘ │   │
│  │                                                           │   │
│  │  ┌─────────────────────────────────────────────────────┐ │   │
│  │  │  Git Workspaces (/workspaces/*)                     │ │   │
│  │  └─────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                      │
│                    localhost:3000                                │
│                           │                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           React Frontend (served by Axum)                │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Key characteristics:**
- Single user/machine deployment
- Agents run as subprocesses on the same machine
- SQLite database stored as local file
- No container orchestration needed
- Unlimited execution time (no serverless timeouts)
- Access via localhost or Cloudflare Tunnel/ngrok for remote access

### Clarity AI: Cloudflare Edge + Containers

Clarity AI is designed as a **multi-tenant SaaS** using Cloudflare's edge infrastructure.

```
┌─────────────────────────────────────────────────────────────────┐
│                    CLARITY AI DEPLOYMENT                         │
│                                                                  │
│  GitHub                           Slack                          │
│    │                                │                            │
│    │ Webhook (issue.labeled)        │ Slash command / Bot        │
│    │                                │                            │
│    └──────────────┬─────────────────┘                            │
│                   ▼                                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           Cloudflare Worker (Edge)                        │   │
│  │           - Receives webhooks (GitHub, Slack)             │   │
│  │           - Validates requests                            │   │
│  │           - Spawns containers                             │   │
│  │           - Returns immediately                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                      │
│                           │ Spawn container                      │
│                           ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           Cloudflare Container (Isolated)                 │   │
│  │           - Node.js HTTP server                           │   │
│  │           - Runs agent strategies                         │   │
│  │           - Git clone/commit/push                         │   │
│  │           - Creates PRs                                   │   │
│  │           - Ephemeral (destroyed after job)               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                      │
│                           │ Results                              │
│                           ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           PostgreSQL Database                             │   │
│  │           - Task history                                  │   │
│  │           - Usage tracking                                │   │
│  │           - User/organization data                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Key characteristics:**
- Multi-tenant, auto-scaling
- Event-driven (GitHub webhooks + Slack commands)
- Isolated container per job execution
- PostgreSQL database for persistent storage
- Container timeout limits apply
- No persistent state between executions

### Side-by-Side Deployment Comparison

| Aspect | Vibe-Kanban | Clarity AI |
|--------|-------------|------------|
| **Hosting** | Self-hosted (local/VPS) | Cloudflare (edge + containers) |
| **Scaling** | Single instance | Auto-scaling, multi-tenant |
| **Trigger** | User clicks in UI | GitHub webhook + Slack commands |
| **Agent Runtime** | Same machine as server | Isolated container |
| **State** | Persistent (SQLite) | Ephemeral containers + PostgreSQL |
| **Timeout** | Unlimited | Container limits |
| **Cost Model** | Fixed (server cost) | Pay-per-use |
| **Network** | Local or tunneled | Global edge network |

---

## Implementation Roadmap

| Phase | Pattern | Effort | Files to Modify |
|-------|---------|--------|-----------------|
| 1 | Task/Workspace separation | Medium | `types.ts`, `executor.ts` |
| 2 | Enhanced status tracking | Low | `types.ts`, strategies |
| 3 | WebSocket progress | Medium | `main.ts`, new `ws.ts` |
| 4 | Diff service | Medium | new `diff.service.ts` |
| 5 | Checkpoint/Resume | High | new `checkpoint.service.ts` |

---

## Conclusion

Vibe-Kanban's architecture provides excellent patterns for:
- **Multi-agent orchestration** (already adopted via Strategy pattern)
- **Real-time progress tracking** (recommended addition)
- **Clean entity separation** (recommended refactor)
- **Granular status management** (recommended enhancement)

The key insight is that vibe-kanban is **stateful and interactive** (IDE-like), while Clarity AI is **event-driven** (webhook-triggered). We should adopt patterns that enhance observability and reliability without overcomplicating the event-driven model.

---

*Document generated: 2026-01-16*
*Reference: [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban)*
