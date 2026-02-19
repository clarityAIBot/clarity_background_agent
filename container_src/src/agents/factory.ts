/**
 * AgentStrategyFactory - Factory for creating agent strategy instances.
 */

import type { IAgentStrategy } from './strategy.interface.js';
import type { AgentConfig, AgentType, AgentCapabilities } from './types.js';
import { ClaudeCodeStrategy } from './strategies/claude-code.strategy.js';
import { OpenCodeStrategy } from './strategies/opencode.strategy.js';

type StrategyConstructor = new () => IAgentStrategy;

export class AgentStrategyFactory {
  private static strategies: Map<AgentType, StrategyConstructor> = new Map();
  private static instances: Map<AgentType, IAgentStrategy> = new Map();
  private static initialized = false;

  /**
   * Initialize the factory with default strategies.
   */
  private static initialize(): void {
    if (this.initialized) return;
    this.strategies.set('claude-code', ClaudeCodeStrategy);
    this.strategies.set('opencode', OpenCodeStrategy);
    this.initialized = true;
  }

  /**
   * Register a new strategy type.
   */
  static register(type: AgentType, strategyClass: StrategyConstructor): void {
    this.strategies.set(type, strategyClass);
    this.instances.delete(type);
  }

  /**
   * Create or get a cached strategy instance.
   */
  static create(config: AgentConfig): IAgentStrategy {
    this.initialize();
    const { type } = config;

    // Return cached instance if available
    const cached = this.instances.get(type);
    if (cached) {
      return cached;
    }

    const StrategyClass = this.strategies.get(type);
    if (!StrategyClass) {
      const available = this.getAvailableAgents().join(', ');
      throw new Error(`Unknown agent type: ${type}. Available: ${available}`);
    }

    const instance = new StrategyClass();
    this.instances.set(type, instance);

    return instance;
  }

  /**
   * Get list of available agent types.
   */
  static getAvailableAgents(): AgentType[] {
    this.initialize();
    return Array.from(this.strategies.keys());
  }

  /**
   * Get capabilities for all registered agents.
   */
  static getAllCapabilities(): Record<AgentType, AgentCapabilities> {
    this.initialize();
    const result: Record<string, AgentCapabilities> = {};

    for (const [type, StrategyClass] of this.strategies) {
      const instance = new StrategyClass();
      result[type] = instance.getCapabilities();
    }

    return result as Record<AgentType, AgentCapabilities>;
  }

  /**
   * Clear all cached instances.
   */
  static clearCache(): void {
    this.instances.clear();
  }
}
