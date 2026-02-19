# ADR-006: Generic Multi-Agent Task System

**Status**: Proposed
**Date**: 2026-01-23
**Author**: Engineering Team

## Context

### Supported Coding Agents (After Implementation)

| Agent | Integration | Provider(s) | Session Support | Notes |
|-------|-------------|-------------|-----------------|-------|
| **Claude Code** | SDK | Anthropic | Yes | Primary, full features |
| **OpenCode** | SDK | Anthropic, OpenAI, Google, Groq, DeepSeek, Mistral | Yes | Multi-provider |
| **Aider** | AgentAPI | Anthropic, OpenAI, Google, Groq, DeepSeek | No | Pair programming |
| **Goose** | AgentAPI | Anthropic, OpenAI | No | Autonomous agent |
| **Codex** | AgentAPI | OpenAI | No | OpenAI CLI |
| **Gemini CLI** | AgentAPI | Google | No | Google CLI |
| **Cursor CLI** | AgentAPI | Anthropic, OpenAI | No | IDE agent |
| **Copilot CLI** | AgentAPI | GitHub/OpenAI | No | GitHub agent |
| **Amazon Q** | AgentAPI | AWS | No | AWS agent |
| **Amp** | AgentAPI | Sourcegraph | No | Sourcegraph agent |
| **Auggie** | AgentAPI | Augment | No | Augment CLI |

### Current State

Clarity AI currently implements a Strategy Pattern (ADR-004) for **coding agents** (Claude Code, OpenCode). The architecture includes:

1. **IAgentStrategy Interface** (`container_src/src/agents/strategy.interface.ts`)
   - Methods: `execute()`, `abort()`, `validate()`, `cleanup()`, `getCapabilities()`
   - Designed specifically for AI coding tasks

2. **AgentExecutor** (`container_src/src/agents/executor.ts`)
   - Orchestrates workspace setup (git clone)
   - Handles git operations (commit, push)
   - Creates/updates PRs
   - Posts comments to GitHub issues

3. **AgentRouter** (`src/agents/router.ts`)
   - Routes by GitHub labels (`clarity-ai`, `clarity-ai-opencode`, etc.)
   - All labels map to coding agent types only

4. **Queue System** (`src/queue/consumer.ts`, `src/queue/types.ts`)
   - `IssueQueueMessage` with PR-centric fields
   - Processing flow: GitHub Issue -> Container -> PR/Comment

5. **Type System** (`container_src/src/agents/types.ts`)
   - `IssueContext`: `repositoryUrl`, `existingPrNumber`, `prUrl`
   - `AgentResult`: `prUrl`, `prNumber`, `prBranchName`

### Problem Statement

The current architecture is **tightly coupled to coding tasks**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     CURRENT COUPLING ANALYSIS                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  IssueContext (container_src/src/agents/types.ts)                          │
│  ├── repositoryUrl: string       <- Git-specific                           │
│  ├── repositoryName: string      <- Git-specific                           │
│  ├── existingPrNumber?: string   <- PR-specific                            │
│  ├── existingPrUrl?: string      <- PR-specific                            │
│  └── conversationHistory?: string                                          │
│                                                                             │
│  AgentResult (container_src/src/agents/types.ts)                           │
│  ├── prUrl?: string              <- PR-specific                            │
│  ├── prNumber?: number           <- PR-specific                            │
│  ├── prBranchName?: string       <- PR-specific                            │
│  └── needsClarification?: bool                                             │
│                                                                             │
│  AgentExecutor (container_src/src/agents/executor.ts)                      │
│  ├── setupWorkspace()            <- Git clone                              │
│  ├── detectGitChanges()          <- Git-specific                           │
│  ├── handlePullRequest()         <- PR creation                            │
│  └── commitAndPush()             <- Git operations                         │
│                                                                             │
│  AgentRouter (src/agents/router.ts)                                        │
│  └── LABEL_MAPPINGS              <- Only coding agents                     │
│      ├── 'clarity-ai' -> claude-code                                       │
│      └── 'clarity-ai-opencode' -> opencode                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Business Drivers

The system needs to support diverse use cases beyond coding:

| Use Case | Task Type | Agents | Output Type |
|----------|-----------|--------|-------------|
| Fix bugs, implement features | Coding | Claude Code, OpenCode, Aider, Goose, Codex, Gemini, Cursor | Pull Requests |
| Investigate incidents | Debugging | Debug Agent (MCP tools) | RCF Documents |
| Research topics | Research | Research Agent | Reports/Summaries |
| Run CI/CD operations | Automation | Automation Agent | Status Reports |
| Custom workflows | Custom | User-defined | Configurable |

## Decision

Implement a **Generic Multi-Agent Task System** that:

1. **Separates Task Types from Agent Types**
2. **Abstracts Context and Results** into domain-specific extensions
3. **Supports Pluggable Agent Registration** via manifests
4. **Evolves Routing** to support task type + agent type selection
5. **Leverages AgentAPI** as a universal adapter for 12+ coding agents

## Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     GENERIC MULTI-AGENT ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    ITaskStrategy (Base Interface)                    │   │
│  │  ──────────────────────────────────────────────────────────────────  │   │
│  │  + taskType: TaskType                                                │   │
│  │  + execute(context: TaskContext): Promise<TaskResult>                │   │
│  │  + abort(): Promise<void>                                            │   │
│  │  + validate(context: TaskContext): Promise<ValidationResult>         │   │
│  │  + cleanup(): Promise<void>                                          │   │
│  │  + getCapabilities(): TaskCapabilities                               │   │
│  └──────────────────────────────┬──────────────────────────────────────┘   │
│                                 │                                           │
│         ┌───────────────────────┼───────────────────────┐                  │
│         │                       │                       │                  │
│         ▼                       ▼                       ▼                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐         │
│  │ ICodingStrategy  │  │ IResearchStrategy│  │ IDebuggingStrategy│        │
│  │ ───────────────  │  │ ────────────────  │  │ ─────────────────  │        │
│  │ + repoUrl        │  │ + searchQuery    │  │ + incidentId       │        │
│  │ + prUrl          │  │ + sources        │  │ + logs[]           │        │
│  │ + diffStats      │  │ + report         │  │ + rcfDocument      │        │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘         │
│         │                       │                       │                  │
│         ▼                       ▼                       ▼                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐         │
│  │ ClaudeCodeAgent  │  │ ResearchAgent    │  │ DebugAgent       │         │
│  │ OpenCodeAgent    │  │ WebSearchAgent   │  │ LogAnalyzerAgent │         │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘         │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                       TaskExecutorRegistry                           │   │
│  │  ──────────────────────────────────────────────────────────────────  │   │
│  │  + registerExecutor(taskType: TaskType, executor: ITaskExecutor)    │   │
│  │  + getExecutor(taskType: TaskType): ITaskExecutor                   │   │
│  │  + listTaskTypes(): TaskType[]                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                       TaskRouter (Evolution)                         │   │
│  │  ──────────────────────────────────────────────────────────────────  │   │
│  │  + route(trigger: TriggerContext): { taskType, agentType, config }  │   │
│  │  + registerPattern(pattern: string, mapping: TaskMapping)           │   │
│  │  + getDefaultAgent(taskType: TaskType): AgentType                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Domain Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       TASK TYPE vs AGENT TYPE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  TaskType (WHAT needs to be done)          AgentType (WHO does it)          │
│  ├── coding                                ├── claude-code                  │
│  ├── research                              ├── opencode                     │
│  ├── debugging                             ├── research-agent               │
│  ├── automation                            ├── debug-agent                  │
│  └── custom                                └── custom-agent                 │
│                                                                             │
│  TaskType -> AgentType Mapping (Many-to-Many):                              │
│                                                                             │
│  ┌──────────────┬───────────────────────────────────────────────────────┐  │
│  │ Task Type    │ Compatible Agents                                     │  │
│  ├──────────────┼───────────────────────────────────────────────────────┤  │
│  │ coding       │ claude-code*, opencode, aider, goose, codex, gemini   │  │
│  │ research     │ research-agent*, claude-code                          │  │
│  │ debugging    │ debug-agent*, claude-code                             │  │
│  │ automation   │ automation-agent*, claude-code                        │  │
│  │ custom       │ [defined per manifest]                                │  │
│  └──────────────┴───────────────────────────────────────────────────────┘  │
│  * = default agent for task type                                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Interface Definitions

