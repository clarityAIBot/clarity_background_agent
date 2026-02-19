import { encrypt } from "../../core/crypto";
import { logWithContext } from "../../core/log";
import { getDb } from "../../db/client";
import { AppConfigRepository } from "../../db/repositories";
import type { Env } from "../../core/types";

export async function handleClaudeSetup(request: Request, _origin: string, env: Env): Promise<Response> {
  logWithContext('CLAUDE_SETUP', 'Handling Claude setup request', {
    method: request.method
  });

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json() as { anthropic_api_key: string };
    const apiKey = body.anthropic_api_key;

    logWithContext('CLAUDE_SETUP', 'API key received', {
      hasApiKey: !!apiKey,
      keyPrefix: apiKey ? apiKey.substring(0, 7) + '...' : 'none'
    });

    if (!apiKey || !apiKey.startsWith('sk-ant-')) {
      return new Response(JSON.stringify({ error: 'Invalid Anthropic API key format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Encrypt the API key
    const encryptedApiKey = await encrypt(apiKey, env.ENCRYPTION_KEY);
    logWithContext('CLAUDE_SETUP', 'API key encrypted successfully');

    // Store in PostgreSQL
    logWithContext('CLAUDE_SETUP', 'Storing API key in PostgreSQL');

    const db = getDb(env);
    const repo = new AppConfigRepository(db);
    // Use updateLLMConfig to merge with existing config (for multi-provider support)
    await repo.updateLLMConfig({
      anthropicApiKeyEncrypted: encryptedApiKey,
      setupAt: new Date().toISOString(),
    });

    logWithContext('CLAUDE_SETUP', 'API key stored in PostgreSQL');

    return new Response(JSON.stringify({
      success: true,
      message: 'Claude API key configured successfully'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    logWithContext('CLAUDE_SETUP', 'Error during Claude setup', {
      error: error instanceof Error ? error.message : String(error)
    });

    return new Response(JSON.stringify({
      error: 'Failed to save API key',
      message: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
