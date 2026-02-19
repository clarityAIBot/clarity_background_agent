/**
 * Agent module exports
 */

// Types
export type {
  AgentType,
  AgentProvider,
  AgentConfig,
  AgentContext,
  AgentResult,
  AgentMessage,
  AgentProgressEvent,
  AgentCapabilities,
  ValidationResult,
  IssueContext,
  ToolCall
} from './types.js';

// Interface
export type { IAgentStrategy } from './strategy.interface.js';

// Core classes
export { AgentExecutor } from './executor.js';
export { AgentStrategyFactory } from './factory.js';

// Strategies
export { ClaudeCodeStrategy } from './strategies/claude-code.strategy.js';
export { OpenCodeStrategy } from './strategies/opencode.strategy.js';

// Utilities
export {
  getApiKeyForProvider,
  hasApiKeyForProvider,
  getEnvKeyForProvider,
  getAvailableProviders,
  validateProviderApiKey
} from './utils/api-key-resolver.js';