#### Core Base Types

```typescript
// container_src/src/tasks/types.ts

/**
 * Task types supported by the system.
 * Extensible via custom type registration.
 */
export type TaskType =
  | 'coding'      // Code implementation, PR creation
  | 'research'    // Information gathering, report generation
  | 'debugging'   // Incident investigation, RCF creation
  | 'automation'  // CI/CD operations, script execution
  | 'custom';     // User-defined task types

/**
 * Agent types available in the system.
 * Maps to specific strategy implementations.
 */
export type AgentType =
  // SDK-based agents (native integration)
  | 'claude-code'
  | 'opencode'
  // AgentAPI-based agents (universal adapter)
  | 'aider'
  | 'goose'
  | 'codex'
  | 'gemini'
  | 'cursor'
  | 'copilot'
  | 'amazonq'
  | 'amp'
  | 'auggie'
  // Task-specific agents
  | 'research-agent'
  | 'debug-agent'
  | 'automation-agent'
  | string;       // Allows custom agents

/**
 * Base context for all task types.
 * Domain-specific contexts extend this.
 */
export interface TaskContext {
  // Identifiers
  requestId: string;
  taskType: TaskType;

  // Core input
  prompt: string;
  config: TaskConfig;

  // Session management (ADR-001)
  resumeSessionId?: string;
  sessionBlob?: string;

  // Execution control
  signal?: AbortSignal;
  onProgress?: (event: TaskProgressEvent) => void;

  // Extended context (type-safe via discriminated union)
  domain?: DomainContext;
}

/**
 * Domain-specific context types
 */
export type DomainContext =
  | CodingContext
  | ResearchContext
  | DebuggingContext
  | AutomationContext
  | CustomContext;
```

#### Coding Context (Evolution of IssueContext)

```typescript
/**
 * Coding-specific context (evolved from IssueContext)
 */
export interface CodingContext {
  type: 'coding';

  // Repository info
  repositoryUrl: string;
  repositoryName: string;
  githubToken: string;

  // Issue/PR tracking
  issueNumber: string;
  issueTitle: string;
  issueBody: string;
  issueAuthor: string;
  labels: string[];

  // Follow-up support
  followUpRequest?: string;
  followUpAuthor?: string;
  existingPrNumber?: string;
  existingPrUrl?: string;
  conversationHistory?: string;
}
```

#### Research Context

```typescript
/**
 * Research-specific context
 */
export interface ResearchContext {
  type: 'research';

  // Research parameters
  query: string;
  sources?: string[];        // Specific URLs/docs to analyze
  depth?: 'shallow' | 'deep';
  outputFormat?: 'markdown' | 'json' | 'html';

  // Optional repository context
  repositoryUrl?: string;    // For code-related research
  repositoryName?: string;
}
```

#### Debugging Context

```typescript
/**
 * Debugging-specific context
 */
export interface DebuggingContext {
  type: 'debugging';

  // Incident info
  incidentId?: string;
  incidentUrl?: string;       // PagerDuty, Sentry URL

  // Service context
  serviceName: string;
  namespace?: string;
  environment?: 'production' | 'staging' | 'development';

  // Time window
  startTime?: string;         // ISO timestamp
  endTime?: string;           // ISO timestamp

  // MCP tool access
  enabledTools?: ('grafana' | 'coralogix' | 'kubernetes')[];

  // Output
  outputFormat?: 'rcf' | 'summary' | 'detailed';
}
```

#### Result Types

```typescript
// container_src/src/tasks/results.ts

/**
 * Base result for all task types.
 */
export interface TaskResult {
  success: boolean;
  message: string;

  // Session persistence (ADR-001)
  sessionId?: string;
  sessionBlob?: string;

  // Execution metadata
  costUsd?: number;
  durationMs?: number;

  // Clarification flow
  needsClarification?: boolean;
  clarifyingQuestions?: string;

  // Error details
  error?: string;

  // Domain-specific result
  output?: TaskOutput;

  // Agent metadata
  metadata?: {
    taskType: TaskType;
    agentType: AgentType;
    [key: string]: unknown;
  };
}

/**
 * Domain-specific output types
 */
export type TaskOutput =
  | CodingOutput
  | ResearchOutput
  | DebuggingOutput
  | AutomationOutput
  | CustomOutput;

/**
 * Coding task output (PR-centric)
 */
export interface CodingOutput {
  type: 'coding';
  prUrl?: string;
  prNumber?: number;
  prBranchName?: string;
  summary?: string;
  diffStats?: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  isDocOnlyChanges?: boolean;
}

/**
 * Research task output
 */
export interface ResearchOutput {
  type: 'research';
  report: string;
  format: 'markdown' | 'json' | 'html';
  sources: Array<{ url: string; title: string; relevance: number; }>;
  keyFindings?: string[];
  artifacts?: Array<{ name: string; type: string; content: string; }>;
}

/**
 * Debugging task output (RCF-centric)
 */
export interface DebuggingOutput {
  type: 'debugging';
  rcfDocument?: string;
  rcfUrl?: string;
  summary: string;
  rootCause?: string;
  timeline?: Array<{ timestamp: string; event: string; severity: string; }>;
  recommendations?: string[];
  evidence?: Array<{ type: string; source: string; data: unknown; }>;
}
```

#### Strategy Interface Evolution

```typescript
// container_src/src/tasks/strategy.interface.ts

/**
 * Base strategy interface for all task types.
 * Replaces IAgentStrategy with task-agnostic design.
 */
export interface ITaskStrategy {
  readonly taskType: TaskType;
  readonly name: string;
  readonly displayName: string;

  execute(context: TaskContext): Promise<TaskResult>;
  abort(): Promise<void>;
  supportsStreaming(): boolean;
  getCapabilities(): TaskCapabilities;
  validate(context: TaskContext): Promise<ValidationResult>;
  cleanup(): Promise<void>;
}

/**
 * Coding-specific strategy interface (extends base).
 */
export interface ICodingStrategy extends ITaskStrategy {
  readonly taskType: 'coding';
  execute(context: TaskContext & { domain: CodingContext }): Promise<TaskResult & { output?: CodingOutput }>;
}

/**
 * Research-specific strategy interface.
 */
export interface IResearchStrategy extends ITaskStrategy {
  readonly taskType: 'research';
  execute(context: TaskContext & { domain: ResearchContext }): Promise<TaskResult & { output?: ResearchOutput }>;
}

/**
 * Debugging-specific strategy interface.
 */
export interface IDebuggingStrategy extends ITaskStrategy {
  readonly taskType: 'debugging';
  execute(context: TaskContext & { domain: DebuggingContext }): Promise<TaskResult & { output?: DebuggingOutput }>;
}
```

