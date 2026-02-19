import { encrypt } from "../../core/crypto";
import { logWithContext } from "../../core/log";
import { getDb } from "../../db/client";
import { AppConfigRepository } from "../../db/repositories";
import type { Env } from "../../core/types";
import type { LLMConfig } from "../../db/schema";

// Provider configurations with validation
const PROVIDER_CONFIG = {
  anthropic: {
    field: 'anthropicApiKeyEncrypted',
    inputField: 'anthropic_api_key',
    prefix: 'sk-ant-',
    name: 'Anthropic',
  },
  openai: {
    field: 'openaiApiKeyEncrypted',
    inputField: 'openai_api_key',
    prefix: 'sk-',
    name: 'OpenAI',
  },
  google: {
    field: 'googleApiKeyEncrypted',
    inputField: 'google_api_key',
    prefix: null, // No specific prefix validation
    name: 'Google',
  },
  groq: {
    field: 'groqApiKeyEncrypted',
    inputField: 'groq_api_key',
    prefix: 'gsk_',
    name: 'Groq',
  },
  deepseek: {
    field: 'deepseekApiKeyEncrypted',
    inputField: 'deepseek_api_key',
    prefix: 'sk-',
    name: 'DeepSeek',
  },
  mistral: {
    field: 'mistralApiKeyEncrypted',
    inputField: 'mistral_api_key',
    prefix: null, // No specific prefix validation
    name: 'Mistral',
  },
  together: {
    field: 'togetherApiKeyEncrypted',
    inputField: 'together_api_key',
    prefix: null, // No specific prefix validation
    name: 'Together AI',
  },
  fireworks: {
    field: 'fireworksApiKeyEncrypted',
    inputField: 'fireworks_api_key',
    prefix: 'fw_',
    name: 'Fireworks AI',
  },
} as const;

type ProviderKey = keyof typeof PROVIDER_CONFIG;

interface LLMSetupRequest {
  anthropic_api_key?: string;
  openai_api_key?: string;
  google_api_key?: string;
  groq_api_key?: string;
  deepseek_api_key?: string;
  mistral_api_key?: string;
  together_api_key?: string;
  fireworks_api_key?: string;
}

export async function handleLLMSetup(request: Request, _origin: string, env: Env): Promise<Response> {
  logWithContext('LLM_SETUP', 'Handling LLM setup request', {
    method: request.method
  });

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json() as LLMSetupRequest;

    // Track which providers were configured
    const configuredProviders: string[] = [];
    const errors: string[] = [];
    const updates: Partial<LLMConfig> = {};

    // Process each provider
    for (const [provider, config] of Object.entries(PROVIDER_CONFIG)) {
      const apiKey = body[config.inputField as keyof LLMSetupRequest];

      if (apiKey && apiKey.trim()) {
        // Validate prefix if required
        if (config.prefix && !apiKey.startsWith(config.prefix)) {
          errors.push(`${config.name} API key must start with "${config.prefix}"`);
          continue;
        }

        // Encrypt the API key
        const encryptedKey = await encrypt(apiKey, env.ENCRYPTION_KEY);
        (updates as any)[config.field] = encryptedKey;
        configuredProviders.push(config.name);

        logWithContext('LLM_SETUP', `${config.name} API key encrypted`, {
          provider,
          keyPrefix: apiKey.substring(0, Math.min(7, apiKey.length)) + '...'
        });
      }
    }

    // If there are validation errors, return them
    if (errors.length > 0) {
      return new Response(JSON.stringify({
        error: 'Validation failed',
        details: errors
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // If no providers were configured
    if (configuredProviders.length === 0) {
      return new Response(JSON.stringify({
        error: 'No API keys provided. Please provide at least one API key.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Store in PostgreSQL
    logWithContext('LLM_SETUP', 'Storing LLM config in PostgreSQL', {
      providers: configuredProviders
    });

    const db = getDb(env);
    const repo = new AppConfigRepository(db);

    // Update the config (merges with existing)
    await repo.updateLLMConfig(updates);

    logWithContext('LLM_SETUP', 'LLM config stored successfully', {
      configuredProviders
    });

    return new Response(JSON.stringify({
      success: true,
      message: 'LLM configuration saved successfully',
      configuredProviders
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    logWithContext('LLM_SETUP', 'Error during LLM setup', {
      error: error instanceof Error ? error.message : String(error)
    });

    return new Response(JSON.stringify({
      error: 'Failed to save LLM configuration',
      message: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Get LLM status (which providers are configured)
export async function handleLLMStatus(request: Request, _origin: string, env: Env): Promise<Response> {
  logWithContext('LLM_STATUS', 'Handling LLM status request');

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDb(env);
    const repo = new AppConfigRepository(db);
    const config = await repo.getLLMConfig();

    const providers: Record<string, boolean> = {};

    for (const [provider, providerConfig] of Object.entries(PROVIDER_CONFIG)) {
      providers[provider] = !!(config && (config as any)[providerConfig.field]);
    }

    return new Response(JSON.stringify({
      configured: Object.values(providers).some(v => v),
      providers,
      updatedAt: config?.updatedAt || null
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    logWithContext('LLM_STATUS', 'Error getting LLM status', {
      error: error instanceof Error ? error.message : String(error)
    });

    return new Response(JSON.stringify({
      error: 'Failed to get LLM status',
      message: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Delete specific provider config
export async function handleLLMDelete(request: Request, _origin: string, env: Env): Promise<Response> {
  logWithContext('LLM_DELETE', 'Handling LLM delete request');

  if (request.method !== 'DELETE') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const url = new URL(request.url);
    const provider = url.searchParams.get('provider') as ProviderKey | null;

    const db = getDb(env);
    const repo = new AppConfigRepository(db);

    if (provider && PROVIDER_CONFIG[provider]) {
      // Delete specific provider
      const config = await repo.getLLMConfig();
      if (config) {
        const updates: Partial<LLMConfig> = {};
        (updates as any)[PROVIDER_CONFIG[provider].field] = null;
        await repo.updateLLMConfig(updates);
      }

      logWithContext('LLM_DELETE', 'Provider config deleted', { provider });

      return new Response(JSON.stringify({
        success: true,
        message: `${PROVIDER_CONFIG[provider].name} configuration deleted`
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      // Delete all LLM config
      await repo.deleteLLMConfig();

      logWithContext('LLM_DELETE', 'All LLM config deleted');

      return new Response(JSON.stringify({
        success: true,
        message: 'All LLM configuration deleted'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

  } catch (error) {
    logWithContext('LLM_DELETE', 'Error deleting LLM config', {
      error: error instanceof Error ? error.message : String(error)
    });

    return new Response(JSON.stringify({
      error: 'Failed to delete LLM configuration',
      message: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
