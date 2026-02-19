/**
 * LLM configuration utilities
 * Consolidates provider detection and key decryption logic
 */

import type { LLMConfig } from "../db/schema";
import { logWithContext } from "../core/log";
import { decrypt } from "../core/crypto";

/**
 * Provider key mapping for OpenCode (non-Anthropic providers)
 */
const OPENCODE_PROVIDER_KEYS: Array<{
  key: keyof LLMConfig;
  provider: string;
}> = [
  { key: "openaiApiKeyEncrypted", provider: "openai" },
  { key: "googleApiKeyEncrypted", provider: "google" },
  { key: "groqApiKeyEncrypted", provider: "groq" },
  { key: "deepseekApiKeyEncrypted", provider: "deepseek" },
  { key: "mistralApiKeyEncrypted", provider: "mistral" },
  { key: "togetherApiKeyEncrypted", provider: "together" },
  { key: "fireworksApiKeyEncrypted", provider: "fireworks" },
];

export interface LLMProviderInfo {
  hasAnthropicKey: boolean;
  configuredOpenCodeProvider: string | undefined;
  hasAnyProvider: boolean;
}

/**
 * Check if any LLM provider key is configured
 * Useful for quick status checks
 */
export function hasAnyLLMKey(llmConfig: LLMConfig | null): boolean {
  if (!llmConfig) return false;

  return !!(
    llmConfig.anthropicApiKeyEncrypted ||
    llmConfig.openaiApiKeyEncrypted ||
    llmConfig.googleApiKeyEncrypted ||
    llmConfig.groqApiKeyEncrypted ||
    llmConfig.deepseekApiKeyEncrypted ||
    llmConfig.mistralApiKeyEncrypted ||
    llmConfig.togetherApiKeyEncrypted ||
    llmConfig.fireworksApiKeyEncrypted
  );
}

/**
 * Detect configured LLM providers from config
 * @param llmConfig - LLM configuration from database
 * @returns Provider availability info
 */
export function detectLLMProviders(llmConfig: LLMConfig | null): LLMProviderInfo {
  if (!llmConfig) {
    return {
      hasAnthropicKey: false,
      configuredOpenCodeProvider: undefined,
      hasAnyProvider: false,
    };
  }

  const hasAnthropicKey = !!llmConfig.anthropicApiKeyEncrypted;

  let configuredOpenCodeProvider: string | undefined;
  for (const { key, provider } of OPENCODE_PROVIDER_KEYS) {
    if (llmConfig[key]) {
      configuredOpenCodeProvider = provider;
      break;
    }
  }

  return {
    hasAnthropicKey,
    configuredOpenCodeProvider,
    hasAnyProvider: hasAnthropicKey || !!configuredOpenCodeProvider,
  };
}

/**
 * Determine default agent configuration based on available providers
 */
export function getDefaultAgentConfig(
  llmProviders: LLMProviderInfo,
  systemDefaults?: { defaultAgentType?: string; defaultAgentProvider?: string } | null
): { agentType: string; agentProvider: string | undefined } {
  const agentType =
    systemDefaults?.defaultAgentType ||
    (llmProviders.hasAnthropicKey ? "claude-code" : "opencode");

  const agentProvider =
    systemDefaults?.defaultAgentProvider ||
    (llmProviders.hasAnthropicKey ? "anthropic" : llmProviders.configuredOpenCodeProvider);

  return { agentType, agentProvider };
}

/**
 * Decrypted LLM API keys for multi-provider support
 */
export interface LLMApiKeys {
  anthropicApiKey: string;
  openaiApiKey: string | null;
  googleApiKey: string | null;
  groqApiKey: string | null;
  deepseekApiKey: string | null;
  mistralApiKey: string | null;
}

/**
 * Decrypt all configured LLM API keys
 * @throws Error if Anthropic key is not configured (required)
 */
export async function decryptLLMKeys(
  llmConfig: LLMConfig | null,
  encryptionKey: string
): Promise<LLMApiKeys> {
  if (!llmConfig?.anthropicApiKeyEncrypted) {
    throw new Error("Anthropic API key not configured");
  }

  const anthropicApiKey = await decrypt(llmConfig.anthropicApiKeyEncrypted, encryptionKey);

  // Decrypt optional provider keys in parallel
  const [openaiApiKey, googleApiKey, groqApiKey, deepseekApiKey, mistralApiKey] = await Promise.all([
    llmConfig.openaiApiKeyEncrypted
      ? decrypt(llmConfig.openaiApiKeyEncrypted, encryptionKey)
      : Promise.resolve(null),
    llmConfig.googleApiKeyEncrypted
      ? decrypt(llmConfig.googleApiKeyEncrypted, encryptionKey)
      : Promise.resolve(null),
    llmConfig.groqApiKeyEncrypted
      ? decrypt(llmConfig.groqApiKeyEncrypted, encryptionKey)
      : Promise.resolve(null),
    llmConfig.deepseekApiKeyEncrypted
      ? decrypt(llmConfig.deepseekApiKeyEncrypted, encryptionKey)
      : Promise.resolve(null),
    llmConfig.mistralApiKeyEncrypted
      ? decrypt(llmConfig.mistralApiKeyEncrypted, encryptionKey)
      : Promise.resolve(null),
  ]);

  logWithContext("LLM_CONFIG", "Decrypted API keys", {
    hasAnthropic: !!anthropicApiKey,
    hasOpenai: !!openaiApiKey,
    hasGoogle: !!googleApiKey,
    hasGroq: !!groqApiKey,
    hasDeepseek: !!deepseekApiKey,
    hasMistral: !!mistralApiKey,
  });

  return {
    anthropicApiKey,
    openaiApiKey,
    googleApiKey,
    groqApiKey,
    deepseekApiKey,
    mistralApiKey,
  };
}

/**
 * Build environment variables object for container with LLM keys
 */
export function buildLLMEnvVars(keys: LLMApiKeys): Record<string, string> {
  const envVars: Record<string, string> = {
    ANTHROPIC_API_KEY: keys.anthropicApiKey,
  };

  if (keys.openaiApiKey) envVars.OPENAI_API_KEY = keys.openaiApiKey;
  if (keys.googleApiKey) envVars.GOOGLE_API_KEY = keys.googleApiKey;
  if (keys.groqApiKey) envVars.GROQ_API_KEY = keys.groqApiKey;
  if (keys.deepseekApiKey) envVars.DEEPSEEK_API_KEY = keys.deepseekApiKey;
  if (keys.mistralApiKey) envVars.MISTRAL_API_KEY = keys.mistralApiKey;

  return envVars;
}
