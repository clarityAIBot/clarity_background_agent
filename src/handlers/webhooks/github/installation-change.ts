import { logWithContext } from "../../../core/log";
import { getDb } from "../../../db/client";
import { AppConfigRepository } from "../../../db/repositories";
import type { Env } from "../../../core/types";

// Handle repository changes (repos added/removed from installation)
export async function handleInstallationRepositoriesEvent(data: any, env: Env): Promise<Response> {
  const action = data.action;

  const db = getDb(env);
  const configRepo = new AppConfigRepository(db);

  try {
    const currentConfig = await configRepo.getGitHubConfig();
    if (!currentConfig) {
      logWithContext('INSTALLATION_CHANGE', 'No GitHub config found');
      return new Response('No GitHub config found', { status: 404 });
    }

    const currentRepos = currentConfig.repositories || [];

    if (action === 'added') {
      const addedRepos = data.repositories_added || [];
      const newRepos = addedRepos.map((repo: any) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
      }));

      // Merge new repos with existing (avoid duplicates by id)
      const existingIds = new Set(currentRepos.map((r: any) => r.id));
      const uniqueNewRepos = newRepos.filter((r: any) => !existingIds.has(r.id));
      const updatedRepos = [...currentRepos, ...uniqueNewRepos];

      await configRepo.setGitHubConfig({
        ...currentConfig,
        repositories: updatedRepos
      });

      logWithContext('INSTALLATION_CHANGE', `Added ${addedRepos.length} repositories`, {
        added: newRepos.map((r: any) => r.fullName)
      });
    } else if (action === 'removed') {
      const removedRepos = data.repositories_removed || [];
      const removedIds = new Set(removedRepos.map((r: any) => r.id));

      const updatedRepos = currentRepos.filter((r: any) => !removedIds.has(r.id));

      await configRepo.setGitHubConfig({
        ...currentConfig,
        repositories: updatedRepos
      });

      logWithContext('INSTALLATION_CHANGE', `Removed ${removedRepos.length} repositories`, {
        removed: removedRepos.map((r: any) => r.full_name)
      });
    }
  } catch (error) {
    logWithContext('INSTALLATION_CHANGE', 'Failed to process repository changes', {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return new Response('Repository changes processed', { status: 200 });
}