### Task Executor Registry

```typescript
// container_src/src/tasks/executor-registry.ts

/**
 * Task executor handles domain-specific orchestration.
 * Different from strategies - executors manage the workflow around strategies.
 */
export interface ITaskExecutor {
  readonly taskType: TaskType;

  execute(
    context: TaskContext,
    strategy: ITaskStrategy,
    options: ExecutorOptions
  ): Promise<TaskResult>;
}

/**
 * Registry for task executors.
 */
export class TaskExecutorRegistry {
  private executors: Map<TaskType, ITaskExecutor> = new Map();

  register(executor: ITaskExecutor): void {
    this.executors.set(executor.taskType, executor);
  }

  get(taskType: TaskType): ITaskExecutor | undefined {
    return this.executors.get(taskType);
  }

  listTaskTypes(): TaskType[] {
    return Array.from(this.executors.keys());
  }
}
```

### Agent Manifest Format

```typescript
// container_src/src/agents/manifest.ts

/**
 * Agent manifest format for pluggable registration.
 */
export interface AgentManifest {
  // Identity
  name: string;                          // e.g., 'debug-agent'
  displayName: string;                   // e.g., 'Debugging Agent'
  version: string;                       // Semantic version

  // Task compatibility
  taskTypes: TaskType[];                 // ['debugging', 'research']
  primaryTaskType: TaskType;             // Default task type

  // Capabilities
  capabilities: {
    supportsStreaming: boolean;
    supportsSessionManagement: boolean;
    supportsSkills: boolean;
    supportedProviders: string[];
    maxContextLength?: number;
    mcpTools?: string[];                 // ['grafana', 'coralogix', 'slack']
  };

  // Configuration
  config: {
    requiredEnvVars: string[];           // ['ANTHROPIC_API_KEY']
    optionalEnvVars?: string[];
    defaultModel?: string;
    defaultProvider?: string;
  };

  // Implementation
  implementation: {
    type: 'builtin' | 'agentapi' | 'external' | 'script';
    module?: string;                     // For builtin: './strategies/debug-agent.strategy'
    agentapiType?: AgentAPIType;         // For agentapi: 'aider' | 'goose' | 'codex' | etc.
    command?: string;                    // For script/agentapi: 'aider --model sonnet'
    endpoint?: string;                   // For external: 'http://agent-service/execute'
    port?: number;                       // For agentapi: custom port (default 3284)
  };

  // Metadata
  description: string;
  author?: string;
  documentation?: string;
  tags?: string[];
}
```

### AgentAPI Integration

[AgentAPI](https://github.com/coder/agentapi) is a universal HTTP adapter from Coder that enables controlling 12+ coding agents through a unified API. This provides instant multi-agent support without implementing individual SDKs.

#### Supported Agents via AgentAPI

| Agent | AgentAPI Type | Command Example | Status |
|-------|---------------|-----------------|--------|
| Claude Code | `claude` | `claude` | Supported |
| Aider | `aider` | `aider --model sonnet` | Supported |
| Goose | `goose` | `goose` | Supported |
| OpenCode | `opencode` | `opencode` | Supported |
| Codex | `codex` | `codex` | Supported |
| Gemini CLI | `gemini` | `gemini` | Supported |
| GitHub Copilot | `copilot` | `copilot` | Supported |
| Amazon Q | `amazonq` | `q` | Supported |
| Sourcegraph Amp | `amp` | `amp` | Supported |
| Cursor CLI | `cursor` | `cursor` | Supported |
| Augment | `auggie` | `auggie` | Supported |

#### AgentAPI Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AGENTAPI INTEGRATION LAYER                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     AgentAPIStrategy                                 │   │
│  │  ──────────────────────────────────────────────────────────────────  │   │
│  │  + agentType: AgentAPIType                                          │   │
│  │  + serverProcess: ChildProcess                                      │   │
│  │  + port: number                                                     │   │
│  │  ──────────────────────────────────────────────────────────────────  │   │
│  │  + execute(context): Promise<TaskResult>                            │   │
│  │  + startServer(): Promise<void>                                     │   │
│  │  + sendMessage(content): Promise<void>                              │   │
│  │  + waitForStable(): Promise<void>                                   │   │
│  │  + getMessages(): Promise<Message[]>                                │   │
│  │  + subscribeEvents(): AsyncIterable<Event>                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     AgentAPI Server (Go Binary)                      │   │
│  │  ──────────────────────────────────────────────────────────────────  │   │
│  │  HTTP API on localhost:3284                                          │   │
│  │  ──────────────────────────────────────────────────────────────────  │   │
│  │  GET  /status   → { status: "running"|"stable", agent_type }        │   │
│  │  GET  /messages → { messages: [{ id, role, content, time }] }       │   │
│  │  POST /message  → { content, type: "user"|"raw" }                   │   │
│  │  GET  /events   → SSE stream (message_update, status_change)        │   │
│  │  POST /upload   → File upload to workspace                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Terminal Emulator (In-Memory)                    │   │
│  │  ──────────────────────────────────────────────────────────────────  │   │
│  │  • Runs agent CLI in virtual terminal                               │   │
│  │  • Translates API calls to keystrokes                               │   │
│  │  • Parses terminal output into structured messages                  │   │
│  │  • Handles agent-specific TUI formatting                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │  Claude  │ │  Aider   │ │  Goose   │ │  Codex   │ │  Gemini  │  ...   │
│  │  Code    │ │          │ │          │ │          │ │   CLI    │        │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### AgentAPI Strategy Implementation

```typescript
// container_src/src/agents/strategies/agentapi.strategy.ts

import type { ICodingStrategy, TaskContext, TaskResult, CodingOutput } from '../../tasks/types';
import { spawn, ChildProcess } from 'child_process';

/**
 * AgentAPI types supported by the universal adapter.
 * See: https://github.com/coder/agentapi
 */
export type AgentAPIType =
  | 'claude'
  | 'aider'
  | 'goose'
  | 'opencode'
  | 'codex'
  | 'gemini'
  | 'copilot'
  | 'amazonq'
  | 'amp'
  | 'cursor'
  | 'auggie'
  | 'custom';

interface AgentAPIConfig {
  agentType: AgentAPIType;
  command: string;
  args?: string[];
  port?: number;
  timeout?: number;
}

/**
 * Universal strategy that uses AgentAPI to control any supported coding agent.
 * Enables instant support for 12+ agents without individual SDK integrations.
 */
export class AgentAPIStrategy implements ICodingStrategy {
  readonly taskType = 'coding' as const;
  readonly name: string;
  readonly displayName: string;

  private config: AgentAPIConfig;
  private serverProcess: ChildProcess | null = null;
  private baseUrl: string;

  constructor(config: AgentAPIConfig) {
    this.config = config;
    this.name = `agentapi-${config.agentType}`;
    this.displayName = `${config.agentType.charAt(0).toUpperCase() + config.agentType.slice(1)} (via AgentAPI)`;
    this.baseUrl = `http://localhost:${config.port || 3284}`;
  }

  async execute(context: TaskContext): Promise<TaskResult & { output?: CodingOutput }> {
    const startTime = Date.now();

    try {
      // 1. Start AgentAPI server with the specified agent
      await this.startServer(context);

      // 2. Wait for agent to be ready (status: stable)
      await this.waitForStable();

      // 3. Send the prompt
      context.onProgress?.({ type: 'started', message: `Sending prompt to ${this.config.agentType}...`, timestamp: new Date() });

      await this.sendMessage(context.prompt);

      // 4. Subscribe to events and wait for completion
      await this.waitForCompletion(context);

      // 5. Get final messages
      const messages = await this.getMessages();
      const lastMessage = messages[messages.length - 1];

      return {
        success: true,
        message: `${this.config.agentType} completed successfully`,
        durationMs: Date.now() - startTime,
        output: {
          type: 'coding',
          summary: lastMessage?.content || 'Task completed'
        },
        metadata: {
          taskType: 'coding',
          agentType: this.name,
          agentapiType: this.config.agentType,
          messageCount: messages.length
        }
      };

    } catch (error) {
      return {
        success: false,
        message: `${this.config.agentType} execution failed`,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        metadata: {
          taskType: 'coding',
          agentType: this.name
        }
      };
    }
  }

  private async startServer(context: TaskContext): Promise<void> {
    const port = this.config.port || 3284;
    const args = [
      'server',
      '--port', String(port),
      `--type=${this.config.agentType}`,
      '--'
    ];

    // Add agent command and args
    args.push(this.config.command);
    if (this.config.args) {
      args.push(...this.config.args);
    }

    return new Promise((resolve, reject) => {
      this.serverProcess = spawn('agentapi', args, {
        cwd: context.domain?.type === 'coding' ? context.domain.repositoryName : process.cwd(),
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Wait for server to be ready
      const timeout = setTimeout(() => {
        reject(new Error('AgentAPI server startup timeout'));
      }, 30000);

      this.serverProcess.stderr?.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Server started') || output.includes(`listening on :${port}`)) {
          clearTimeout(timeout);
          resolve();
        }
      });

      this.serverProcess.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  private async waitForStable(): Promise<void> {
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      const response = await fetch(`${this.baseUrl}/status`);
      const data = await response.json();
      if (data.status === 'stable') {
        return;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('Agent did not become stable');
  }

  private async sendMessage(content: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, type: 'user' })
    });

    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.statusText}`);
    }
  }

  private async waitForCompletion(context: TaskContext): Promise<void> {
    // Subscribe to SSE events
    const eventSource = new EventSource(`${this.baseUrl}/events`);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        eventSource.close();
        reject(new Error('Execution timeout'));
      }, this.config.timeout || 600000);

      eventSource.addEventListener('status_change', (event) => {
        const data = JSON.parse(event.data);
        if (data.status === 'stable') {
          clearTimeout(timeout);
          eventSource.close();
          resolve();
        }
      });

      eventSource.addEventListener('message_update', (event) => {
        const data = JSON.parse(event.data);
        context.onProgress?.({
          type: 'thinking',
          message: data.message?.substring(0, 100) + '...',
          timestamp: new Date()
        });
      });

      eventSource.onerror = () => {
        clearTimeout(timeout);
        eventSource.close();
        reject(new Error('SSE connection error'));
      };
    });
  }

  private async getMessages(): Promise<Array<{ id: number; role: string; content: string; time: string }>> {
    const response = await fetch(`${this.baseUrl}/messages`);
    const data = await response.json();
    return data.messages || [];
  }

  async abort(): Promise<void> {
    // Send Ctrl+C to the agent
    await fetch(`${this.baseUrl}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '\x03', type: 'raw' })
    }).catch(() => {});

    this.serverProcess?.kill('SIGTERM');
  }

  supportsStreaming(): boolean {
    return true; // AgentAPI provides SSE streaming
  }

  getCapabilities() {
    return {
      supportsStreaming: true,
      supportsSessionManagement: false, // AgentAPI doesn't persist sessions
      supportsSkills: false,
      supportedProviders: [this.config.agentType]
    };
  }

  async validate(context: TaskContext) {
    // Check if agentapi binary is available
    try {
      const { execSync } = require('child_process');
      execSync('agentapi --version', { stdio: 'pipe' });
      return { valid: true };
    } catch {
      return { valid: false, errors: ['agentapi binary not found in PATH'] };
    }
  }

  async cleanup(): Promise<void> {
    if (this.serverProcess) {
      this.serverProcess.kill('SIGTERM');
      this.serverProcess = null;
    }
  }
}
```

#### AgentAPI Manifest Examples

```typescript
// container_src/src/agents/manifests/aider.manifest.ts

