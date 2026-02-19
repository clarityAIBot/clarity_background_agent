# ADR-004: Add OpenCode Support to Clarity AI

**Status**: Proposed
**Date**: 2026-01-15
**Author**: Engineering Team

## Context

### Current State

Clarity AI currently uses **Claude Code CLI** as its AI coding agent, running inside Cloudflare Containers:

```bash
claude --dangerously-skip-permissions -p "task prompt here"
```

The system:
1. Receives requests from GitHub Issues or Slack
2. Queues them via Cloudflare Queues
3. Spawns a container with Claude Code CLI installed
4. Executes the coding task via CLI
5. Creates PRs and reports back

### Motivation

**OpenCode** (https://github.com/anomalyco/opencode) is an open-source, multi-provider AI coding assistant that offers:

1. **Multi-Provider Support**: 20+ LLM providers (Anthropic, OpenAI, Google, Mistral, Groq, etc.)
2. **TypeScript SDK**: Native `@opencode-ai/sdk` package for programmatic integration
3. **Extensible Tool System**: MCP servers, custom plugins, LSP integration
4. **Session Management**: Create, pause, resume, fork sessions
5. **Real-time Streaming**: SSE events for live progress updates
6. **Open Source**: MIT licensed, fully customizable
7. **Cost Optimization**: Choose cheaper models for simpler tasks

## Decision

Add OpenCode as an alternative AI agent using **TypeScript SDK integration** alongside Claude Code CLI. Implement using the **Strategy Pattern** for clean, extensible architecture that allows easy addition of future agents.

## Architecture

### Strategy Pattern Overview

The Strategy Pattern allows us to:
- Define a family of agent algorithms (Claude Code, OpenCode, future agents)
- Encapsulate each one in a separate class
- Make them interchangeable at runtime
- Add new agents without modifying existing code (Open/Closed Principle)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         STRATEGY PATTERN ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      IAgentStrategy (Interface)                      │   │
│  │  ─────────────────────────────────────────────────────────────────  │   │
│  │  + execute(context: AgentContext): Promise<AgentResult>              │   │
│  │  + abort(): Promise<void>                                            │   │
│  │  + supportsStreaming(): boolean                                      │   │
│  │  + getCapabilities(): AgentCapabilities                              │   │
│  └──────────────────────────────┬──────────────────────────────────────┘   │
│                                 │                                           │
│                 ┌───────────────┼───────────────┐                          │
│                 │               │               │                          │
│                 ▼               ▼               ▼                          │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐           │
│  │ ClaudeCodeStrategy│ │ OpenCodeStrategy │ │ Future Agents... │           │
│  │                  │ │                  │ │                  │           │
│  │ - CLI execution  │ │ - SDK execution  │ │ - Easy to add    │           │
│  │ - Anthropic only │ │ - Multi-provider │ │ - Implement      │           │
│  │ - Parse stdout   │ │ - SSE streaming  │ │   IAgentStrategy │           │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘           │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                       AgentStrategyFactory                           │   │
│  │  ─────────────────────────────────────────────────────────────────  │   │
│  │  + create(config: AgentConfig): IAgentStrategy                       │   │
│  │  + register(type: string, factory: () => IAgentStrategy)            │   │
│  │  + getAvailableAgents(): string[]                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        AgentExecutor (Context)                       │   │
│  │  ─────────────────────────────────────────────────────────────────  │   │
│  │  - strategy: IAgentStrategy                                          │   │
│  │  + setStrategy(strategy: IAgentStrategy): void                       │   │
│  │  + execute(context: AgentContext): Promise<AgentResult>              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### File Structure

```
src/
├── agents/
│   ├── index.ts                    # Public exports
│   ├── types.ts                    # Shared types and interfaces
│   ├── strategy.interface.ts       # IAgentStrategy interface
│   ├── executor.ts                 # AgentExecutor (context class)
│   ├── factory.ts                  # AgentStrategyFactory
│   ├── strategies/
│   │   ├── index.ts                # Strategy exports
│   │   ├── claude-code.strategy.ts # Claude Code implementation
│   │   └── opencode.strategy.ts    # OpenCode implementation
│   └── utils/
│       ├── command-runner.ts       # Shell command utilities
│       └── api-key-resolver.ts     # Provider API key resolution
```

### Core Interfaces

```typescript
// src/agents/types.ts

export type AgentType = 'claude-code' | 'opencode';

export interface AgentConfig {
  type: AgentType;
  provider?: string;      // For OpenCode: anthropic, openai, google, etc.
  model?: string;         // Specific model override
  maxTurns?: number;      // Maximum agent turns
  timeout?: number;       // Execution timeout in ms
}

export interface AgentContext {
  workingDir: string;
  prompt: string;
  config: AgentConfig;
  env: Env;
  requestId: string;
  onProgress?: (event: AgentProgressEvent) => void;
  signal?: AbortSignal;
}

export interface AgentResult {
  success: boolean;
  sessionId?: string;
  messages: AgentMessage[];
  diff?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
}

export interface AgentProgressEvent {
  type: 'started' | 'thinking' | 'tool_use' | 'completed' | 'error';
  message?: string;
  data?: unknown;
  timestamp: Date;
}

export interface AgentCapabilities {
  supportsStreaming: boolean;
  supportsSessionManagement: boolean;
  supportedProviders: string[];
  maxContextLength?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
}
```

### Strategy Interface

```typescript
// src/agents/strategy.interface.ts

import type {
  AgentContext,
  AgentResult,
  AgentCapabilities
} from './types';

/**
 * Strategy interface for AI coding agents.
 * Implement this interface to add new agent types.
 */
export interface IAgentStrategy {
  /**
   * Unique identifier for this agent strategy
   */
  readonly name: string;

  /**
   * Human-readable display name
   */
  readonly displayName: string;

  /**
   * Execute the agent with the given context
   */
  execute(context: AgentContext): Promise<AgentResult>;

  /**
   * Abort any running execution
   */
  abort(): Promise<void>;

  /**
   * Check if the agent supports real-time streaming
   */
  supportsStreaming(): boolean;

  /**
   * Get the capabilities of this agent
   */
  getCapabilities(): AgentCapabilities;

  /**
   * Validate that the agent can run with the given config
   */
  validate(context: AgentContext): Promise<{ valid: boolean; errors?: string[] }>;

  /**
   * Clean up any resources (called after execution)
   */
  cleanup(): Promise<void>;
}
```

### Claude Code Strategy Implementation

```typescript
// src/agents/strategies/claude-code.strategy.ts

import type { IAgentStrategy } from '../strategy.interface';
import type {
  AgentContext,
  AgentResult,
  AgentCapabilities,
  AgentMessage
} from '../types';
import { runCommand } from '../utils/command-runner';

export class ClaudeCodeStrategy implements IAgentStrategy {
  readonly name = 'claude-code';
  readonly displayName = 'Claude Code';

  private abortController: AbortController | null = null;
  private childProcess: ChildProcess | null = null;

  async execute(context: AgentContext): Promise<AgentResult> {
    const { workingDir, prompt, config, onProgress } = context;

    this.abortController = new AbortController();

    // Notify start
    onProgress?.({
      type: 'started',
      message: 'Starting Claude Code CLI...',
      timestamp: new Date()
    });

    try {
      const args = [
        'claude',
        '--dangerously-skip-permissions',
        '--output-format', 'json',
        '--max-turns', String(config.maxTurns || 100),
        '-p', prompt
      ];

      const { stdout, stderr, exitCode, process } = await runCommand(
        args.join(' '),
        {
          cwd: workingDir,
          signal: this.abortController.signal,
          env: {
            ANTHROPIC_API_KEY: context.env.ANTHROPIC_API_KEY
          }
        }
      );

      this.childProcess = process;

      if (exitCode !== 0) {
        return {
          success: false,
          messages: [],
          error: stderr || `Claude Code exited with code ${exitCode}`
        };
      }

      // Parse JSON output
      const output = this.parseOutput(stdout);

      onProgress?.({
        type: 'completed',
        message: 'Claude Code execution completed',
        timestamp: new Date()
      });

      return {
        success: true,
        messages: output.messages,
        diff: output.diff,
        metadata: {
          exitCode,
          agent: this.name
        }
      };

    } catch (error) {
      onProgress?.({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      });

      return {
        success: false,
        messages: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async abort(): Promise<void> {
    this.abortController?.abort();
    this.childProcess?.kill('SIGTERM');
  }

  supportsStreaming(): boolean {
    return false; // CLI mode doesn't support real-time streaming
  }

  getCapabilities(): AgentCapabilities {
    return {
      supportsStreaming: false,
      supportsSessionManagement: false,
      supportedProviders: ['anthropic'],
      maxContextLength: 200000
    };
  }

  async validate(context: AgentContext): Promise<{ valid: boolean; errors?: string[] }> {
    const errors: string[] = [];

    if (!context.env.ANTHROPIC_API_KEY) {
      errors.push('ANTHROPIC_API_KEY is required for Claude Code');
    }

    if (!context.prompt || context.prompt.trim() === '') {
      errors.push('Prompt is required');
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  async cleanup(): Promise<void> {
    this.abortController = null;
    this.childProcess = null;
  }

  private parseOutput(stdout: string): { messages: AgentMessage[]; diff?: string } {
    try {
      const json = JSON.parse(stdout);
      return {
        messages: json.messages || [],
        diff: json.diff
      };
    } catch {
      // If not JSON, treat as plain text
      return {
        messages: [{
          id: crypto.randomUUID(),
          role: 'assistant',
          content: stdout,
          timestamp: new Date()
        }]
      };
    }
  }
}
```

### OpenCode Strategy Implementation

```typescript
// src/agents/strategies/opencode.strategy.ts

import { createOpencode, createOpencodeClient } from '@opencode-ai/sdk';
import type { IAgentStrategy } from '../strategy.interface';
import type {
  AgentContext,
  AgentResult,
  AgentCapabilities,
  AgentMessage,
  AgentProgressEvent
} from '../types';
import { getApiKeyForProvider } from '../utils/api-key-resolver';

export class OpenCodeStrategy implements IAgentStrategy {
  readonly name = 'opencode';
  readonly displayName = 'OpenCode';

  private abortController: AbortController | null = null;
  private server: { url: string; close: () => void } | null = null;
  private sessionId: string | null = null;

  async execute(context: AgentContext): Promise<AgentResult> {
    const { workingDir, prompt, config, env, onProgress } = context;

    this.abortController = new AbortController();

    onProgress?.({
      type: 'started',
      message: `Starting OpenCode with ${config.provider || 'anthropic'} provider...`,
      timestamp: new Date()
    });

    try {
      // Get API key for the selected provider
      const apiKey = getApiKeyForProvider(config.provider || 'anthropic', env);
      if (!apiKey) {
        throw new Error(`API key not found for provider: ${config.provider || 'anthropic'}`);
      }

      // Create OpenCode instance with auto-spawned server
      const { client, server } = await createOpencode({
        port: 0, // Auto-assign port
        signal: this.abortController.signal,
        timeout: 10000,
        config: {
          provider: { name: config.provider || 'anthropic' },
          model: config.model ? { id: config.model } : undefined
        }
      });

      this.server = server;

      // Create client with working directory
      const opencodeClient = createOpencodeClient({
        baseUrl: server.url,
        directory: workingDir
      });

      // Create a new session
      const sessionResponse = await opencodeClient.session.create({
        body: {
          title: `Clarity AI Task - ${context.requestId}`
        }
      });

      if (!sessionResponse.data) {
        throw new Error('Failed to create OpenCode session');
      }

      this.sessionId = sessionResponse.data.id;

      // Subscribe to events for real-time progress
      if (onProgress) {
        this.subscribeToEvents(opencodeClient, onProgress);
      }

      onProgress?.({
        type: 'thinking',
        message: 'Processing prompt...',
        timestamp: new Date()
      });

      // Send the prompt and wait for completion
      await opencodeClient.session.prompt({
        path: { id: this.sessionId },
        body: { content: prompt }
      });

      // Get all messages for the response
      const messagesResponse = await opencodeClient.session.messages({
        path: { id: this.sessionId }
      });

      // Get the diff (file changes)
      const diffResponse = await opencodeClient.session.diff({
        path: { id: this.sessionId }
      });

      // Get final session state
      const sessionState = await opencodeClient.session.get({
        path: { id: this.sessionId }
      });

      onProgress?.({
        type: 'completed',
        message: 'OpenCode execution completed',
        timestamp: new Date()
      });

      return {
        success: true,
        sessionId: this.sessionId,
        messages: this.transformMessages(messagesResponse.data || []),
        diff: diffResponse.data,
        metadata: {
          agent: this.name,
          provider: config.provider || 'anthropic',
          model: config.model,
          sessionState: sessionState.data
        }
      };

    } catch (error) {
      onProgress?.({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      });

      return {
        success: false,
        messages: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async abort(): Promise<void> {
    // Abort the session if running
    if (this.sessionId && this.server) {
      try {
        const client = createOpencodeClient({ baseUrl: this.server.url });
        await client.session.abort({ path: { id: this.sessionId } });
      } catch {
        // Ignore abort errors
      }
    }

    this.abortController?.abort();
  }

  supportsStreaming(): boolean {
    return true;
  }

  getCapabilities(): AgentCapabilities {
    return {
      supportsStreaming: true,
      supportsSessionManagement: true,
      supportedProviders: [
        'anthropic',
        'openai',
        'google',
        'mistral',
        'groq',
        'deepseek',
        'together',
        'fireworks'
      ],
      maxContextLength: 200000
    };
  }

  async validate(context: AgentContext): Promise<{ valid: boolean; errors?: string[] }> {
    const errors: string[] = [];
    const provider = context.config.provider || 'anthropic';

    const apiKey = getApiKeyForProvider(provider, context.env);
    if (!apiKey) {
      errors.push(`API key not found for provider: ${provider}`);
    }

    if (!context.prompt || context.prompt.trim() === '') {
      errors.push('Prompt is required');
    }

    const capabilities = this.getCapabilities();
    if (!capabilities.supportedProviders.includes(provider)) {
      errors.push(`Unsupported provider: ${provider}`);
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  async cleanup(): Promise<void> {
    // Close the server
    this.server?.close();
    this.server = null;
    this.sessionId = null;
    this.abortController = null;
  }

  private subscribeToEvents(
    client: ReturnType<typeof createOpencodeClient>,
    onProgress: (event: AgentProgressEvent) => void
  ): void {
    const eventStream = client.event.subscribe();

    (async () => {
      try {
        for await (const event of eventStream) {
          const progressEvent = this.transformEvent(event);
          if (progressEvent) {
            onProgress(progressEvent);
          }
        }
      } catch {
        // Stream closed, ignore
      }
    })();
  }

  private transformEvent(event: unknown): AgentProgressEvent | null {
    const e = event as { type?: string; data?: unknown };

    switch (e.type) {
      case 'message.start':
        return { type: 'thinking', message: 'Agent is thinking...', timestamp: new Date() };
      case 'tool.start':
        return { type: 'tool_use', message: `Using tool...`, data: e.data, timestamp: new Date() };
      case 'message.complete':
        return { type: 'completed', message: 'Message complete', timestamp: new Date() };
      default:
        return null;
    }
  }

  private transformMessages(messages: unknown[]): AgentMessage[] {
    return messages.map((msg: any) => ({
      id: msg.id || crypto.randomUUID(),
      role: msg.role || 'assistant',
      content: msg.content || '',
      timestamp: new Date(msg.createdAt || Date.now()),
      toolCalls: msg.toolCalls
    }));
  }
}
```

### Strategy Factory

```typescript
// src/agents/factory.ts

import type { IAgentStrategy } from './strategy.interface';
import type { AgentConfig, AgentType } from './types';
import { ClaudeCodeStrategy } from './strategies/claude-code.strategy';
import { OpenCodeStrategy } from './strategies/opencode.strategy';

type StrategyConstructor = new () => IAgentStrategy;

/**
 * Factory for creating agent strategy instances.
 * Supports registration of new strategy types at runtime.
 */
export class AgentStrategyFactory {
  private static strategies: Map<AgentType, StrategyConstructor> = new Map();
  private static instances: Map<AgentType, IAgentStrategy> = new Map();

  /**
   * Initialize the factory with default strategies
   */
  static initialize(): void {
    this.register('claude-code', ClaudeCodeStrategy);
    this.register('opencode', OpenCodeStrategy);
  }

  /**
   * Register a new strategy type
   */
  static register(type: AgentType, strategyClass: StrategyConstructor): void {
    this.strategies.set(type, strategyClass);
  }

  /**
   * Create or get a cached strategy instance
   */
  static create(config: AgentConfig): IAgentStrategy {
    const { type } = config;

    // Return cached instance if available
    if (this.instances.has(type)) {
      return this.instances.get(type)!;
    }

    const StrategyClass = this.strategies.get(type);
    if (!StrategyClass) {
      throw new Error(`Unknown agent type: ${type}. Available: ${this.getAvailableAgents().join(', ')}`);
    }

    const instance = new StrategyClass();
    this.instances.set(type, instance);

    return instance;
  }

  /**
   * Get list of available agent types
   */
  static getAvailableAgents(): AgentType[] {
    return Array.from(this.strategies.keys());
  }

  /**
   * Get capabilities for all registered agents
   */
  static getAllCapabilities(): Record<AgentType, ReturnType<IAgentStrategy['getCapabilities']>> {
    const result: Record<string, ReturnType<IAgentStrategy['getCapabilities']>> = {};

    for (const [type, StrategyClass] of this.strategies) {
      const instance = new StrategyClass();
      result[type] = instance.getCapabilities();
    }

    return result as Record<AgentType, ReturnType<IAgentStrategy['getCapabilities']>>;
  }

  /**
   * Clear all cached instances (for testing)
   */
  static clearCache(): void {
    this.instances.clear();
  }
}

// Initialize with default strategies
AgentStrategyFactory.initialize();
```

### Agent Executor (Context Class)

```typescript
// src/agents/executor.ts

import type { IAgentStrategy } from './strategy.interface';
import type { AgentContext, AgentResult, AgentConfig } from './types';
import { AgentStrategyFactory } from './factory';

/**
 * AgentExecutor is the context class that uses strategies.
 * It delegates execution to the appropriate strategy based on config.
 */
export class AgentExecutor {
  private strategy: IAgentStrategy | null = null;
  private currentContext: AgentContext | null = null;

  /**
   * Set the strategy to use
   */
  setStrategy(strategy: IAgentStrategy): void {
    this.strategy = strategy;
  }

  /**
   * Set strategy by agent type
   */
  setStrategyByType(config: AgentConfig): void {
    this.strategy = AgentStrategyFactory.create(config);
  }

  /**
   * Execute the current strategy with the given context
   */
  async execute(context: AgentContext): Promise<AgentResult> {
    // Auto-select strategy if not set
    if (!this.strategy) {
      this.setStrategyByType(context.config);
    }

    if (!this.strategy) {
      return {
        success: false,
        messages: [],
        error: 'No agent strategy configured'
      };
    }

    this.currentContext = context;

    // Validate before execution
    const validation = await this.strategy.validate(context);
    if (!validation.valid) {
      return {
        success: false,
        messages: [],
        error: `Validation failed: ${validation.errors?.join(', ')}`
      };
    }

    try {
      const result = await this.strategy.execute(context);
      return result;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Abort current execution
   */
  async abort(): Promise<void> {
    await this.strategy?.abort();
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    await this.strategy?.cleanup();
    this.currentContext = null;
  }

  /**
   * Get current strategy info
   */
  getStrategyInfo(): { name: string; displayName: string } | null {
    if (!this.strategy) return null;
    return {
      name: this.strategy.name,
      displayName: this.strategy.displayName
    };
  }

  /**
   * Check if current strategy supports streaming
   */
  supportsStreaming(): boolean {
    return this.strategy?.supportsStreaming() ?? false;
  }
}
```

### Agent Router (Selection Logic)

```typescript
// src/agents/router.ts

import type { AgentConfig, AgentType } from './types';

interface IssueData {
  labels?: string[];
  agentType?: AgentType;
  agentProvider?: string;
  agentModel?: string;
}

/**
 * Router to determine which agent to use based on issue data
 */
export class AgentRouter {
  private static readonly LABEL_MAPPINGS: Record<string, AgentConfig> = {
    'clarity-ai-opencode': { type: 'opencode', provider: 'anthropic' },
    'clarity-ai-claude': { type: 'claude-code' },
    'clarity-ai': { type: 'claude-code' } // Default label
    // Additional label mappings can be added later:
    // 'clarity-ai-opencode-openai': { type: 'opencode', provider: 'openai' },
    // 'clarity-ai-opencode-google': { type: 'opencode', provider: 'google' },
    // 'clarity-ai-opencode-groq': { type: 'opencode', provider: 'groq' },
  };

  private static readonly DEFAULT_CONFIG: AgentConfig = {
    type: 'claude-code'
  };

  /**
   * Determine which agent config to use based on issue data
   */
  static route(issueData: IssueData): AgentConfig {
    // 1. Check issue labels (highest priority)
    const labels = issueData.labels || [];
    for (const label of labels) {
      if (this.LABEL_MAPPINGS[label]) {
        const config = { ...this.LABEL_MAPPINGS[label] };
        // Allow provider/model override from issue data
        if (issueData.agentProvider) config.provider = issueData.agentProvider;
        if (issueData.agentModel) config.model = issueData.agentModel;
        return config;
      }
    }

    // 2. Check explicit agent type from queue message
    if (issueData.agentType) {
      return {
        type: issueData.agentType,
        provider: issueData.agentProvider,
        model: issueData.agentModel
      };
    }

    // 3. Return default
    return this.DEFAULT_CONFIG;
  }

  /**
   * Register a custom label mapping
   */
  static registerLabelMapping(label: string, config: AgentConfig): void {
    this.LABEL_MAPPINGS[label] = config;
  }
}
```

### Slack Interactivity for Agent Selection

Users can select which agent to use via Slack interactive components (Block Kit).

#### Option 1: Slash Command with Modal

```typescript
// src/slack/commands/clarity.ts

import { App } from '@slack/bolt';

export function registerClarityCommand(app: App) {
  // /clarity command opens modal for agent selection
  app.command('/clarity', async ({ ack, body, client }) => {
    await ack();

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'clarity_task_modal',
        title: { type: 'plain_text', text: 'New Clarity AI Task' },
        submit: { type: 'plain_text', text: 'Submit' },
        blocks: [
          {
            type: 'input',
            block_id: 'task_description',
            label: { type: 'plain_text', text: 'Task Description' },
            element: {
              type: 'plain_text_input',
              action_id: 'task_input',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: 'Describe what you want Clarity AI to do...'
              }
            }
          },
          {
            type: 'input',
            block_id: 'agent_selection',
            label: { type: 'plain_text', text: 'AI Agent' },
            element: {
              type: 'static_select',
              action_id: 'agent_select',
              placeholder: { type: 'plain_text', text: 'Select an agent' },
              initial_option: {
                text: { type: 'plain_text', text: 'Claude Code (Default)' },
                value: 'claude-code'
              },
              options: [
                {
                  text: { type: 'plain_text', text: 'Claude Code (Default)' },
                  value: 'claude-code'
                },
                {
                  text: { type: 'plain_text', text: 'OpenCode - Anthropic' },
                  value: 'opencode:anthropic'
                }
                // Additional providers can be added later:
                // { text: { type: 'plain_text', text: 'OpenCode - OpenAI' }, value: 'opencode:openai' },
                // { text: { type: 'plain_text', text: 'OpenCode - Google' }, value: 'opencode:google' },
                // { text: { type: 'plain_text', text: 'OpenCode - Groq (Fast)' }, value: 'opencode:groq' },
                // { text: { type: 'plain_text', text: 'OpenCode - DeepSeek (Budget)' }, value: 'opencode:deepseek' },
              ]
            }
          },
          {
            type: 'input',
            block_id: 'repo_selection',
            label: { type: 'plain_text', text: 'Repository' },
            element: {
              type: 'external_select',
              action_id: 'repo_select',
              placeholder: { type: 'plain_text', text: 'Select a repository' },
              min_query_length: 0
            }
          }
        ]
      }
    });
  });

  // Handle modal submission
  app.view('clarity_task_modal', async ({ ack, body, view, client }) => {
    await ack();

    const values = view.state.values;
    const taskDescription = values.task_description.task_input.value;
    const agentValue = values.agent_selection.agent_select.selected_option?.value;
    const repo = values.repo_selection.repo_select.selected_option?.value;

    // Parse agent selection (format: "type:provider" or just "type")
    const [agentType, agentProvider] = (agentValue || 'claude-code').split(':');

    // Queue the task with agent configuration
    await queueClarityTask({
      taskDescription,
      agentType: agentType as AgentType,
      agentProvider,
      repo,
      userId: body.user.id,
      channelId: body.user.id // DM the user
    });

    // Send confirmation
    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ Task queued using *${agentType}*${agentProvider ? ` (${agentProvider})` : ''}:\n>${taskDescription}`
    });
  });
}
```

#### Option 2: Inline Message with Dropdown

For responding to messages with agent selection:

```typescript
// src/slack/interactivity/agent-selector.ts

