import { getDb } from "../../db/client";
import { AppConfigRepository } from "../../db/repositories";
import { decrypt, generateInstallationToken, encrypt } from "../../core/crypto";
import { logWithContext } from "../../core/log";
import type { Env } from "../../core/types";

/**
 * GitHub config type for token operations
 */
export interface GitHubTokenConfig {
  appId: string;
  privateKeyEncrypted: string;
  installationId?: string;
  installationToken?: string;
}

/**
 * Get or refresh GitHub installation token using provided dependencies.
 * Use this when you already have configRepo instantiated.
 */
export async function getOrRefreshGitHubToken(
  configRepo: AppConfigRepository,
  githubConfig: GitHubTokenConfig,
  encryptionKey: string
): Promise<string> {
  const isTokenExpired = await configRepo.isGitHubTokenExpired();
  const needsRefresh = isTokenExpired || !githubConfig.installationToken;

  if (!needsRefresh) {
    return decrypt(githubConfig.installationToken!, encryptionKey);
  }

  logWithContext("GITHUB_TOKEN", "GitHub token expired or missing, refreshing");

  const privateKey = await decrypt(githubConfig.privateKeyEncrypted, encryptionKey);
  const tokenResult = await generateInstallationToken(
    githubConfig.appId,
    privateKey,
    githubConfig.installationId || ""
  );

  if (!tokenResult) {
    throw new Error("Failed to generate GitHub installation token");
  }

  const encryptedToken = await encrypt(tokenResult.token, encryptionKey);
  await configRepo.updateGitHubToken(encryptedToken, tokenResult.expires_at);

  return tokenResult.token;
}

/**
 * Get a valid GitHub installation token from PostgreSQL.
 * Automatically refreshes the token if expired.
 * Convenience wrapper that creates its own dependencies.
 */
export async function getGitHubToken(env: Env): Promise<string> {
  const db = getDb(env);
  const configRepo = new AppConfigRepository(db);

  const githubConfig = await configRepo.getGitHubConfig();
  if (!githubConfig) {
    throw new Error("GitHub config not found");
  }

  // Check if token is expired and refresh if needed
  const isTokenExpired = await configRepo.isGitHubTokenExpired();

  if (isTokenExpired || !githubConfig.installationToken) {
    logWithContext("GITHUB_TOKEN", "GitHub token expired or missing, refreshing");

    // Decrypt private key and generate new token
    const privateKey = await decrypt(githubConfig.privateKeyEncrypted, env.ENCRYPTION_KEY);
    const tokenResult = await generateInstallationToken(
      githubConfig.appId,
      privateKey,
      githubConfig.installationId || ""
    );

    if (!tokenResult) {
      throw new Error("Failed to generate GitHub installation token");
    }

    // Encrypt and store the new token
    const encryptedToken = await encrypt(tokenResult.token, env.ENCRYPTION_KEY);
    await configRepo.updateGitHubToken(encryptedToken, tokenResult.expires_at);

    return tokenResult.token;
  }

  // Decrypt existing token
  return decrypt(githubConfig.installationToken, env.ENCRYPTION_KEY);
}
