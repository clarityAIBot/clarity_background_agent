import { encrypt } from "../../core/crypto";
import { logWithContext } from "../../core/log";
import { getDb } from "../../db/client";
import { AppConfigRepository } from "../../db/repositories";
import type { Env } from "../../core/types";

export async function handleSlackOAuthCallback(request: Request, env: Env): Promise<Response> {
  logWithContext('SLACK_OAUTH', 'Handling Slack OAuth callback', {
    method: request.method
  });

  // Handle POST request with credentials from the form
  if (request.method === 'POST') {
    try {
      const body = await request.json() as { signing_secret: string; bot_token: string };

      if (!body.signing_secret || !body.bot_token) {
        logWithContext('SLACK_OAUTH', 'Missing credentials in request');
        return new Response(JSON.stringify({ error: 'Missing signing_secret or bot_token' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Validate bot token format
      if (!body.bot_token.startsWith('xoxb-')) {
        logWithContext('SLACK_OAUTH', 'Invalid bot token format');
        return new Response(JSON.stringify({ error: 'Bot token should start with xoxb-' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      logWithContext('SLACK_OAUTH', 'Encrypting Slack credentials');

      // Encrypt sensitive credentials
      const encryptedSigningSecret = await encrypt(body.signing_secret, env.ENCRYPTION_KEY);
      const encryptedBotToken = await encrypt(body.bot_token, env.ENCRYPTION_KEY);

      logWithContext('SLACK_OAUTH', 'Credentials encrypted, storing in PostgreSQL');

      // Store in PostgreSQL
      const db = getDb(env);
      const repo = new AppConfigRepository(db);
      await repo.setSlackConfig({
        signingSecretEncrypted: encryptedSigningSecret,
        botTokenEncrypted: encryptedBotToken,
        setupAt: new Date().toISOString(),
      });

      logWithContext('SLACK_OAUTH', 'Slack credentials stored successfully');

      return new Response(JSON.stringify({
        success: true,
        message: 'Slack credentials saved successfully'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      logWithContext('SLACK_OAUTH', 'Error processing Slack credentials', {
        error: error instanceof Error ? error.message : String(error)
      });

      return new Response(JSON.stringify({
        error: 'Failed to process credentials',
        message: error instanceof Error ? error.message : String(error)
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  // If it's not a POST, return method not allowed
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' }
  });
}
