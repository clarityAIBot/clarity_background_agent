import { eq, gte, count, avg, sum, and, desc, sql } from 'drizzle-orm';
import { featureRequests, type FeatureRequest, type NewFeatureRequest } from '../schema';
import type { DrizzleDb } from '../client';

export class FeatureRequestRepository {
    constructor(private db: DrizzleDb) {}

    async findByRequestId(requestId: string): Promise<FeatureRequest | null> {
        const result = await this.db.query.featureRequests.findFirst({
            where: eq(featureRequests.requestId, requestId),
        });
        return result ?? null;
    }

    async findByIssueId(issueId: number): Promise<FeatureRequest | null> {
        const result = await this.db.query.featureRequests.findFirst({
            where: eq(featureRequests.issueId, issueId),
        });
        return result ?? null;
    }

    async findBySlackThread(channelId: string, threadTs: string): Promise<FeatureRequest | null> {
        const result = await this.db.query.featureRequests.findFirst({
            where: and(
                eq(featureRequests.slackChannelId, channelId),
                // Match either slackThreadTs or slackTriggerMessageTs (when first @mention started the thread)
                sql`(${featureRequests.slackThreadTs} = ${threadTs} OR ${featureRequests.slackTriggerMessageTs} = ${threadTs})`
            ),
        });
        return result ?? null;
    }

    /**
     * Find an active agent in a Slack thread (processing, awaiting_clarification, pending, pr_created, or issue_created)
     * Used for follow-up handling in Phase 3 of ADR-002
     * Includes pr_created and issue_created so follow-ups can be added to existing PRs
     *
     * Also checks slackTriggerMessageTs to handle the case where the first @mention
     * started the thread (slackTriggerMessageTs equals the thread parent ts)
     */
    async findActiveAgentInThread(channelId: string, threadTs: string): Promise<FeatureRequest | null> {
        const result = await this.db.query.featureRequests.findFirst({
            where: and(
                eq(featureRequests.slackChannelId, channelId),
                // Match either slackThreadTs or slackTriggerMessageTs (when first @mention started the thread)
                sql`(${featureRequests.slackThreadTs} = ${threadTs} OR ${featureRequests.slackTriggerMessageTs} = ${threadTs})`,
                // Include all active statuses plus completed (to allow follow-ups on completed PRs)
                // Only exclude cancelled and error
                sql`${featureRequests.status} IN ('processing', 'awaiting_clarification', 'pending', 'pr_created', 'issue_created', 'completed')`
            ),
            orderBy: [desc(featureRequests.createdAt)],
        });
        return result ?? null;
    }

    async findByGitHubIssue(repositoryName: string, issueNumber: number): Promise<FeatureRequest | null> {
        const result = await this.db.query.featureRequests.findFirst({
            where: and(
                eq(featureRequests.repositoryName, repositoryName),
                eq(featureRequests.issueNumber, issueNumber)
            ),
        });
        return result ?? null;
    }

    async create(data: NewFeatureRequest): Promise<FeatureRequest> {
        const [result] = await this.db
            .insert(featureRequests)
            .values(data)
            .returning();
        return result;
    }

    async updateStatus(
        requestId: string,
        status: FeatureRequest['status'],
        updates: Partial<FeatureRequest> = {}
    ): Promise<void> {
        await this.db
            .update(featureRequests)
            .set({
                status,
                ...updates,
                updatedAt: new Date(),
            })
            .where(eq(featureRequests.requestId, requestId));
    }

    async updateTaskStatus(
        requestId: string,
        taskStatus: FeatureRequest['taskStatus'],
        updates: Partial<FeatureRequest> = {}
    ): Promise<void> {
        await this.db
            .update(featureRequests)
            .set({
                taskStatus,
                ...updates,
                updatedAt: new Date(),
            })
            .where(eq(featureRequests.requestId, requestId));
    }

    async updatePRDetails(
        requestId: string,
        prUrl: string,
        prNumber: number,
        prBranchName: string
    ): Promise<void> {
        await this.db
            .update(featureRequests)
            .set({
                prUrl,
                prNumber,
                prBranchName,
                status: 'pr_created',
                updatedAt: new Date(),
            })
            .where(eq(featureRequests.requestId, requestId));
    }

    async updateSlackThreadTs(requestId: string, slackThreadTs: string, slackTriggerMessageTs?: string): Promise<void> {
        await this.db
            .update(featureRequests)
            .set({
                slackThreadTs,
                ...(slackTriggerMessageTs && { slackTriggerMessageTs }),
                updatedAt: new Date(),
            })
            .where(eq(featureRequests.requestId, requestId));
    }

