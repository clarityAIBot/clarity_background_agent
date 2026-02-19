import { Hono } from 'hono';
import { getDb } from '../../db/client';
import { AppConfigRepository } from '../../db/repositories';
import { logWithContext } from '../../core/log';
import { decrypt } from '../../core/crypto';
import { hasAnyLLMKey } from '../../utils/llm-config';
import { DbEnv } from '../../core/types';

const app = new Hono<{ Bindings: DbEnv }>();

// Disable caching for all config API routes
app.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
});

// GET /api/config/github - Get GitHub config (decrypted for container use)
app.get('/github', async (c) => {
    logWithContext('API_CONFIG', 'Getting GitHub config');

    try {
        const db = getDb(c.env);
        const repo = new AppConfigRepository(db);
        const config = await repo.getGitHubConfig();

        if (!config) {
            return c.json({ error: 'GitHub config not found' }, 404);
        }

        const encryptionKey = c.env.ENCRYPTION_KEY;

        // Decrypt sensitive fields for container use
        const decryptedConfig = {
            appId: config.appId,
            installationId: config.installationId,
            ownerLogin: config.ownerLogin,
            ownerType: config.ownerType,
            ownerId: config.ownerId,
            permissions: config.permissions,
            events: config.events,
            repositories: config.repositories,
            // Decrypt sensitive fields
            privateKey: config.privateKeyEncrypted ? await decrypt(config.privateKeyEncrypted, encryptionKey) : null,
            webhookSecret: config.webhookSecretEncrypted ? await decrypt(config.webhookSecretEncrypted, encryptionKey) : null,
            installationToken: config.installationToken ? await decrypt(config.installationToken, encryptionKey) : null,
            tokenExpiresAt: config.tokenExpiresAt,
        };

        logWithContext('API_CONFIG', 'GitHub config retrieved', {
            appId: config.appId,
            hasToken: !!decryptedConfig.installationToken
        });

        return c.json(decryptedConfig);
    } catch (error) {
        logWithContext('API_CONFIG', 'Error getting GitHub config', {
            error: error instanceof Error ? error.message : String(error)
        });
        return c.json({ error: 'Failed to get GitHub config' }, 500);
    }
});

// GET /api/config/github/token - Get just the installation token (for container use)
app.get('/github/token', async (c) => {
    logWithContext('API_CONFIG', 'Getting GitHub installation token');

    try {
        const db = getDb(c.env);
        const repo = new AppConfigRepository(db);
        const config = await repo.getGitHubConfig();

        if (!config) {
            return c.json({ error: 'GitHub config not found' }, 404);
        }

        // Check if token is expired
        const isExpired = await repo.isGitHubTokenExpired();

        if (isExpired || !config.installationToken) {
            return c.json({
                error: 'Token expired or not available',
                needsRefresh: true
            }, 401);
        }

        const decryptedToken = await decrypt(config.installationToken, c.env.ENCRYPTION_KEY);

        return c.json({
            token: decryptedToken,
            expiresAt: config.tokenExpiresAt
        });
    } catch (error) {
        logWithContext('API_CONFIG', 'Error getting GitHub token', {
            error: error instanceof Error ? error.message : String(error)
        });
        return c.json({ error: 'Failed to get GitHub token' }, 500);
    }
});

// GET /api/config/claude - Get LLM config (decrypted for container use)
// Kept as /claude for backwards compatibility
app.get('/claude', async (c) => {
    logWithContext('API_CONFIG', 'Getting LLM config');

    try {
        const db = getDb(c.env);
        const repo = new AppConfigRepository(db);
        const config = await repo.getLLMConfig();

        if (!config) {
            return c.json({ error: 'LLM config not found' }, 404);
        }

        const encryptionKey = c.env.ENCRYPTION_KEY;

        // Decrypt all configured API keys for container use
        const decryptedConfig: Record<string, string | null> = {
            anthropicApiKey: config.anthropicApiKeyEncrypted ? await decrypt(config.anthropicApiKeyEncrypted, encryptionKey) : null,
            openaiApiKey: config.openaiApiKeyEncrypted ? await decrypt(config.openaiApiKeyEncrypted, encryptionKey) : null,
            googleApiKey: config.googleApiKeyEncrypted ? await decrypt(config.googleApiKeyEncrypted, encryptionKey) : null,
            groqApiKey: config.groqApiKeyEncrypted ? await decrypt(config.groqApiKeyEncrypted, encryptionKey) : null,
            deepseekApiKey: config.deepseekApiKeyEncrypted ? await decrypt(config.deepseekApiKeyEncrypted, encryptionKey) : null,
            mistralApiKey: config.mistralApiKeyEncrypted ? await decrypt(config.mistralApiKeyEncrypted, encryptionKey) : null,
            togetherApiKey: config.togetherApiKeyEncrypted ? await decrypt(config.togetherApiKeyEncrypted, encryptionKey) : null,
            fireworksApiKey: config.fireworksApiKeyEncrypted ? await decrypt(config.fireworksApiKeyEncrypted, encryptionKey) : null,
        };

        logWithContext('API_CONFIG', 'LLM config retrieved', {
            hasAnthropicKey: !!decryptedConfig.anthropicApiKey,
            hasOpenaiKey: !!decryptedConfig.openaiApiKey,
            hasGoogleKey: !!decryptedConfig.googleApiKey,
        });

        return c.json({
            ...decryptedConfig,
            setupAt: config.setupAt,
            updatedAt: config.updatedAt
        });
    } catch (error) {
        logWithContext('API_CONFIG', 'Error getting LLM config', {
            error: error instanceof Error ? error.message : String(error)
        });
        return c.json({ error: 'Failed to get LLM config' }, 500);
    }
});

