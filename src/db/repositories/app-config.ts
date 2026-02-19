import { eq } from 'drizzle-orm';
import { appConfig, type GitHubConfig, type LLMConfig, type SlackConfig, type SystemDefaultsConfig } from '../schema';
import type { DrizzleDb } from '../client';

export class AppConfigRepository {
    constructor(private db: DrizzleDb) {}

    async getGitHubConfig(): Promise<GitHubConfig | null> {
        const result = await this.db.query.appConfig.findFirst({
            where: eq(appConfig.type, 'github'),
        });
        return result?.config as GitHubConfig ?? null;
    }

    async setGitHubConfig(config: GitHubConfig): Promise<void> {
        await this.db
            .insert(appConfig)
            .values({ type: 'github', config })
            .onConflictDoUpdate({
                target: appConfig.type,
                set: { config, updatedAt: new Date() },
            });
    }

    async updateGitHubToken(token: string, expiresAt: string): Promise<void> {
        const current = await this.getGitHubConfig();
        if (!current) throw new Error('GitHub config not found');

        await this.setGitHubConfig({
            ...current,
            installationToken: token,
            tokenExpiresAt: expiresAt,
        });
    }

    // LLM Config methods (multi-provider support)
    async getLLMConfig(): Promise<LLMConfig | null> {
        const result = await this.db.query.appConfig.findFirst({
            where: eq(appConfig.type, 'llm'),
        });
        return result?.config as LLMConfig ?? null;
    }

    async setLLMConfig(config: LLMConfig): Promise<void> {
        await this.db
            .insert(appConfig)
            .values({ type: 'llm', config })
            .onConflictDoUpdate({
                target: appConfig.type,
                set: { config, updatedAt: new Date() },
            });
    }

    async updateLLMConfig(updates: Partial<LLMConfig>): Promise<void> {
        const current = await this.getLLMConfig();
        const newConfig: LLMConfig = {
            ...current,
            ...updates,
            updatedAt: new Date().toISOString(),
        };
        await this.setLLMConfig(newConfig);
    }

    async getSlackConfig(): Promise<SlackConfig | null> {
        const result = await this.db.query.appConfig.findFirst({
            where: eq(appConfig.type, 'slack'),
        });
        return result?.config as SlackConfig ?? null;
    }

    async setSlackConfig(config: SlackConfig): Promise<void> {
        await this.db
            .insert(appConfig)
            .values({ type: 'slack', config })
            .onConflictDoUpdate({
                target: appConfig.type,
                set: { config, updatedAt: new Date() },
            });
    }

    async getAllConfigs(): Promise<{
        github: GitHubConfig | null;
        llm: LLMConfig | null;
        slack: SlackConfig | null;
        systemDefaults: SystemDefaultsConfig | null;
    }> {
        const results = await this.db.query.appConfig.findMany();

        const configs: {
            github: GitHubConfig | null;
            llm: LLMConfig | null;
            slack: SlackConfig | null;
            systemDefaults: SystemDefaultsConfig | null;
        } = {
            github: null,
            llm: null,
            slack: null,
            systemDefaults: null,
        };

        for (const row of results) {
            switch (row.type) {
                case 'github':
                    configs.github = row.config as GitHubConfig;
                    break;
                case 'llm':
                    configs.llm = row.config as LLMConfig;
                    break;
                case 'slack':
                    configs.slack = row.config as SlackConfig;
                    break;
                case 'system_defaults':
                    configs.systemDefaults = row.config as SystemDefaultsConfig;
                    break;
            }
        }

        return configs;
    }

    // Check if GitHub token is expired or about to expire (within 5 minutes)
    async isGitHubTokenExpired(): Promise<boolean> {
        const config = await this.getGitHubConfig();
        if (!config?.tokenExpiresAt) return true;

        const expiresAt = new Date(config.tokenExpiresAt);
        const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);

        return expiresAt <= fiveMinutesFromNow;
    }

    // Delete GitHub config
    async deleteGitHubConfig(): Promise<void> {
        await this.db
            .delete(appConfig)
            .where(eq(appConfig.type, 'github'));
    }

    // Delete LLM config
    async deleteLLMConfig(): Promise<void> {
        await this.db
            .delete(appConfig)
            .where(eq(appConfig.type, 'llm'));
    }

    // Delete Slack config
    async deleteSlackConfig(): Promise<void> {
        await this.db
            .delete(appConfig)
            .where(eq(appConfig.type, 'slack'));
    }

    // System Defaults Config methods
    async getSystemDefaultsConfig(): Promise<SystemDefaultsConfig | null> {
        const result = await this.db.query.appConfig.findFirst({
            where: eq(appConfig.type, 'system_defaults'),
        });
        return result?.config as SystemDefaultsConfig ?? null;
    }

    async setSystemDefaultsConfig(config: SystemDefaultsConfig): Promise<void> {
        await this.db
            .insert(appConfig)
            .values({ type: 'system_defaults', config })
            .onConflictDoUpdate({
                target: appConfig.type,
                set: { config, updatedAt: new Date() },
            });
    }

    async updateSystemDefaultsConfig(updates: Partial<SystemDefaultsConfig>): Promise<void> {
        const current = await this.getSystemDefaultsConfig();
        const newConfig: SystemDefaultsConfig = {
            // Defaults if no existing config
            defaultAgentType: 'claude-code',
            defaultAgentProvider: 'anthropic',
            ...current,
            ...updates,
        };
        await this.setSystemDefaultsConfig(newConfig);
    }

    // Delete System Defaults config
    async deleteSystemDefaultsConfig(): Promise<void> {
        await this.db
            .delete(appConfig)
            .where(eq(appConfig.type, 'system_defaults'));
    }
}