export const AIDER_MANIFEST: AgentManifest = {
  name: 'aider',
  displayName: 'Aider',
  version: '1.0.0',

  taskTypes: ['coding'],
  primaryTaskType: 'coding',

  capabilities: {
    supportsStreaming: true,
    supportsSessionManagement: false,
    supportsSkills: false,
    supportedProviders: ['anthropic', 'openai', 'google', 'groq', 'deepseek']
  },

  config: {
    requiredEnvVars: ['ANTHROPIC_API_KEY'],  // or OPENAI_API_KEY, etc.
    optionalEnvVars: ['AIDER_MODEL'],
    defaultModel: 'sonnet',
    defaultProvider: 'anthropic'
  },

  implementation: {
    type: 'agentapi',
    agentapiType: 'aider',
    command: 'aider',
    port: 3285  // Use different port to avoid conflicts
  },

  description: 'Aider is an AI pair programming tool that lets you edit code in your local git repository.',
  author: 'Paul Gauthier',
  documentation: 'https://aider.chat/',
  tags: ['coding', 'pair-programming', 'git']
};

// container_src/src/agents/manifests/goose.manifest.ts

export const GOOSE_MANIFEST: AgentManifest = {
  name: 'goose',
  displayName: 'Goose',
  version: '1.0.0',

  taskTypes: ['coding'],
  primaryTaskType: 'coding',

  capabilities: {
    supportsStreaming: true,
    supportsSessionManagement: false,
    supportsSkills: false,
    supportedProviders: ['anthropic', 'openai']
  },

  config: {
    requiredEnvVars: ['ANTHROPIC_API_KEY'],
    defaultProvider: 'anthropic'
  },

  implementation: {
    type: 'agentapi',
    agentapiType: 'goose',
    command: 'goose',
    port: 3286
  },

  description: 'Goose is a developer agent by Block that autonomously completes engineering tasks.',
  author: 'Block',
  documentation: 'https://github.com/block/goose',
  tags: ['coding', 'autonomous', 'developer-agent']
};

// container_src/src/agents/manifests/codex.manifest.ts

export const CODEX_MANIFEST: AgentManifest = {
  name: 'codex',
  displayName: 'OpenAI Codex',
  version: '1.0.0',

  taskTypes: ['coding'],
  primaryTaskType: 'coding',

  capabilities: {
    supportsStreaming: true,
    supportsSessionManagement: false,
    supportsSkills: false,
    supportedProviders: ['openai']
  },

  config: {
    requiredEnvVars: ['OPENAI_API_KEY'],
    defaultProvider: 'openai'
  },

  implementation: {
    type: 'agentapi',
    agentapiType: 'codex',
    command: 'codex',
    port: 3287
  },

  description: 'OpenAI Codex CLI for code generation and editing.',
  author: 'OpenAI',
  documentation: 'https://github.com/openai/codex',
  tags: ['coding', 'openai']
};
```

#### Integration Strategy Comparison

| Integration Type | Pros | Cons | Use When |
|------------------|------|------|----------|
| **SDK-based** (Claude Code SDK, OpenCode SDK) | Native API, full features, type-safe, session management | Requires SDK updates, version management | Primary agents, need full features |
| **AgentAPI-based** | Universal adapter, 12+ agents, unified API, simple integration | Extra process, terminal parsing may be fragile | Agents without SDKs, experimentation |
| **CLI-based** | No dependencies, direct control | No streaming, output parsing complexity | Simple fallback, testing |

#### Dockerfile Updates for AgentAPI

```dockerfile
FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 python3-pip git build-essential ca-certificates curl

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code@latest

