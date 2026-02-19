/**
 * IAgentStrategy - Strategy interface for AI coding agents.
 *
 * Implement this interface to add new agent types to Clarity AI.
 * Each strategy encapsulates the logic for a specific agent (Claude Code, OpenCode, etc.)
 */

import type {
  AgentContext,
  AgentResult,
  AgentCapabilities,
  ValidationResult
} from './types.js';

export interface IAgentStrategy {
  /**
   * Unique identifier for this agent strategy.
   * Must match the AgentType enum value.
   */
  readonly name: string;

  /**
   * Human-readable display name for UI.
   */
  readonly displayName: string;

  /**
   * Execute the agent with the given context.
   * This is the main entry point for running the agent.
   *
   * @param context - Execution context including prompt, config, and callbacks
   * @returns Promise resolving to the execution result
   */
  execute(context: AgentContext): Promise<AgentResult>;

  /**
   * Abort any running execution.
   * Should gracefully stop the agent and clean up resources.
   */
  abort(): Promise<void>;

  /**
   * Check if the agent supports real-time streaming.
   * Used to determine if progress events should be expected.
   */
  supportsStreaming(): boolean;

  /**
   * Get the capabilities of this agent.
   * Used for feature detection and UI display.
   */
  getCapabilities(): AgentCapabilities;

  /**
   * Validate that the agent can run with the given config.
   * Called before execute() to ensure prerequisites are met.
   *
   * @param context - The context to validate
   * @returns Validation result with any errors
   */
  validate(context: AgentContext): Promise<ValidationResult>;

  /**
   * Clean up any resources after execution.
   * Called in finally block after execute() completes.
   */
  cleanup(): Promise<void>;
}
