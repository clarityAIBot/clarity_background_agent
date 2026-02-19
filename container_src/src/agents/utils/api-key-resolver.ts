/**
 * API Key Resolver - Resolves API keys for different LLM providers.
 *
 * This utility maps provider names to their corresponding environment variables.
 */

import type { AgentProvider } from '../types.js';

/**
 * Environment variables for each provider's API key.
 */
const PROVIDER_ENV_KEYS: Record<AgentProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  groq: 'GROQ_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  together: 'TOGETHER_API_KEY',
  fireworks: 'FIREWORKS_API_KEY'
};

/**
 * Get the API key for a specific provider from environment.
 *
 * @param provider - The LLM provider name
 * @returns The API key or undefined if not found
 */
export function getApiKeyForProvider(provider: AgentProvider): string | undefined {
  const envKey = PROVIDER_ENV_KEYS[provider];
  if (!envKey) {
    return undefined;
  }
  return process.env[envKey];
}

/**
 * Check if an API key is available for a provider.
 *
 * @param provider - The LLM provider name
 * @returns True if the API key exists and is non-empty
 */
export function hasApiKeyForProvider(provider: AgentProvider): boolean {
  const key = getApiKeyForProvider(provider);
  return !!key && key.trim().length > 0;
}

/**
 * Get the environment variable name for a provider.
 *
 * @param provider - The LLM provider name
 * @returns The environment variable name
 */
export function getEnvKeyForProvider(provider: AgentProvider): string {
  return PROVIDER_ENV_KEYS[provider];
}

/**
 * Get all available providers (those with API keys configured).
 *
 * @returns Array of available provider names
 */
export function getAvailableProviders(): AgentProvider[] {
  return (Object.keys(PROVIDER_ENV_KEYS) as AgentProvider[])
    .filter(provider => hasApiKeyForProvider(provider));
}

/**
 * Validate that required API keys are present for a provider.
 *
 * @param provider - The LLM provider name
 * @returns Validation result with error message if missing
 */
export function validateProviderApiKey(provider: AgentProvider): { valid: boolean; error?: string } {
  if (!hasApiKeyForProvider(provider)) {
    const envKey = getEnvKeyForProvider(provider);
    return {
      valid: false,
      error: `API key not found for provider: ${provider}. Set ${envKey} environment variable.`
    };
  }
  return { valid: true };
}
