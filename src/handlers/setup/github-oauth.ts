import { encrypt } from "../../core/crypto";
import { logWithContext } from "../../core/log";
import { getDb } from "../../db/client";
import { AppConfigRepository } from "../../db/repositories";
import type { GitHubAppData, Env } from "../../core/types";

export async function handleOAuthCallback(_request: Request, url: URL, env: Env): Promise<Response> {
  logWithContext('OAUTH_CALLBACK', 'Handling OAuth callback', {
    hasCode: !!url.searchParams.get('code'),
    origin: url.origin
  });

  const code = url.searchParams.get('code');

  if (!code) {
    logWithContext('OAUTH_CALLBACK', 'Missing authorization code in callback');
    return new Response('Missing authorization code', { status: 400 });
  }

  try {
    // Exchange temporary code for app credentials
    logWithContext('OAUTH_CALLBACK', 'Exchanging code for app credentials', { code: code.substring(0, 8) + '...' });

    const response = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Worker-GitHub-Integration'
      }
    });

    logWithContext('OAUTH_CALLBACK', 'GitHub manifest conversion response', {
      status: response.status,
      statusText: response.statusText
    });

    if (!response.ok) {
      const errorText = await response.text();
      logWithContext('OAUTH_CALLBACK', 'GitHub API error', {
        status: response.status,
        error: errorText
      });
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const appData = await response.json() as GitHubAppData;
    logWithContext('OAUTH_CALLBACK', 'App credentials received', {
      appId: appData.id,
      appName: appData.name,
      owner: appData.owner?.login
    });

    // Store app credentials securely in PostgreSQL
    logWithContext('OAUTH_CALLBACK', 'Storing app credentials in PostgreSQL');

    try {
      const encryptedPrivateKey = await encrypt(appData.pem, env.ENCRYPTION_KEY);
      const encryptedWebhookSecret = await encrypt(appData.webhook_secret, env.ENCRYPTION_KEY);

      logWithContext('OAUTH_CALLBACK', 'App credentials encrypted successfully');

      const db = getDb(env);
      const repo = new AppConfigRepository(db);

      await repo.setGitHubConfig({
        appId: appData.id.toString(),
        privateKeyEncrypted: encryptedPrivateKey,
        webhookSecretEncrypted: encryptedWebhookSecret,
        ownerLogin: appData.owner?.login || 'unknown',
        ownerType: 'User',
        ownerId: 0,
        permissions: {
          contents: 'read',
          metadata: 'read',
          pull_requests: 'write',
          issues: 'write'
        },
        events: ['issues'],
        repositories: [],
      });

      logWithContext('OAUTH_CALLBACK', 'App config stored in PostgreSQL', {
        appId: appData.id
      });
    } catch (error) {
      logWithContext('OAUTH_CALLBACK', 'Failed to store app config', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }

    // Redirect to SvelteKit frontend with success params
    const installUrl = `${appData.html_url}/installations/new`;
    const redirectUrl = new URL('/gh-setup', url.origin);
    redirectUrl.searchParams.set('success', 'true');
    redirectUrl.searchParams.set('app_id', appData.id.toString());
    redirectUrl.searchParams.set('app_name', appData.name);
    redirectUrl.searchParams.set('install_url', installUrl);

    logWithContext('OAUTH_CALLBACK', 'Redirecting to SvelteKit frontend', {
      redirectUrl: redirectUrl.toString()
    });

    return Response.redirect(redirectUrl.toString(), 302);

  } catch (error) {
    logWithContext('OAUTH_CALLBACK', 'OAuth callback error', {
      error: error instanceof Error ? error.message : String(error)
    });
    return new Response(`Setup failed: ${(error as Error).message}`, { status: 500 });
  }
}