    async updateTitle(requestId: string, title: string): Promise<void> {
        await this.db
            .update(featureRequests)
            .set({ title, updatedAt: new Date() })
            .where(eq(featureRequests.requestId, requestId));
    }

    async incrementRetryCount(requestId: string): Promise<void> {
        await this.db
            .update(featureRequests)
            .set({
                retryCount: sql`${featureRequests.retryCount} + 1`,
                lastRetryAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(featureRequests.requestId, requestId));
    }

    async markProcessed(requestId: string, durationMs: number, costUsd: number, sessionId?: string): Promise<void> {
        // Convert dollars to cents for storage
        const costCents = Math.round(costUsd * 100);
        await this.db
            .update(featureRequests)
            .set({
                status: 'completed',
                taskStatus: 'completed',
                processedAt: new Date(),
                durationMs,
                costUsd: costCents,
                ...(sessionId && { agentSessionId: sessionId }),  // Store session ID for persistence (ADR-001)
                updatedAt: new Date(),
            })
            .where(eq(featureRequests.requestId, requestId));
    }

    async markError(requestId: string): Promise<void> {
        await this.db
            .update(featureRequests)
            .set({
                status: 'error',
                taskStatus: 'error',
                updatedAt: new Date(),
            })
            .where(eq(featureRequests.requestId, requestId));
    }

    async getRecentRequests(limit: number = 50): Promise<FeatureRequest[]> {
        return this.db.query.featureRequests.findMany({
            orderBy: [desc(featureRequests.createdAt)],
            limit,
        });
    }

    async getRecentRequestsPaginated(limit: number = 100, offset: number = 0): Promise<{
        requests: FeatureRequest[];
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
    }> {
        const [requests, totalResult] = await Promise.all([
            this.db.query.featureRequests.findMany({
                orderBy: [desc(featureRequests.createdAt)],
                limit,
                offset,
            }),
            this.db.select({ count: count() }).from(featureRequests),
        ]);

        const total = totalResult[0]?.count ?? 0;
        const page = Math.floor(offset / limit) + 1;
        const totalPages = Math.ceil(total / limit);

        return {
            requests,
            total,
            page,
            pageSize: limit,
            totalPages,
        };
    }

    async getRequestsByStatus(
        status: FeatureRequest['status'],
        limit: number = 50
    ): Promise<FeatureRequest[]> {
        return this.db.query.featureRequests.findMany({
            where: eq(featureRequests.status, status),
            orderBy: [desc(featureRequests.createdAt)],
            limit,
        });
    }

    async getRequestsByRepo(repo: string, limit: number = 50): Promise<FeatureRequest[]> {
        return this.db.query.featureRequests.findMany({
            where: eq(featureRequests.repo, repo),
            orderBy: [desc(featureRequests.createdAt)],
            limit,
        });
    }

    async getRequestStats(since: Date): Promise<Array<{
        status: string | null;
        count: number;
        avgDurationMs: string | null;
        totalCostCents: string | null;
    }>> {
        return this.db
            .select({
                status: featureRequests.status,
                count: count(),
                avgDurationMs: avg(featureRequests.durationMs),
                totalCostCents: sum(featureRequests.costUsd),
            })
            .from(featureRequests)
            .where(gte(featureRequests.createdAt, since))
            .groupBy(featureRequests.status);
    }

    async getRequestCountByOrigin(since: Date): Promise<Array<{
        origin: string | null;
        count: number;
    }>> {
        return this.db
            .select({
                origin: featureRequests.origin,
                count: count(),
            })
            .from(featureRequests)
            .where(gte(featureRequests.createdAt, since))
            .groupBy(featureRequests.origin);
    }

    async getPendingRequests(): Promise<FeatureRequest[]> {
        return this.db.query.featureRequests.findMany({
            where: eq(featureRequests.taskStatus, 'pending'),
            orderBy: [featureRequests.createdAt],
        });
    }

    async getProcessingRequests(): Promise<FeatureRequest[]> {
        return this.db.query.featureRequests.findMany({
            where: eq(featureRequests.taskStatus, 'processing'),
            orderBy: [featureRequests.createdAt],
        });
    }

    async getRequestCount(): Promise<number> {
        const result = await this.db
            .select({ count: count() })
            .from(featureRequests);
        return result[0]?.count ?? 0;
    }
}
