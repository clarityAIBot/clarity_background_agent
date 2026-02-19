/**
 * AgentRouter - Determines which agent to use based on issue data.
 *
 * Routes requests to the appropriate agent based on:
 * 1. GitHub issue labels (highest priority)
 * 2. Explicit agent type from queue message
 * 3. Default configuration
 */

import type { AgentConfig, AgentType, AgentProvider } from './types';
import { DEFAULT_AGENT_CONFIG } from './types';

/**
 * Issue data used for routing decisions
 */
export interface IssueData {
  labels?: string[];
  agentType?: AgentType;
  agentProvider?: AgentProvider;
  agentModel?: string;
}

/**
 * Label to agent config mapping
 */
interface LabelMapping {
  type: AgentType;
  provider?: AgentProvider;
}

export class AgentRouter {
  /**
   * Label mappings for agent selection.
   * Labels are checked in order of specificity.
   */
  private static readonly LABEL_MAPPINGS: Record<string, LabelMapping> = {
    // OpenCode with specific providers
    'clarity-ai-opencode': { type: 'opencode', provider: 'anthropic' },
    'clarity-ai-opencode-anthropic': { type: 'opencode', provider: 'anthropic' },
    'clarity-ai-opencode-openai': { type: 'opencode', provider: 'openai' },
    'clarity-ai-opencode-google': { type: 'opencode', provider: 'google' },
    'clarity-ai-opencode-groq': { type: 'opencode', provider: 'groq' },
    'clarity-ai-opencode-deepseek': { type: 'opencode', provider: 'deepseek' },
    'clarity-ai-opencode-mistral': { type: 'opencode', provider: 'mistral' },

    // Claude Code (explicit)
    'clarity-ai-claude': { type: 'claude-code' },

    // Default label (Claude Code)
    'clarity-ai': { type: 'claude-code' }
  };

  /**
   * Default configuration when no label/explicit config matches.
   */
  private static readonly DEFAULT_CONFIG: AgentConfig = DEFAULT_AGENT_CONFIG;

  /**
   * Determine which agent config to use based on issue data.
   *
   * Priority:
   * 1. GitHub issue labels (most specific first)
   * 2. Explicit agent type from queue message
   * 3. Default (claude-code)
   *
   * @param issueData - Data from the issue/request
   * @returns Agent configuration
   */
  static route(issueData: IssueData): AgentConfig {
    // 1. Check issue labels (highest priority)
    const labels = issueData.labels || [];

    // Sort labels by specificity (longer = more specific)
    const sortedLabels = [...labels].sort((a, b) => b.length - a.length);

    for (const label of sortedLabels) {
      const mapping = this.LABEL_MAPPINGS[label];
      if (mapping) {
        const config: AgentConfig = {
          type: mapping.type,
          provider: mapping.provider
        };

        // Allow provider/model override from issue data
        if (issueData.agentProvider) {
          config.provider = issueData.agentProvider;
        }
        if (issueData.agentModel) {
          config.model = issueData.agentModel;
        }

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
    return { ...this.DEFAULT_CONFIG };
  }

  /**
   * Register a custom label mapping.
   *
   * @param label - GitHub label name
   * @param config - Agent configuration for this label
   */
  static registerLabelMapping(label: string, config: LabelMapping): void {
    this.LABEL_MAPPINGS[label] = config;
  }

  /**
   * Get all registered label mappings.
   */
  static getLabelMappings(): Record<string, LabelMapping> {
    return { ...this.LABEL_MAPPINGS };
  }

  /**
   * Check if a label is recognized.
   */
  static isRecognizedLabel(label: string): boolean {
    return label in this.LABEL_MAPPINGS;
  }

  /**
   * Get the clarity label from issue labels.
   * Returns the first matching clarity-ai label found.
   */
  static getClarityLabel(labels: string[]): string | null {
    return labels.find(label => label.startsWith('clarity-ai')) ?? null;
  }
}
