/**
 * OpenCodeStrategy - Strategy for executing tasks using OpenCode SDK.
 *
 * This strategy ONLY handles the AI execution part.
 * Common operations (workspace setup, git, PR creation) are handled by AgentExecutor.
 *
 * OpenCode supports multiple LLM providers and real-time streaming.
 */

import type { IAgentStrategy } from '../strategy.interface.js';
import type {
  AgentContext,
  AgentResult,
  AgentCapabilities,
  ValidationResult,
  AgentProgressEvent,
  AgentProvider
} from '../types.js';
import { getApiKeyForProvider, hasApiKeyForProvider } from '../utils/api-key-resolver.js';
import { createLogger } from '../../logger.js';

// Create logger for this module
const logger = createLogger('OpenCodeStrategy');

// OpenCode SDK types (will be properly typed when package is installed)
interface OpenCodeClient {
  session: {
    create(options: { body: { title: string } }): Promise<{ data?: { id: string } }>;
    prompt(options: { path: { id: string }; body: { content: string } }): Promise<void>;
    messages(options: { path: { id: string } }): Promise<{ data?: unknown[] }>;
    diff(options: { path: { id: string } }): Promise<{ data?: string }>;
    get(options: { path: { id: string } }): Promise<{ data?: unknown }>;
    abort(options: { path: { id: string } }): Promise<void>;
  };
  event: {
    subscribe(): AsyncIterable<unknown>;
  };
}

interface OpenCodeServer {
  url: string;
  close: () => void;
}

export class OpenCodeStrategy implements IAgentStrategy {
  readonly name = 'opencode';
  readonly displayName = 'OpenCode';

  private abortController: AbortController | null = null;
  private server: OpenCodeServer | null = null;
  private sessionId: string | null = null;
  private isRunning = false;