# Install AgentAPI binary
RUN OS=$(uname -s | tr "[:upper:]" "[:lower:]"); \
    ARCH=$(uname -m | sed "s/x86_64/amd64/;s/aarch64/arm64/"); \
    curl -fsSL "https://github.com/coder/agentapi/releases/latest/download/agentapi-${OS}-${ARCH}" \
    -o /usr/local/bin/agentapi && \
    chmod +x /usr/local/bin/agentapi

# Install Aider (Python-based)
RUN pip3 install aider-chat

# Install Goose
RUN pip3 install goose-ai

# Verify installations
RUN claude --version && agentapi --version && aider --version

# ... rest of setup
```

### Advanced Patterns (Learned from Cairn)

The following patterns are inspired by [Cairn](https://github.com/cairn-dev/cairn), an open-source background agent system for coding.

#### Hierarchical Multi-Agent Architecture

Cairn implements a three-tier agent hierarchy for complex task decomposition:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    HIERARCHICAL AGENT DECOMPOSITION                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Fullstack Planner (Explorer)                      │   │
│  │  ──────────────────────────────────────────────────────────────────  │   │
│  │  • Receives complex, multi-faceted tasks                            │   │
│  │  • Analyzes repository structure and requirements                    │   │
│  │  • Decomposes into parallel subtasks                                 │   │
│  │  • Pre-generates subtask IDs for coordination                        │   │
│  └─────────────────────────────┬───────────────────────────────────────┘   │
│                                │                                           │
│              ┌─────────────────┼─────────────────┐                        │
│              │                 │                 │                        │
│              ▼                 ▼                 ▼                        │
│  ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐      │
│  │ Project Manager 1 │ │ Project Manager 2 │ │ Project Manager N │      │
│  │ ─────────────────  │ │ ─────────────────  │ │ ─────────────────  │      │
│  │ • Orchestrates PR │ │ • Orchestrates PR │ │ • Orchestrates PR │      │
│  │ • Manages branch  │ │ • Manages branch  │ │ • Manages branch  │      │
│  │ • Delegates to SW │ │ • Delegates to SW │ │ • Delegates to SW │      │
│  └─────────┬─────────┘ └─────────┬─────────┘ └─────────┬─────────┘      │
│            │                     │                     │                  │
│            ▼                     ▼                     ▼                  │
│  ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐      │
│  │ Software Engineer │ │ Software Engineer │ │ Software Engineer │      │
│  │ ─────────────────  │ │ ─────────────────  │ │ ─────────────────  │      │
│  │ • Implements code │ │ • Implements code │ │ • Implements code │      │
│  │ • Edits files     │ │ • Edits files     │ │ • Edits files     │      │
│  │ • Creates commits │ │ • Creates commits │ │ • Creates commits │      │
│  └───────────────────┘ └───────────────────┘ └───────────────────┘      │
│                                                                             │
│  Key Benefits:                                                              │
│  • Parallel execution of independent subtasks                              │
│  • Clear separation of planning vs execution                               │
│  • Scalable to complex multi-file/multi-repo tasks                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Implementation Pattern:**

```typescript
// container_src/src/tasks/hierarchical/planner.ts

/**
 * Agent roles in hierarchical decomposition.
 */
export type AgentRole = 'fullstack-planner' | 'project-manager' | 'software-engineer';

/**
 * Hierarchical task payload with role-specific fields.
 */
export interface HierarchicalTaskPayload extends TaskContext {
  // Common fields
  runId: string;
  agentRole: AgentRole;
  agentStatus: TaskStatus;

  // Planner-specific
  repos?: string[];                    // Multiple repos for analysis
  subtaskIds?: string[];               // Pre-generated IDs for parallel tasks

  // PM/SWE-specific
  repo?: string;                       // Single repo for implementation
  branch?: string;                     // Git branch name
  parentFullstackId?: string;          // Links to parent planner
  siblingSubtaskIds?: string[];        // For inter-agent communication
}

/**
 * Pre-generate subtask IDs before spawning workers.
 * Critical for reliable parallel execution coordination.
 */
export function preGenerateSubtaskIds(count: number): string[] {
  return Array.from({ length: count }, () => crypto.randomUUID());
}
```

#### Persistent Auto-Saving State (PersistentDict Pattern)

Cairn uses SQLite-backed dictionaries that transparently persist all changes:

```typescript
// container_src/src/tasks/storage/persistent-dict.ts

import { Database } from 'better-sqlite3';

/**
 * A dictionary that automatically persists to SQLite.
 * Inspired by Cairn's PersistentDict pattern.
 *
 * Benefits:
 * - Crash resilience: State survives process restarts
 * - Transparent persistence: No explicit save calls needed
 * - Debounced writes: Efficient I/O with configurable interval
 */
export class PersistentDict<T> {
  private cache: Map<string, T> = new Map();
  private db: Database;
  private tableName: string;
  private saveTimeout: NodeJS.Timeout | null = null;
  private debounceMs: number;

  constructor(dbPath: string, tableName: string, debounceMs = 100) {
    this.db = new Database(dbPath);
    this.tableName = tableName;
    this.debounceMs = debounceMs;
    this.initTable();
    this.loadFromDb();
  }

  private initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
  }

  private loadFromDb(): void {
    const rows = this.db.prepare(`SELECT key, value FROM ${this.tableName}`).all() as Array<{ key: string; value: string }>;
    for (const row of rows) {
      this.cache.set(row.key, JSON.parse(row.value));
    }
  }

  get(key: string): T | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: T): void {
    this.cache.set(key, value);
    this.scheduleSave(key, value);
  }

  delete(key: string): boolean {
    const existed = this.cache.delete(key);
    if (existed) {
      this.db.prepare(`DELETE FROM ${this.tableName} WHERE key = ?`).run(key);
    }
    return existed;
  }

  private scheduleSave(key: string, value: T): void {
    // Debounced save to avoid excessive I/O
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.db.prepare(`
        INSERT OR REPLACE INTO ${this.tableName} (key, value, updated_at)
        VALUES (?, ?, strftime('%s', 'now'))
      `).run(key, JSON.stringify(value));
    }, this.debounceMs);
  }

  entries(): IterableIterator<[string, T]> {
    return this.cache.entries();
  }

  values(): IterableIterator<T> {
    return this.cache.values();
  }
}
```

#### Inter-Agent Communication (Spy on Agent)

Read-only access to sibling agent outputs enables coordination without conflicts:

```typescript
// container_src/src/tasks/hierarchical/agent-communication.ts

/**
 * Inter-agent communication via read-only log access.
 * Agents can "spy on" sibling agents to coordinate work.
 *
 * Example: Frontend agent reads backend SWE's API routes before implementing UI.
 */
export interface AgentLog {
  runId: string;
  agentRole: AgentRole;
  timestamp: Date;
  type: 'progress' | 'output' | 'tool_call' | 'error';
  content: string;
  metadata?: Record<string, unknown>;
}

export class AgentCommunicationHub {
  private logs: PersistentDict<AgentLog[]>;

  constructor(dbPath: string) {
    this.logs = new PersistentDict(dbPath, 'agent_logs');
  }