// GET /api/config/slack - Get Slack config (decrypted for container use)
app.get('/slack', async (c) => {
    logWithContext('API_CONFIG', 'Getting Slack config');

    try {
        const db = getDb(c.env);
        const repo = new AppConfigRepository(db);
        const config = await repo.getSlackConfig();

        if (!config) {
            return c.json({ error: 'Slack config not found' }, 404);
        }

        // Decrypt sensitive fields for container use
        const encryptionKey = c.env.ENCRYPTION_KEY;
        const signingSecret = config.signingSecretEncrypted ? await decrypt(config.signingSecretEncrypted, encryptionKey) : null;
        const botToken = config.botTokenEncrypted ? await decrypt(config.botTokenEncrypted, encryptionKey) : null;

        logWithContext('API_CONFIG', 'Slack config retrieved', {
            hasSigningSecret: !!signingSecret,
            hasBotToken: !!botToken
        });

        return c.json({
            signingSecret,
            botToken,
            setupAt: config.setupAt
        });
    } catch (error) {
        logWithContext('API_CONFIG', 'Error getting Slack config', {
            error: error instanceof Error ? error.message : String(error)
        });
        return c.json({ error: 'Failed to get Slack config' }, 500);
    }
});

// GET /api/config/system-defaults - Get system defaults config
app.get('/system-defaults', async (c) => {
    logWithContext('API_CONFIG', 'Getting system defaults config');

    try {
        const db = getDb(c.env);
        const repo = new AppConfigRepository(db);
        const config = await repo.getSystemDefaultsConfig();

        if (!config) {
            // Return defaults if not configured
            return c.json({
                defaultAgentType: 'claude-code',
                defaultAgentProvider: 'anthropic',
            });
        }

        logWithContext('API_CONFIG', 'System defaults config retrieved', {
            defaultAgentType: config.defaultAgentType,
            defaultRepository: config.defaultRepository,
        });

        return c.json(config);
    } catch (error) {
        logWithContext('API_CONFIG', 'Error getting system defaults config', {
            error: error instanceof Error ? error.message : String(error)
        });
        return c.json({ error: 'Failed to get system defaults config' }, 500);
    }
});

// PUT /api/config/system-defaults - Update system defaults config
app.put('/system-defaults', async (c) => {
    logWithContext('API_CONFIG', 'Updating system defaults config');

    try {
        const body = await c.req.json();
        const db = getDb(c.env);
        const repo = new AppConfigRepository(db);

        await repo.updateSystemDefaultsConfig(body);

        logWithContext('API_CONFIG', 'System defaults config updated', {
            defaultAgentType: body.defaultAgentType,
            defaultRepository: body.defaultRepository,
        });

        return c.json({ success: true });
    } catch (error) {
        logWithContext('API_CONFIG', 'Error updating system defaults config', {
            error: error instanceof Error ? error.message : String(error)
        });
        return c.json({ error: 'Failed to update system defaults config' }, 500);
    }
});

// GET /api/config/status - Check which configs are set up
app.get('/status', async (c) => {
    logWithContext('API_CONFIG', 'Getting config status');

    try {
        const db = getDb(c.env);
        const repo = new AppConfigRepository(db);
        const configs = await repo.getAllConfigs();

        return c.json({
            github: {
                configured: !!configs.github,
                appId: configs.github?.appId,
                hasToken: !!configs.github?.installationToken,
            },
            claude: {
                configured: hasAnyLLMKey(configs.llm),
            },
            slack: {
                configured: !!configs.slack,
            },
            systemDefaults: {
                configured: !!configs.systemDefaults,
                defaultAgentType: configs.systemDefaults?.defaultAgentType,
                defaultRepository: configs.systemDefaults?.defaultRepository,
            }
        });
    } catch (error) {
        logWithContext('API_CONFIG', 'Error getting config status', {
            error: error instanceof Error ? error.message : String(error)
        });
        return c.json({ error: 'Failed to get config status' }, 500);
    }
});

export { app as configApi };
