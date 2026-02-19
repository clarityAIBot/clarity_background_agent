/**
 * Agent types for worker-side routing.
 * These types are used to determine which agent to invoke and pass config to container.
 * Actual execution types are in container_src/src/agents/types.ts
 */

// Agent type enum - matches database enum
export type AgentType = 'claude-code' | 'opencode';

// Provider enum - matches database enum for OpenCode
export type AgentProvider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'groq'
  | 'deepseek'
  | 'mistral'
  | 'together'
  | 'fireworks';

/**
 * Configuration for agent routing and container invocation.
 * This is passed to the container for execution.
 */
export interface AgentConfig {
  type: AgentType;
  provider?: AgentProvider;   // For OpenCode: which LLM provider to use
  model?: string;             // Specific model override
}

/**
 * Default agent configuration
 */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  type: 'claude-code'
};