  /**
   * Add a log entry for an agent.
   */
  addLog(runId: string, log: Omit<AgentLog, 'runId'>): void {
    const existingLogs = this.logs.get(runId) || [];
    existingLogs.push({ ...log, runId });
    this.logs.set(runId, existingLogs);
  }

  /**
   * Read logs from a sibling agent (read-only).
   * Used by "spy_on_agent" tool.
   */
  spyOnAgent(targetRunId: string): AgentLog[] {
    return this.logs.get(targetRunId) || [];
  }

  /**
   * Get output from a sibling agent.
   */
  getAgentOutput(targetRunId: string): string | undefined {
    const logs = this.logs.get(targetRunId) || [];
    const outputLog = logs.find(l => l.type === 'output');
    return outputLog?.content;
  }
}

/**
 * Tool definition for agents to spy on siblings.
 */
export const spyOnAgentTool = {
  name: 'spy_on_agent',
  description: 'Read logs and output from a sibling agent working on a related subtask.',
  parameters: {
    type: 'object',
    properties: {
      target_run_id: {
        type: 'string',
        description: 'The run ID of the sibling agent to spy on'
      },
      log_type: {
        type: 'string',
        enum: ['all', 'output', 'progress', 'tool_call'],
        description: 'Type of logs to retrieve'
      }
    },
    required: ['target_run_id']
  }
};
```

#### Task Status State Machine

```typescript
// container_src/src/tasks/status.ts

/**
 * Task status state machine.
 * Based on Cairn's status flow.
 */
export type TaskStatus =
  | 'queued'              // Waiting to be processed
  | 'running'             // Currently executing
  | 'subtasks_generated'  // Planner has created subtasks (hierarchical only)
  | 'subtasks_running'    // Subtasks are executing (hierarchical only)
  | 'completed'           // Successfully finished
  | 'failed'              // Execution failed
  | 'cancelled';          // Manually cancelled

/**
 * Valid status transitions.
 */
export const STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  'queued': ['running', 'cancelled'],
  'running': ['subtasks_generated', 'completed', 'failed', 'cancelled'],
  'subtasks_generated': ['subtasks_running', 'failed', 'cancelled'],
  'subtasks_running': ['completed', 'failed', 'cancelled'],
  'completed': [],
  'failed': ['queued'],  // Allow retry
  'cancelled': ['queued']  // Allow restart
};

/**
 * Validate status transition.
 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
```

#### Provider-Agnostic LLM Support

Unified response interface normalizes outputs across different providers:

```typescript
// container_src/src/llm/provider-abstraction.ts

/**
 * Unified LLM response interface.
 * Normalizes outputs across Anthropic, OpenAI, Google, etc.
 */
export interface UnifiedLLMResponse {
  content: string;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  toolCalls?: ToolCall[];
  model: string;
  provider: LLMProvider;
}

export type LLMProvider = 'anthropic' | 'openai' | 'google' | 'groq' | 'deepseek' | 'mistral';

/**
 * Provider configuration with chat class mapping.
 * Inspired by Cairn's SUPPORTED_MODELS pattern.
 */
export interface ProviderConfig {
  chatClass: new (config: any) => LLMClient;
  responseParser: (raw: any) => UnifiedLLMResponse;
  models: string[];
  envVar: string;
}

export const PROVIDER_CONFIG: Record<LLMProvider, ProviderConfig> = {
  anthropic: {
    chatClass: AnthropicClient,
    responseParser: parseAnthropicResponse,
    models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'],
    envVar: 'ANTHROPIC_API_KEY'
  },
  openai: {
    chatClass: OpenAIClient,
    responseParser: parseOpenAIResponse,
    models: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    envVar: 'OPENAI_API_KEY'
  },
  google: {
    chatClass: GoogleClient,
    responseParser: parseGoogleResponse,
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    envVar: 'GOOGLE_API_KEY'
  },
  groq: {
    chatClass: GroqClient,
    responseParser: parseGroqResponse,
    models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
    envVar: 'GROQ_API_KEY'
  },
  deepseek: {
    chatClass: DeepSeekClient,
    responseParser: parseDeepSeekResponse,
    models: ['deepseek-chat', 'deepseek-coder'],
    envVar: 'DEEPSEEK_API_KEY'
  },
  mistral: {
    chatClass: MistralClient,
    responseParser: parseMistralResponse,
    models: ['mistral-large-latest', 'codestral-latest'],
    envVar: 'MISTRAL_API_KEY'
  }
};

/**
 * Fuzzy model matching for new model versions.
 * Avoids hardcoding exact model names.
 */
export function findMatchingModel(provider: LLMProvider, modelHint: string): string | undefined {
  const config = PROVIDER_CONFIG[provider];

  // Exact match
  if (config.models.includes(modelHint)) {
    return modelHint;
  }

  // Fuzzy match (e.g., "sonnet" matches "claude-sonnet-4-*")
  const normalized = modelHint.toLowerCase();
  return config.models.find(m => m.toLowerCase().includes(normalized));
}
```

#### Subprocess-Based Worker Management

Better isolation than pure async for long-running agent tasks:

```typescript
// container_src/src/workers/subprocess-manager.ts

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

/**
 * Subprocess-based worker manager.
 *
 * Benefits over pure async:
 * - Memory isolation per task
 * - Crash resilience (one task crash doesn't crash others)
 * - Process-level resource limiting
 * - Better handling of long-running tasks
 */
export class SubprocessWorkerManager extends EventEmitter {
  private workers: Map<string, WorkerProcess> = new Map();
  private maxWorkers: number;

  constructor(maxWorkers = 4) {
    super();
    this.maxWorkers = maxWorkers;
  }