export function createAgentSelectorBlocks(messageTs: string): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Select an AI agent to process this task:'
      }
    },
    {
      type: 'actions',
      block_id: `agent_action_${messageTs}`,
      elements: [
        {
          type: 'static_select',
          action_id: 'select_agent',
          placeholder: { type: 'plain_text', text: 'Choose agent...' },
          options: [
            {
              text: { type: 'plain_text', text: '🟠 Claude Code' },
              value: 'claude-code'
            },
            {
              text: { type: 'plain_text', text: '🟢 OpenCode (Anthropic)' },
              value: 'opencode:anthropic'
            }
            // Additional providers can be added later
          ]
        },
        {
          type: 'button',
          action_id: 'cancel_task',
          text: { type: 'plain_text', text: 'Cancel' },
          style: 'danger'
        }
      ]
    }
  ];
}

// Handle agent selection action
export function registerAgentSelectionHandler(app: App) {
  app.action('select_agent', async ({ ack, body, action, client }) => {
    await ack();

    const selectedValue = (action as StaticSelectAction).selected_option.value;
    const [agentType, agentProvider] = selectedValue.split(':');

    // Extract the original message context
    const messageTs = body.message?.ts;
    const channelId = body.channel?.id;

    // Update the message to show selection
    await client.chat.update({
      channel: channelId!,
      ts: messageTs!,
      text: `Processing with *${agentType}*${agentProvider ? ` (${agentProvider})` : ''}...`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⏳ Processing with *${agentType}*${agentProvider ? ` (${agentProvider})` : ''}...`
          }
        }
      ]
    });

    // Queue the task
    await queueClarityTask({
      agentType: agentType as AgentType,
      agentProvider,
      channelId: channelId!,
      threadTs: messageTs!,
      // ... other task details from context
    });
  });
}
```

#### Option 3: Slash Command with Arguments

Simple inline syntax for power users:

```typescript
// src/slack/commands/clarity-inline.ts

// Usage: /clarity-task --agent=opencode:groq Fix the login bug in auth.ts
app.command('/clarity-task', async ({ ack, body, client, command }) => {
  await ack();

  const text = command.text;

  // Parse arguments
  const agentMatch = text.match(/--agent=(\S+)/);
  const modelMatch = text.match(/--model=(\S+)/);
  const taskDescription = text
    .replace(/--agent=\S+/g, '')
    .replace(/--model=\S+/g, '')
    .trim();

  let agentType: AgentType = 'claude-code';
  let agentProvider: string | undefined;
  let agentModel: string | undefined;

  if (agentMatch) {
    const [type, provider] = agentMatch[1].split(':');
    agentType = type as AgentType;
    agentProvider = provider;
  }

  if (modelMatch) {
    agentModel = modelMatch[1];
  }

  // Queue with parsed config
  await queueClarityTask({
    taskDescription,
    agentType,
    agentProvider,
    agentModel,
    userId: body.user_id,
    channelId: body.channel_id
  });

  await client.chat.postMessage({
    channel: body.channel_id,
    text: `🚀 Task queued:\n• Agent: *${agentType}*${agentProvider ? ` (${agentProvider})` : ''}\n• Task: ${taskDescription}`
  });
});
```

#### Queue Message Schema Update

```typescript
// src/queue/types.ts

export interface IssueQueueMessage {
  // ... existing fields

  // Agent configuration from Slack interactivity
  agentType?: AgentType;      // 'claude-code' | 'opencode'
  agentProvider?: string;     // 'anthropic' | 'openai' | 'google' | 'groq' | etc.
  agentModel?: string;        // Specific model override

  // Slack context
  slackUserId?: string;
  slackChannelId?: string;
  slackThreadTs?: string;
}
```

#### Slack Interactivity Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     SLACK AGENT SELECTION FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User                    Slack                    Clarity AI                │
│   │                        │                          │                     │
│   │  /clarity              │                          │                     │
│   │───────────────────────>│                          │                     │
│   │                        │                          │                     │
│   │    Modal with          │                          │                     │
│   │    Agent Dropdown      │                          │                     │
│   │<───────────────────────│                          │                     │
│   │                        │                          │                     │
│   │  Select "OpenCode      │                          │                     │
│   │  (Groq)" + Task        │                          │                     │
│   │───────────────────────>│                          │                     │
│   │                        │                          │                     │
│   │                        │  Queue Message:          │                     │
│   │                        │  {                       │                     │
│   │                        │    agentType: "opencode" │                     │
│   │                        │    agentProvider: "groq" │                     │
│   │                        │    task: "..."           │                     │
│   │                        │  }                       │                     │
│   │                        │─────────────────────────>│                     │
│   │                        │                          │                     │
│   │                        │                          │  AgentRouter.route()│
│   │                        │                          │  -> OpenCodeStrategy│
│   │                        │                          │     with Groq       │
│   │                        │                          │                     │
│   │   "Processing with     │                          │                     │
│   │    OpenCode (Groq)..." │                          │                     │
│   │<───────────────────────│<─────────────────────────│                     │
│   │                        │                          │                     │
│   │   "✅ PR Created"      │                          │                     │
│   │<───────────────────────│<─────────────────────────│                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Updated Consumer Integration

```typescript
// src/queue/consumer.ts

import { AgentExecutor } from '../agents/executor';
import { AgentRouter } from '../agents/router';
import type { AgentContext, AgentProgressEvent } from '../agents/types';

export async function processIssue(
  issueData: IssueQueueMessage,
  env: Env
): Promise<void> {
  // 1. Route to determine agent config
  const agentConfig = AgentRouter.route({
    labels: issueData.issueLabels,
    agentType: issueData.agentType,
    agentProvider: issueData.agentProvider,
    agentModel: issueData.agentModel
  });

  // 2. Create executor and set strategy
  const executor = new AgentExecutor();
  executor.setStrategyByType(agentConfig);

  // 3. Log agent selection
  const strategyInfo = executor.getStrategyInfo();
  console.log(`[${issueData.requestId}] Using agent: ${strategyInfo?.displayName}`);

  // 4. Create context
  const context: AgentContext = {
    workingDir: `/workspace/${issueData.repo}`,
    prompt: buildPrompt(issueData),
    config: agentConfig,
    env,
    requestId: issueData.requestId,
    onProgress: (event) => handleProgress(issueData.requestId, event)
  };

  // 5. Execute
  try {
    const result = await executor.execute(context);

    if (result.success) {
      // Update database with result
      await updateRequestStatus(issueData.requestId, 'completed', {
        agentType: agentConfig.type,
        agentProvider: agentConfig.provider,
        agentModel: agentConfig.model,
        sessionId: result.sessionId,
        diff: result.diff
      });

      // Create PR if there are changes
      if (result.diff) {
        await createPullRequest(issueData, result);
      }
    } else {
      await updateRequestStatus(issueData.requestId, 'failed', {
        error: result.error
      });
    }
  } catch (error) {
    await executor.abort();
    throw error;
  }
}

function handleProgress(requestId: string, event: AgentProgressEvent): void {
  // Log progress and optionally send to WebSocket for real-time UI
  console.log(`[${requestId}] ${event.type}: ${event.message}`);

  // Send to connected clients if streaming is enabled
  broadcastProgress(requestId, event);
}
```

### Adding a New Agent (Example: Aider)

To add a new agent in the future, simply:

```typescript
// src/agents/strategies/aider.strategy.ts

import type { IAgentStrategy } from '../strategy.interface';
import type { AgentContext, AgentResult, AgentCapabilities } from '../types';

export class AiderStrategy implements IAgentStrategy {
  readonly name = 'aider';
  readonly displayName = 'Aider';

  async execute(context: AgentContext): Promise<AgentResult> {
    // Implement Aider-specific execution
    const command = `aider --yes --model ${context.config.model || 'gpt-4'} "${context.prompt}"`;
    // ... implementation
  }

  async abort(): Promise<void> { /* ... */ }
  supportsStreaming(): boolean { return false; }
  getCapabilities(): AgentCapabilities { /* ... */ }
  async validate(context: AgentContext): Promise<{ valid: boolean; errors?: string[] }> { /* ... */ }
  async cleanup(): Promise<void> { /* ... */ }
}

// Register in factory.ts
AgentStrategyFactory.register('aider', AiderStrategy);
```

### Container Dockerfile Updates

```dockerfile
FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 python3-pip git build-essential ca-certificates curl

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code@latest

# Install OpenCode binary (for SDK's auto-spawn server)
RUN curl -fsSL https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-x64 \
    -o /usr/local/bin/opencode && \
    chmod +x /usr/local/bin/opencode

# Verify installations
RUN claude --version && opencode --version

# ... rest of setup
```

### Package.json Dependencies

```json
{
  "dependencies": {
    "@opencode-ai/sdk": "^1.1.20"
  }
}
```

### Database Schema Changes

```sql
-- Add agent columns to feature_requests table
ALTER TABLE feature_requests
ADD COLUMN agent_type VARCHAR(20) DEFAULT 'claude-code',
ADD COLUMN agent_provider VARCHAR(50),
ADD COLUMN agent_model VARCHAR(100),
ADD COLUMN opencode_session_id VARCHAR(100);
```

```typescript
// src/db/schema.ts - Update FeatureRequest type
export const featureRequests = pgTable('feature_requests', {
  // ... existing fields

  // Agent configuration
  agentType: varchar('agent_type', { length: 20 }).default('claude-code'),
  agentProvider: varchar('agent_provider', { length: 50 }),
  agentModel: varchar('agent_model', { length: 100 }),
  opencodeSessionId: varchar('opencode_session_id', { length: 100 }),
});
```

### Environment Variables

```bash
# Existing
ANTHROPIC_API_KEY=sk-ant-...

# New for OpenCode multi-provider
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AIza...
MISTRAL_API_KEY=...
GROQ_API_KEY=gsk_...
```

### Frontend Updates

**Task Detail View - Agent Badge:**
```svelte
<!-- TaskDetailView.svelte -->
<div class="flex items-center gap-2">
  {#if detail.request.agentType === 'opencode'}
    <span class="text-xs px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
      OpenCode
      {#if detail.request.agentProvider}
        • {detail.request.agentProvider}
      {/if}
      {#if detail.request.agentModel}
        • {detail.request.agentModel}
      {/if}
    </span>
  {:else}
    <span class="text-xs px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400">
      Claude Code
    </span>
  {/if}
</div>
```

### GitHub Labels

| Label | Description | Color |
|-------|-------------|-------|
| `clarity-ai` | Default (Claude Code) | Blue |
| `clarity-ai-claude` | Force Claude Code | Orange |
| `clarity-ai-opencode` | Use OpenCode (Anthropic) | Green |

<!-- Additional labels can be added later:
| `clarity-ai-opencode-openai` | OpenCode + OpenAI | Green |
| `clarity-ai-opencode-google` | OpenCode + Google | Green |
| `clarity-ai-opencode-groq` | OpenCode + Groq | Green |
| `clarity-ai-opencode-deepseek` | OpenCode + DeepSeek | Green |
-->

## Implementation Plan

### Phase 1: Strategy Pattern Foundation
- [ ] Create `src/agents/` directory structure
- [ ] Define `IAgentStrategy` interface
- [ ] Implement `AgentStrategyFactory`
- [ ] Implement `AgentExecutor`
- [ ] Implement `AgentRouter`

### Phase 2: Claude Code Strategy
- [ ] Migrate existing Claude Code logic to `ClaudeCodeStrategy`
- [ ] Add validation and cleanup methods
- [ ] Add progress reporting
- [ ] Write unit tests

### Phase 3: OpenCode Strategy
- [ ] Add `@opencode-ai/sdk` dependency
- [ ] Implement `OpenCodeStrategy` with SDK integration
- [ ] Add SSE event streaming support
- [ ] Add session management
- [ ] Write unit tests

### Phase 4: Consumer Integration
- [ ] Update `consumer.ts` to use `AgentExecutor`
- [ ] Update queue message schema
- [ ] Add progress broadcasting

### Phase 5: Database & Frontend
- [ ] Add migration for agent columns
- [ ] Update schema types
- [ ] Add agent badge to TaskDetailView
- [ ] Add real-time progress display

### Phase 6: Configuration & Docs
- [ ] Add provider API keys to secrets
- [ ] Document adding new agents
- [ ] Create agent comparison guide

## Provider Support

### Supported Providers via OpenCode

| Provider | Env Variable | Models |
|----------|--------------|--------|
| Anthropic | `ANTHROPIC_API_KEY` | Claude 3.5 Sonnet, Opus, Haiku |
| OpenAI | `OPENAI_API_KEY` | GPT-4o, GPT-4 Turbo, o1 |
| Google | `GOOGLE_API_KEY` | Gemini 1.5 Pro, Flash |
| Mistral | `MISTRAL_API_KEY` | Mistral Large, Medium |
| Groq | `GROQ_API_KEY` | Llama 3.1, Mixtral |
| DeepSeek | `DEEPSEEK_API_KEY` | DeepSeek V3 |
| Together | `TOGETHER_API_KEY` | Various open models |
| Fireworks | `FIREWORKS_API_KEY` | Various open models |

### Cost Comparison

| Provider | Model | Input ($/1M) | Output ($/1M) |
|----------|-------|--------------|---------------|
| Anthropic | Claude 3.5 Sonnet | $3.00 | $15.00 |
| OpenAI | GPT-4o | $2.50 | $10.00 |
| Google | Gemini 1.5 Pro | $1.25 | $5.00 |
| Groq | Llama 3.1 70B | $0.59 | $0.79 |
| DeepSeek | DeepSeek V3 | $0.14 | $0.28 |

## Benefits of Strategy Pattern

### 1. **Open/Closed Principle**
- Add new agents without modifying existing code
- Each strategy is self-contained

### 2. **Single Responsibility**
- Each strategy handles only its agent logic
- Factory handles instantiation
- Router handles selection
- Executor handles coordination

### 3. **Testability**
- Easy to mock strategies for testing
- Each component can be tested in isolation

### 4. **Extensibility**
- Register new agents at runtime
- Plugin architecture for custom agents

### 5. **Type Safety**
- Shared interface ensures consistent behavior
- TypeScript catches integration errors

## Risks and Mitigations

### Risk 1: Over-Engineering
- **Risk**: Strategy pattern adds complexity
- **Mitigation**: Start with 2 strategies; pattern pays off with 3+

### Risk 2: SDK Stability
- **Risk**: OpenCode SDK is newer than CLI
- **Mitigation**: Keep CLI fallback; test thoroughly

### Risk 3: Server Lifecycle
- **Risk**: Auto-spawned server may not cleanup properly
- **Mitigation**: AbortController pattern; cleanup in finally block

### Risk 4: API Key Management
- **Risk**: Multiple API keys increase security surface
- **Mitigation**: Use Cloudflare secrets; only enable needed providers

## Success Metrics

1. **Code Quality**: Reduced cyclomatic complexity in consumer.ts
2. **Extensibility**: Time to add new agent < 2 hours
3. **Provider Usage**: Track which providers are used
4. **Success Rate**: PR creation rate by agent
5. **Performance**: Completion time by agent/provider

## Decision

**Approved** - Add OpenCode via TypeScript SDK with Strategy Pattern architecture, enabling clean code and easy extensibility for future agents.

## References

- [OpenCode GitHub](https://github.com/anomalyco/opencode)
- [OpenCode SDK Package](https://www.npmjs.com/package/@opencode-ai/sdk)
- [OpenCode Architecture](../opencode-architecture.md)
- [Claude Code Documentation](https://docs.anthropic.com/claude-code)
- [Strategy Pattern (Refactoring Guru)](https://refactoring.guru/design-patterns/strategy)