  /**
   * Execute OpenCode with the given prompt.
   *
   * IMPORTANT: This method expects to be called from within the workspace directory.
   * The caller (AgentExecutor) is responsible for:
   * - Setting up the workspace
   * - Changing to the workspace directory
   * - Handling git operations after execution
   * - Creating PRs
   */
  async execute(context: AgentContext): Promise<AgentResult> {
    const { prompt, config, onProgress, requestId } = context;
    const provider = (config.provider || 'anthropic') as AgentProvider;

    this.abortController = new AbortController();
    this.isRunning = true;

    const startTime = Date.now();
    const workingDir = process.cwd();

    onProgress?.({
      type: 'started',
      message: `Starting OpenCode with ${provider} provider...`,
      timestamp: new Date()
    });

    try {
      // Dynamic import of OpenCode SDK
      let createOpencode: any;
      let createOpencodeClient: any;

      try {
        const sdk = await import('@opencode-ai/sdk');
        createOpencode = sdk.createOpencode;
        createOpencodeClient = sdk.createOpencodeClient;
      } catch (importError) {
        throw new Error(
          'OpenCode SDK (@opencode-ai/sdk) is not installed. ' +
          'Run: npm install @opencode-ai/sdk'
        );
      }

      // Get API key for the selected provider
      const apiKey = getApiKeyForProvider(provider);
      if (!apiKey) {
        throw new Error(`API key not found for provider: ${provider}`);
      }

      logger.log('EXECUTE', 'Creating OpenCode instance', {
        provider,
        model: config.model,
        workingDir
      });

      // Create OpenCode instance with auto-spawned server
      const { client, server } = await createOpencode({
        port: 0, // Auto-assign port
        signal: this.abortController.signal,
        timeout: 10000,
        config: {
          provider: { name: provider },
          model: config.model ? { id: config.model } : undefined
        }
      });

      this.server = server as OpenCodeServer;

      // Create client with working directory
      const opencodeClient: OpenCodeClient = createOpencodeClient({
        baseUrl: server.url,
        directory: workingDir
      });

      // Create a new session
      const sessionResponse = await opencodeClient.session.create({
        body: {
          title: `Clarity AI Task - ${requestId || 'unknown'}`
        }
      });

      if (!sessionResponse.data) {
        throw new Error('Failed to create OpenCode session');
      }

      this.sessionId = sessionResponse.data.id;
      logger.log('EXECUTE', 'Session created', { sessionId: this.sessionId });

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

      const durationMs = Date.now() - startTime;

      // Extract solution from messages
      const messages = messagesResponse.data || [];
      const solution = this.extractSolutionFromMessages(messages);

      logger.log('EXECUTE', 'Execution completed', {
        sessionId: this.sessionId,
        durationMs,
        messagesCount: messages.length,
        hasDiff: !!diffResponse.data
      });

      onProgress?.({
        type: 'completed',
        message: 'OpenCode execution completed',
        timestamp: new Date()
      });

      return {
        success: true,
        message: solution,
        sessionId: this.sessionId,
        durationMs,
        metadata: {
          agent: 'opencode',
          provider,
          model: config.model,
          sessionState: sessionState.data,
          diff: diffResponse.data,
          solution
        }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const durationMs = Date.now() - startTime;

      logger.log('EXECUTE', 'Error during execution', { error: errorMessage });

      onProgress?.({
        type: 'error',
        message: errorMessage,
        timestamp: new Date()
      });

      return {
        success: false,
        message: 'OpenCode execution failed',
        error: errorMessage,
        durationMs,
        metadata: {
          agent: 'opencode',
          provider
        }
      };
    } finally {
      this.isRunning = false;
    }
  }

  async abort(): Promise<void> {
    // Abort the session if running
    if (this.sessionId && this.server) {
      try {
        const { createOpencodeClient } = await import('@opencode-ai/sdk');
        const client = createOpencodeClient({ baseUrl: this.server.url });
        await client.session.abort({ path: { id: this.sessionId } });
        logger.log('ABORT', 'Session aborted', { sessionId: this.sessionId });
      } catch {
        // Ignore abort errors
      }
    }

    this.abortController?.abort();
    this.isRunning = false;
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

  async validate(context: AgentContext): Promise<ValidationResult> {
    const errors: string[] = [];
    const provider = (context.config.provider || 'anthropic') as AgentProvider;

    // Check for API key
    if (!hasApiKeyForProvider(provider)) {
      errors.push(`API key not found for provider: ${provider}`);
    }

    // Check for prompt
    if (!context.prompt || context.prompt.trim() === '') {
      errors.push('Prompt is required');
    }

    // Check if provider is supported
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
    if (this.server) {
      this.server.close();
      logger.log('CLEANUP', 'Server closed');
    }
    this.server = null;
    this.sessionId = null;
    this.abortController = null;
    this.isRunning = false;
  }

  // ============= Private Helper Methods =============

  /**
   * Subscribe to OpenCode events for real-time progress updates.
   */
  private subscribeToEvents(
    client: OpenCodeClient,
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

  /**
   * Transform OpenCode event to AgentProgressEvent.
   */
  private transformEvent(event: unknown): AgentProgressEvent | null {
    const e = event as { type?: string; data?: unknown };

    switch (e.type) {
      case 'message.start':
        return {
          type: 'thinking',
          message: 'Agent is thinking...',
          timestamp: new Date()
        };

      case 'tool.start':
        return {
          type: 'tool_use',
          message: 'Using tool...',
          data: e.data,
          timestamp: new Date()
        };

      case 'file.change':
        return {
          type: 'file_change',
          message: 'File modified',
          data: e.data,
          timestamp: new Date()
        };

      case 'message.complete':
        return {
          type: 'completed',
          message: 'Message complete',
          timestamp: new Date()
        };

      default:
        return null;
    }
  }

  /**
   * Extract solution from OpenCode messages.
   */
  private extractSolutionFromMessages(messages: unknown[]): string {
    // Look through messages in reverse to find the last assistant response
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as any;

      if (msg.role === 'assistant' && msg.content) {
        const content = typeof msg.content === 'string'
          ? msg.content
          : msg.content.map((c: any) => c.text || '').join('\n\n');

        if (content.trim()) {
          return content;
        }
      }
    }

    return 'I analyzed the issue and made changes to the codebase. Please review the pull request for details.';
  }
}