  /**
   * Spawn a worker process for a task.
   */
  async spawnWorker(taskId: string, taskPayload: TaskContext): Promise<void> {
    if (this.workers.size >= this.maxWorkers) {
      throw new Error(`Max workers (${this.maxWorkers}) reached`);
    }

    const worker: WorkerProcess = {
      taskId,
      process: null,
      status: 'starting',
      output: [],
      startTime: Date.now()
    };

    this.workers.set(taskId, worker);

    // Spawn worker subprocess
    const proc = spawn('node', ['--experimental-vm-modules', 'worker.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TASK_PAYLOAD: JSON.stringify(taskPayload),
        TASK_ID: taskId
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    worker.process = proc;
    worker.status = 'running';

    // Capture output without deadlocks
    proc.stdout?.on('data', (data) => {
      worker.output.push({ stream: 'stdout', data: data.toString(), timestamp: Date.now() });
      this.emit('output', taskId, 'stdout', data.toString());
    });

    proc.stderr?.on('data', (data) => {
      worker.output.push({ stream: 'stderr', data: data.toString(), timestamp: Date.now() });
      this.emit('output', taskId, 'stderr', data.toString());
    });

    proc.on('exit', (code, signal) => {
      worker.status = code === 0 ? 'completed' : 'failed';
      worker.exitCode = code;
      worker.exitSignal = signal;
      this.emit('exit', taskId, code, signal);
    });

    proc.on('error', (err) => {
      worker.status = 'failed';
      worker.error = err.message;
      this.emit('error', taskId, err);
    });
  }

  /**
   * Kill a worker process.
   */
  killWorker(taskId: string, signal: NodeJS.Signals = 'SIGTERM'): boolean {
    const worker = this.workers.get(taskId);
    if (!worker?.process) return false;

    // Use process group for clean shutdown
    try {
      process.kill(-worker.process.pid!, signal);
      return true;
    } catch {
      worker.process.kill(signal);
      return true;
    }
  }

  /**
   * Get worker status.
   */
  getWorkerStatus(taskId: string): WorkerProcess | undefined {
    return this.workers.get(taskId);
  }
}

interface WorkerProcess {
  taskId: string;
  process: ChildProcess | null;
  status: 'starting' | 'running' | 'completed' | 'failed';
  output: Array<{ stream: string; data: string; timestamp: number }>;
  startTime: number;
  exitCode?: number | null;
  exitSignal?: string | null;
  error?: string;
}
```

#### Configuration Layering

Global rules + repo-specific rules + per-agent memory:

```typescript
// container_src/src/config/layered-config.ts

/**
 * Layered configuration system.
 * Priority: Agent Memory > Repo Rules > Global Rules > Defaults
 */
export interface LayeredConfig {
  // Global rules (apply to all agents/repos)
  global: GlobalRules;

  // Repository-specific rules
  repos: Map<string, RepoRules>;

  // Per-agent memory (skip redundant operations)
  agentMemory: Map<string, AgentMemory>;
}

export interface GlobalRules {
  maxFilesToRead: number;
  allowedFileExtensions: string[];
  forbiddenPaths: string[];
  defaultModel: string;
  defaultProvider: LLMProvider;
}

export interface RepoRules extends Partial<GlobalRules> {
  repoName: string;
  customInstructions?: string;
  preferredBranch?: string;
  testCommand?: string;
  buildCommand?: string;
}

export interface AgentMemory {
  agentId: string;
  repoName: string;

  // Skip redundant tool calls
  seenFiles: Set<string>;           // Files already read
  exploredDirs: Set<string>;        // Directories already listed
  knownStructure?: string;          // Cached repo structure

  // Learning from past runs
  successfulPatterns: string[];     // Patterns that worked
  failedAttempts: string[];         // Patterns to avoid
}

/**
 * Resolve configuration with layering.
 */
export function resolveConfig(
  global: GlobalRules,
  repo?: RepoRules,
  memory?: AgentMemory
): ResolvedConfig {
  return {
    ...global,
    ...repo,
    skipFiles: memory?.seenFiles ?? new Set(),
    skipDirs: memory?.exploredDirs ?? new Set(),
    customInstructions: repo?.customInstructions,
    cachedStructure: memory?.knownStructure
  };
}
```

### Router Evolution

```typescript
// src/tasks/router.ts

/**
 * Evolved router supporting task type + agent type selection.
 */
export class TaskRouter {
  /**
   * Label patterns for routing.
   * Format: 'clarity-ai:<task-type>' or 'clarity-ai:<task-type>:<agent>'
   */
  private static readonly PATTERNS: Record<string, TaskRouteConfig> = {
    // Coding tasks (backwards compatible)
    'clarity-ai': { taskType: 'coding', agentType: 'claude-code' },
    'clarity-ai-claude': { taskType: 'coding', agentType: 'claude-code' },
    'clarity-ai-opencode': { taskType: 'coding', agentType: 'opencode' },

    // New task type patterns
    'clarity-ai:coding': { taskType: 'coding', agentType: 'claude-code' },
    'clarity-ai:coding:claude': { taskType: 'coding', agentType: 'claude-code' },
    'clarity-ai:coding:opencode': { taskType: 'coding', agentType: 'opencode' },

    // AgentAPI-based agents
    'clarity-ai:coding:aider': { taskType: 'coding', agentType: 'aider' },
    'clarity-ai:coding:goose': { taskType: 'coding', agentType: 'goose' },
    'clarity-ai:coding:codex': { taskType: 'coding', agentType: 'codex' },
    'clarity-ai:coding:gemini': { taskType: 'coding', agentType: 'gemini' },
    'clarity-ai:coding:cursor': { taskType: 'coding', agentType: 'cursor' },
    'clarity-ai:coding:copilot': { taskType: 'coding', agentType: 'copilot' },

    'clarity-ai:research': { taskType: 'research', agentType: 'research-agent' },
    'clarity-ai:research:claude': { taskType: 'research', agentType: 'claude-code' },

    'clarity-ai:debug': { taskType: 'debugging', agentType: 'debug-agent' },
    'clarity-ai:debug:claude': { taskType: 'debugging', agentType: 'claude-code' },

    'clarity-ai:automation': { taskType: 'automation', agentType: 'automation-agent' },
  };

  /**
   * Default agents per task type.
   */
  private static readonly DEFAULTS: Record<TaskType, AgentType> = {
    'coding': 'claude-code',
    'research': 'research-agent',
    'debugging': 'debug-agent',
    'automation': 'automation-agent',
    'custom': 'claude-code'
  };

  /**
   * Route based on trigger context (labels, explicit config, etc.)
   */
  static route(trigger: TriggerContext): TaskRouteConfig {
    // 1. Check labels (highest priority)
    for (const label of trigger.labels || []) {
      if (this.PATTERNS[label]) {
        return {
          ...this.PATTERNS[label],
          agentType: trigger.agentType || this.PATTERNS[label].agentType,
          provider: trigger.provider,
          model: trigger.model
        };
      }
    }

    // 2. Check explicit task type
    if (trigger.taskType) {
      return {
        taskType: trigger.taskType,
        agentType: trigger.agentType || this.DEFAULTS[trigger.taskType],
        provider: trigger.provider,
        model: trigger.model
      };
    }

    // 3. Default to coding
    return {
      taskType: 'coding',
      agentType: trigger.agentType || 'claude-code',
      provider: trigger.provider,
      model: trigger.model
    };
  }

  static registerPattern(pattern: string, config: TaskRouteConfig): void {
    this.PATTERNS[pattern] = config;
  }
}
```

## Migration Path

### Phase 1: Foundation (2 weeks)

**Goal**: Introduce new interfaces without breaking existing functionality.

1. Create new type files:
   - `container_src/src/tasks/types.ts` - TaskContext, TaskResult, DomainContext
   - `container_src/src/tasks/results.ts` - Output types
   - `container_src/src/tasks/strategy.interface.ts` - ITaskStrategy

2. Create adapter layer for existing code:
   - Adapters that wrap IAgentStrategy as ITaskStrategy
   - Adapters that wrap AgentExecutor as CodingTaskExecutor

3. No changes to existing flows - all current functionality continues to work.

### Phase 2: Coding Task Migration (2 weeks)

**Goal**: Migrate coding agents to new architecture.

1. Evolve AgentExecutor to CodingTaskExecutor
2. Update ClaudeCodeStrategy and OpenCodeStrategy to implement ICodingStrategy
3. Update AgentRouter to TaskRouter with new patterns

### Phase 3: Research Agent (2 weeks)

**Goal**: Implement first non-coding agent.

1. Create ResearchTaskExecutor
2. Create ResearchAgentStrategy (using Claude with research prompts)
3. Add `clarity-ai:research` label support

### Phase 4: Debugging Agent (2 weeks)

**Goal**: Implement debugging agent with MCP integration.

1. Create DebuggingTaskExecutor with MCP tool orchestration
2. Create DebugAgentStrategy with RCF generation skill
3. Integration with Grafana, Coralogix MCP servers

### Phase 5: AgentAPI Integration (2 weeks)

**Goal**: Enable 12+ coding agents via AgentAPI.

1. Add AgentAPI binary to container Dockerfile
2. Implement AgentAPIStrategy base class
3. Create manifests for: Aider, Goose, Codex, Gemini, Cursor, Copilot
4. Add `clarity-ai:coding:<agent>` label patterns
5. Test with each supported agent

### Phase 6: Agent Manifest System (1 week)

**Goal**: Enable pluggable agent registration.

1. Create manifest loader
2. Update factory to use manifests
3. Document manifest format

### Phase 7: Documentation & Cleanup (1 week)

**Goal**: Complete migration and document.

1. Deprecate old interfaces (keep as aliases)
2. Update CLAUDE.md
3. Add migration guide

## File Structure (After Migration)

```
container_src/src/
├── tasks/                           # NEW: Task system
│   ├── types.ts                     # TaskContext, TaskResult, DomainContext
│   ├── results.ts                   # Output types
│   ├── strategy.interface.ts        # ITaskStrategy, ICodingStrategy, etc.
│   ├── executor-registry.ts         # TaskExecutorRegistry
│   └── executors/
│       ├── coding.executor.ts       # CodingTaskExecutor
│       ├── research.executor.ts     # ResearchTaskExecutor
│       └── debugging.executor.ts    # DebuggingTaskExecutor
│
├── agents/                          # EVOLVED: Agent strategies
│   ├── types.ts                     # AgentType, AgentProvider (compatibility)
│   ├── strategy.interface.ts        # IAgentStrategy -> alias to ITaskStrategy
│   ├── factory.ts                   # Uses manifests
│   ├── manifest.ts                  # AgentManifest type
│   ├── manifests/                   # Agent manifest files
│   │   ├── claude-code.manifest.ts  # SDK-based
│   │   ├── opencode.manifest.ts     # SDK-based
│   │   ├── aider.manifest.ts        # AgentAPI-based
│   │   ├── goose.manifest.ts        # AgentAPI-based
│   │   ├── codex.manifest.ts        # AgentAPI-based
│   │   ├── gemini.manifest.ts       # AgentAPI-based
│   │   ├── research-agent.manifest.ts
│   │   └── debug-agent.manifest.ts
│   └── strategies/
│       ├── claude-code.strategy.ts  # ICodingStrategy (SDK-based)
│       ├── opencode.strategy.ts     # ICodingStrategy (SDK-based)
│       ├── agentapi.strategy.ts     # ICodingStrategy (AgentAPI universal adapter)
│       ├── research-agent.strategy.ts
│       └── debug-agent.strategy.ts
│
src/
├── tasks/                           # NEW: Worker-side task routing
│   ├── types.ts
│   └── router.ts                    # TaskRouter
│
├── agents/                          # KEPT: Backwards compatibility
│   ├── types.ts                     # Re-exports from tasks/
│   ├── router.ts                    # Re-exports TaskRouter
│   └── index.ts
```

## Backwards Compatibility

### API Compatibility

| Old API | New API | Status |
|---------|---------|--------|
| `IAgentStrategy` | `ITaskStrategy` | Alias + adapter |
| `AgentExecutor` | `CodingTaskExecutor` | Wrapper |
| `AgentRouter` | `TaskRouter` | Re-export |
| `IssueContext` | `TaskContext + CodingContext` | Type mapping |
| `AgentResult` | `TaskResult + CodingOutput` | Type mapping |
| `IssueQueueMessage` | `TaskQueueMessage` | Type alias |

### Label Compatibility

| Old Label | New Label | Behavior |
|-----------|-----------|----------|
| `clarity-ai` | `clarity-ai` | Unchanged (coding/claude-code) |
| `clarity-ai-claude` | `clarity-ai:coding:claude` | Both work |
| `clarity-ai-opencode` | `clarity-ai:coding:opencode` | Both work |
| N/A | `clarity-ai:research` | New |
| N/A | `clarity-ai:debug` | New |

## Consequences

### Positive

1. **Extensibility**: Add new task types and agents without modifying core code
2. **Separation of Concerns**: Task execution logic separated from domain logic
3. **Pluggable Agents**: Manifest-based registration enables external agents
4. **Type Safety**: Discriminated unions ensure correct context/output pairing
5. **Backwards Compatible**: Existing coding workflows unchanged

### Negative

1. **Increased Complexity**: More interfaces and types to understand
2. **Migration Effort**: ~12 weeks of development work
3. **Documentation**: Need to document new architecture thoroughly
4. **AgentAPI Dependency**: Adds Go binary dependency for universal agent support

### Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking changes | Extensive adapter layer, gradual migration |
| Performance overhead | Lazy loading, caching of manifests |
| Confusion with old/new APIs | Clear deprecation warnings, migration guide |
| Scope creep | Phase-based implementation, clear milestones |

## Alternatives Considered

### Alternative 1: Keep Coding-Only Architecture

**Decision**: Rejected - Limits future extensibility and requires code duplication for non-coding use cases.

### Alternative 2: Microservices Per Task Type

**Decision**: Rejected - Adds operational complexity without significant benefits for the current scale.

### Alternative 3: Plugin System Only (No Type Hierarchy)

**Decision**: Rejected - Loses type safety and makes it harder to ensure domain-specific behaviors.

### Alternative 4: AgentAPI Only (No SDK Integration)

**Decision**: Rejected - While AgentAPI provides universal adapter for 12+ agents, SDK-based integrations offer:
- Native API access with full features
- Session management and persistence (ADR-001)
- Type-safe integrations
- Better error handling and recovery

AgentAPI is adopted as a **complementary** integration method, not a replacement for SDK-based strategies.

## Success Metrics

1. **Extensibility**: Time to add new agent type < 4 hours
2. **Backwards Compatibility**: Zero breaking changes to existing workflows
3. **Adoption**: 3+ task types supported within 3 months
4. **Quality**: 90%+ test coverage on new code

## References

- [ADR-004: Add OpenCode Support](./ADR-004-add-opencode-support.md) - Current Strategy Pattern
- [ADR-001: Session Blob Persistence](./001-session-blob-persistence.md) - Session management
- [AgentAPI by Coder](https://github.com/coder/agentapi) - Universal HTTP adapter for coding agents
- [Cairn](https://github.com/cairn-dev/cairn) - Open-source background agent system (hierarchical patterns)
- [Strategy Pattern (Refactoring Guru)](https://refactoring.guru/design-patterns/strategy)
- [TypeScript Discriminated Unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)

### External Agent Documentation

- [Claude Code](https://docs.anthropic.com/claude-code) - Anthropic's official coding agent
- [OpenCode](https://github.com/anomalyco/opencode) - Open-source multi-provider agent
- [Aider](https://aider.chat/) - AI pair programming tool
- [Goose](https://github.com/block/goose) - Block's autonomous developer agent
- [Codex](https://github.com/openai/codex) - OpenAI's CLI coding agent
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) - Google's Gemini CLI

### Patterns & Inspiration Sources

| Pattern | Source | Implementation |
|---------|--------|----------------|
| Hierarchical Agent Decomposition | Cairn | Fullstack Planner → PM → SWE |
| Pre-Generated Task IDs | Cairn | Reliable parallel execution |
| PersistentDict (Auto-Save State) | Cairn | SQLite-backed transparent persistence |
| Inter-Agent Communication | Cairn | spy_on_agent tool for sibling coordination |
| Provider-Agnostic LLM | Cairn | Unified response interface across providers |
| Subprocess Workers | Cairn | Memory isolation, crash resilience |
| Configuration Layering | Cairn | Global → Repo → Agent memory |
| AgentAPI Universal Adapter | Coder | 12+ agents via HTTP API |
| Strategy Pattern | ADR-004 | Pluggable agent implementations |
| Session Persistence | ADR-001 | Resume interrupted tasks |
