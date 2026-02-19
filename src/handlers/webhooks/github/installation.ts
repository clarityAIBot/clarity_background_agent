import { logWithContext } from "../../../core/log";
import { getDb } from "../../../db/client";
import { AppConfigRepository } from "../../../db/repositories";
import type { Env } from "../../../core/types";

// Handle installation events (app installed/uninstalled)
export async function handleInstallationEvent(data: any, env: Env): Promise<Response> {
  const action = data.action;
  const installation = data.installation;

  logWithContext('INSTALLATION_EVENT', 'Processing installation event', {
    action,
    installationId: installation?.id,
    account: installation?.account?.login,
    accountType: installation?.account?.type
  });

  if (action === 'created') {
    // App was installed - update configuration with installation details
    const repositories = data.repositories || [];
    const repoData = repositories.map((repo: any) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
    }));

    logWithContext('INSTALLATION_EVENT', 'Updating installation configuration', {
      repositoryCount: repositories.length,
      repositories: repoData.map((r: any) => r.fullName)
    });

    // Update GitHub config in PostgreSQL
    try {
      const db = getDb(env);
      const configRepo = new AppConfigRepository(db);
      const currentConfig = await configRepo.getGitHubConfig();

      if (currentConfig) {
        await configRepo.setGitHubConfig({
          ...currentConfig,
          installationId: installation.id.toString(),
          repositories: repoData,
          ownerLogin: installation.account.login,
          ownerType: installation.account.type,
          ownerId: installation.account.id
        });

        logWithContext('INSTALLATION_EVENT', 'App installed successfully', {
          repositoryCount: repositories.length
        });
      } else {
        logWithContext('INSTALLATION_EVENT', 'No existing GitHub config found to update');
      }
    } catch (error) {
      logWithContext('INSTALLATION_EVENT', 'Failed to update installation config', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  } else if (action === 'deleted') {
    // App was uninstalled - could clean up or mark as inactive
    logWithContext('INSTALLATION_EVENT', 'App installation removed', {
      installationId: installation?.id
    });
  } else {
    logWithContext('INSTALLATION_EVENT', 'Unhandled installation action', { action });
  }

  return new Response('Installation event processed', { status: 200 });
}
