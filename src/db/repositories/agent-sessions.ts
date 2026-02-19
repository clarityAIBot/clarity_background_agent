/**
 * AgentSessionsRepository - Manages agent session persistence for ephemeral containers.
 *
 * ADR-001: Session Blob Persistence
 *
 * This repository handles:
 * - Storing session blobs after container execution
 * - Retrieving session blobs for follow-up requests
 * - TTL-based cleanup of expired sessions
 */

import { eq, lt, and } from 'drizzle-orm';
import { agentSessions, type AgentSession, type NewAgentSession, type AgentType } from '../schema';
import type { DrizzleDb } from '../client';

// Default session TTL: 7 days
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class AgentSessionsRepository {
    constructor(private db: DrizzleDb) {}

    /**
     * Save a session for a request.
     *
     * Strategy: Keep only the latest session per request.
     * - Deletes any existing sessions for the request
     * - Inserts the new session
     *
     * This approach:
     * - Saves storage (only one session per request)
     * - Simplifies lookup (no need to find "latest")
     * - Each follow-up creates a new SDK session ID anyway
     *
     * @param data Session data including requestId, sessionId, blob, etc.
     * @returns The created session record
     */
    async save(data: {
        requestId: string;
        sessionId: string;
        agentType: AgentType;
        sessionBlob: string;  // Already gzipped + base64 encoded
        blobSizeBytes: number;
        expiresAt?: Date;
    }): Promise<AgentSession> {
        const expiresAt = data.expiresAt ?? new Date(Date.now() + DEFAULT_SESSION_TTL_MS);

        // Delete existing sessions for this request (keep only latest)
        await this.db
            .delete(agentSessions)
            .where(eq(agentSessions.requestId, data.requestId));

        // Insert new session
        const [result] = await this.db
            .insert(agentSessions)
            .values({
                requestId: data.requestId,
                sessionId: data.sessionId,
                agentType: data.agentType,
                sessionBlob: data.sessionBlob,
                blobSizeBytes: data.blobSizeBytes,
                expiresAt,
            })
            .returning();

        return result;
    }

    /**
     * Get the session for a request.
     * Used when processing follow-up requests to restore context.
     *
     * Note: Only one session is stored per request (latest replaces previous).
     *
     * @param requestId The request ID to find session for
     * @returns The session or null if none exists
     */
    async getForRequest(requestId: string): Promise<AgentSession | null> {
        const result = await this.db.query.agentSessions.findFirst({
            where: eq(agentSessions.requestId, requestId),
        });
        return result ?? null;
    }

    /**
     * Get a specific session by its session ID.
     *
     * @param sessionId The SDK session ID
     * @returns The session or null if not found
     */
    async getBySessionId(sessionId: string): Promise<AgentSession | null> {
        const result = await this.db.query.agentSessions.findFirst({
            where: eq(agentSessions.sessionId, sessionId),
        });
        return result ?? null;
    }

    /**
     * Delete expired sessions.
     * Should be called periodically (e.g., via cron) to clean up old sessions.
     *
     * @returns Number of deleted sessions
     */
    async deleteExpired(): Promise<number> {
        const result = await this.db
            .delete(agentSessions)
            .where(
                and(
                    lt(agentSessions.expiresAt, new Date())
                )
            )
            .returning({ id: agentSessions.id });

        return result.length;
    }

    /**
     * Delete all sessions for a request.
     * Called when a request is cancelled or cleaned up.
     *
     * @param requestId The request ID
     * @returns Number of deleted sessions
     */
    async deleteForRequest(requestId: string): Promise<number> {
        const result = await this.db
            .delete(agentSessions)
            .where(eq(agentSessions.requestId, requestId))
            .returning({ id: agentSessions.id });

        return result.length;
    }

    /**
     * Get session storage statistics.
     * Useful for monitoring storage usage.
     *
     * @returns Stats including total sessions, total size, average size
     */
    async getStats(): Promise<{
        totalSessions: number;
        totalSizeBytes: number;
        avgSizeBytes: number;
        expiredCount: number;
    }> {
        const allSessions = await this.db.query.agentSessions.findMany();

        const now = new Date();
        const expiredCount = allSessions.filter(s =>
            s.expiresAt && s.expiresAt < now
        ).length;

        const totalSizeBytes = allSessions.reduce((sum, s) => sum + s.blobSizeBytes, 0);

        return {
            totalSessions: allSessions.length,
            totalSizeBytes,
            avgSizeBytes: allSessions.length > 0 ? Math.round(totalSizeBytes / allSessions.length) : 0,
            expiredCount,
        };
    }

    /**
     * Update the expiry time of a session.
     * Can be used to extend session lifetime if needed.
     *
     * @param sessionId The session ID
     * @param expiresAt New expiry date
     */
    async updateExpiry(sessionId: string, expiresAt: Date): Promise<void> {
        await this.db
            .update(agentSessions)
            .set({ expiresAt })
            .where(eq(agentSessions.sessionId, sessionId));
    }
}
