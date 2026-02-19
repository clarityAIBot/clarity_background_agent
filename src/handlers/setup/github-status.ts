import { getDb } from "../../db/client";
import { AppConfigRepository } from "../../db/repositories";
import { hasAnyLLMKey } from "../../utils/llm-config";
import type { Env } from "../../core/types";

export async function handleGitHubStatus(_request: Request, env: Env): Promise<Response> {
  try {
    const db = getDb(env);
    const repo = new AppConfigRepository(db);

    // Get all configs from PostgreSQL
    const configs = await repo.getAllConfigs();

    const statusResponse: {
      installation: Record<string, unknown> | null;
      claude: { configured: boolean };
      slack: { configured: boolean };
    } = {
      installation: null,
      claude: {
        configured: hasAnyLLMKey(configs.llm)
      },
      slack: {
        configured: !!(configs.slack?.signingSecretEncrypted && configs.slack?.botTokenEncrypted)
      }
    };

    if (configs.github) {
      statusResponse.installation = {
        appId: configs.github.appId,
        owner: {
          login: configs.github.ownerLogin,
          type: configs.github.ownerType,
          id: configs.github.ownerId,
        },
        repositories: configs.github.repositories,
        repositoryCount: configs.github.repositories?.length || 0,
        permissions: configs.github.permissions,
        events: configs.github.events,
        setupAt: configs.github.setupAt,
        lastWebhookAt: configs.github.lastWebhookAt,
        webhookCount: configs.github.webhookCount || 0,
        installationId: configs.github.installationId,
        hasCredentials: !!(configs.github.privateKeyEncrypted && configs.github.webhookSecretEncrypted)
      };
    }

    return new Response(JSON.stringify(statusResponse, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error fetching status:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500
    });
  }
}
