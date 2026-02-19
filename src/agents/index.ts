/**
 * Worker-side agent module exports.
 *
 * This module provides routing logic to determine which agent to use.
 * Actual agent execution happens in the container (container_src/src/agents/).
 */

export type { AgentType, AgentProvider, AgentConfig } from './types';
export { DEFAULT_AGENT_CONFIG } from './types';
export { AgentRouter, type IssueData } from './router';
