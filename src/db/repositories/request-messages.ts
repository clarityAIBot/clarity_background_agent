import { eq, asc } from 'drizzle-orm';
import { requestMessages, type RequestMessage, type NewRequestMessage, type MessageType, type MessageSource } from '../schema';
import type { DrizzleDb } from '../client';

// Common system actor for automated messages
const SYSTEM_ACTOR = { id: 'system', name: 'Clarity AI' } as const;

export class RequestMessagesRepository {
    constructor(private db: DrizzleDb) {}

    async getThread(requestId: string): Promise<RequestMessage[]> {
        return this.db.query.requestMessages.findMany({
            where: eq(requestMessages.requestId, requestId),
            orderBy: [asc(requestMessages.createdAt)],
        });
    }

    async addMessage(data: NewRequestMessage): Promise<RequestMessage> {
        const [result] = await this.db
            .insert(requestMessages)
            .values(data)
            .returning();
        return result;
    }

    // Initial request message
    async addInitialRequest(
        requestId: string,
        description: string,
        actor: { id: string; name: string },
        source: MessageSource,
        metadata?: Record<string, any>
    ): Promise<RequestMessage> {
        return this.addMessage({
            requestId,
            type: 'initial_request',
            source,
            content: description,
            actorId: actor.id,
            actorName: actor.name,
            metadata,
        });
    }

    // Clarification messages
    async addClarificationAsk(
        requestId: string,
        questions: string,
        metadata?: { slackThreadTs?: string; issueCommentId?: number }
    ): Promise<RequestMessage> {
        return this.addMessage({
            requestId,
            type: 'clarification_ask',
            source: 'system',
            content: questions,
            actorId: SYSTEM_ACTOR.id,
            actorName: SYSTEM_ACTOR.name,
            metadata,
        });
    }

    async addClarificationAnswer(
        requestId: string,
        answer: string,
        actor: { id: string; name: string },
        source: MessageSource,
        metadata?: Record<string, any>
    ): Promise<RequestMessage> {
        return this.addMessage({
            requestId,
            type: 'clarification_answer',
            source,
            content: answer,
            actorId: actor.id,
            actorName: actor.name,
            metadata,
        });
    }

    // Follow-up request
    async addFollowUpRequest(
        requestId: string,
        description: string,
        actor: { id: string; name: string },
        source: MessageSource,
        metadata?: Record<string, any>
    ): Promise<RequestMessage> {
        return this.addMessage({
            requestId,
            type: 'follow_up_request',
            source,
            content: description,
            actorId: actor.id,
            actorName: actor.name,
            metadata,
        });
    }

    // Processing lifecycle messages
    async addProcessingStarted(requestId: string, triggeredBy?: 'slack' | 'github' | 'web'): Promise<RequestMessage> {
        return this.addMessage({
            requestId,
            type: 'processing_started',
            source: 'system',
            content: 'Processing started',
            actorId: SYSTEM_ACTOR.id,
            actorName: SYSTEM_ACTOR.name,
            metadata: triggeredBy ? { triggeredBy } : undefined,
        });
    }

    async addProcessingUpdate(
        requestId: string,
        update: string,
        metadata?: { fromStatus?: string; toStatus?: string }
    ): Promise<RequestMessage> {
        return this.addMessage({
            requestId,
            type: 'processing_update',
            source: 'system',
            content: update,
            actorId: SYSTEM_ACTOR.id,
            actorName: SYSTEM_ACTOR.name,
            metadata,
        });
    }

    async addPRCreated(
        requestId: string,
        prUrl: string,
        durationMs: number,
        costCents: number
    ): Promise<RequestMessage> {
        return this.addMessage({
            requestId,
            type: 'pr_created',
            source: 'system',
            content: `Pull Request created: ${prUrl}`,
            actorId: SYSTEM_ACTOR.id,
            actorName: SYSTEM_ACTOR.name,
            metadata: { durationMs, costCents },
        });
    }

    async addPRUpdated(
        requestId: string,
        prUrl: string,
        commitSha: string,
        durationMs: number,
        costCents: number
    ): Promise<RequestMessage> {
        return this.addMessage({
            requestId,
            type: 'pr_updated',
            source: 'system',
            content: `Pull Request updated: ${prUrl}`,
            actorId: SYSTEM_ACTOR.id,
            actorName: SYSTEM_ACTOR.name,
            metadata: { commitSha, durationMs, costCents },
        });
    }

    // Error and retry messages
    async addError(
        requestId: string,
        errorCode: string,
        errorMessage: string,
        errorStack?: string,
        retryCount?: number
    ): Promise<RequestMessage> {
        return this.addMessage({
            requestId,
            type: 'error',
            source: 'system',
            content: errorMessage,
            actorId: SYSTEM_ACTOR.id,
            actorName: SYSTEM_ACTOR.name,
            metadata: { errorCode, errorMessage, errorStack, retryCount },
        });
    }

    async addRetry(
        requestId: string,
        retryCount: number,
        triggeredBy: { id: string; name: string },
        source: MessageSource,
        errorMessage?: string
    ): Promise<RequestMessage> {
        const content = errorMessage
            ? `Retry attempt #${retryCount}: ${errorMessage}`
            : `Retry attempt #${retryCount}`;

        return this.addMessage({
            requestId,
            type: 'retry',
            source,
            content,
            actorId: triggeredBy.id,
            actorName: triggeredBy.name,
            metadata: {
                retryCount,
                errorMessage: errorMessage || undefined,
            },
        });
    }

    async addCancelled(
        requestId: string,
        reason: string,
        cancelledBy: { id: string; name: string }
    ): Promise<RequestMessage> {
        return this.addMessage({
            requestId,
            type: 'cancelled',
            source: 'system',
            content: reason,
            actorId: cancelledBy.id,
            actorName: cancelledBy.name,
        });
    }

    // Agent activity messages (for Claude Code-like UI)
    async addAgentThinking(
        requestId: string,
        thinking: string,
        turnId: string,
        turnNumber: number
    ): Promise<RequestMessage> {
        return this.addMessage({
            requestId,
            type: 'agent_thinking',
            source: 'system',
            content: thinking,
            actorId: SYSTEM_ACTOR.id,
            actorName: SYSTEM_ACTOR.name,
            metadata: { turnId, turnNumber },
        });
    }

    async addAgentToolCall(
        requestId: string,
        toolName: string,
        toolInput: Record<string, any>,
        turnId: string,
        turnNumber: number
    ): Promise<RequestMessage> {
        return this.addMessage({
            requestId,
            type: 'agent_tool_call',
            source: 'system',
            content: `Calling ${toolName}`,
            actorId: SYSTEM_ACTOR.id,
            actorName: SYSTEM_ACTOR.name,
            metadata: { toolName, toolInput, turnId, turnNumber },
        });
    }

    async addAgentToolResult(
        requestId: string,
        toolName: string,
        toolOutput: string,
        toolDurationMs: number,
        turnId: string,
        costCents?: number
    ): Promise<RequestMessage> {
        return this.addMessage({
            requestId,
            type: 'agent_tool_result',
            source: 'system',
            content: toolOutput.substring(0, 500), // Truncate for display
            actorId: SYSTEM_ACTOR.id,
            actorName: SYSTEM_ACTOR.name,
            metadata: { toolName, toolOutput, toolDurationMs, turnId, costCents },
        });
    }

    async addAgentFileChange(
        requestId: string,
        filePath: string,
        fileAction: 'created' | 'modified' | 'deleted',
        diffPreview?: string,
        turnId?: string
    ): Promise<RequestMessage> {
        return this.addMessage({
            requestId,
            type: 'agent_file_change',
            source: 'system',
            content: `${fileAction} ${filePath}`,
            actorId: SYSTEM_ACTOR.id,
            actorName: SYSTEM_ACTOR.name,
            metadata: { filePath, fileAction, diffPreview, turnId },
        });
    }

    async addAgentTerminal(
        requestId: string,
        command: string,
        exitCode: number,
        stdout?: string,
        stderr?: string,
        turnId?: string
    ): Promise<RequestMessage> {
        return this.addMessage({
            requestId,
            type: 'agent_terminal',
            source: 'system',
            content: command,
            actorId: SYSTEM_ACTOR.id,
            actorName: SYSTEM_ACTOR.name,
            metadata: { command, exitCode, stdout, stderr, turnId },
        });
    }

    async addAgentSummary(
        requestId: string,
        summary: string,
        durationMs: number,
        costCents: number
    ): Promise<RequestMessage> {
        return this.addMessage({
            requestId,
            type: 'agent_summary',
            source: 'system',
            content: summary,
            actorId: SYSTEM_ACTOR.id,
            actorName: SYSTEM_ACTOR.name,
            metadata: { durationMs, costCents },
        });
    }

    // Metrics aggregation
    async getTotalMetrics(requestId: string): Promise<{ totalDurationMs: number; totalCostCents: number }> {
        const messages = await this.getThread(requestId);
        let totalDurationMs = 0;
        let totalCostCents = 0;

        for (const msg of messages) {
            if (msg.metadata) {
                const meta = msg.metadata as Record<string, any>;
                totalDurationMs += meta.durationMs || meta.toolDurationMs || 0;
                totalCostCents += meta.costCents || 0;
            }
        }

        return { totalDurationMs, totalCostCents };
    }

    // Get agent activity for UI display (grouped by turn)
    async getAgentActivity(requestId: string): Promise<{
        messages: RequestMessage[];
        turns: Record<string, RequestMessage[]>;
        totalTurns: number;
    }> {
        const messages = await this.getThread(requestId);
        const agentTypes: MessageType[] = [
            'agent_thinking', 'agent_tool_call', 'agent_tool_result',
            'agent_file_change', 'agent_terminal', 'agent_summary'
        ];

        const agentMessages = messages.filter(m => agentTypes.includes(m.type));

        // Group by turnId for UI display
        const turns = new Map<string, RequestMessage[]>();
        for (const msg of agentMessages) {
            const meta = msg.metadata as Record<string, any> | null;
            const turnId = meta?.turnId || 'unknown';
            if (!turns.has(turnId)) {
                turns.set(turnId, []);
            }
            turns.get(turnId)!.push(msg);
        }

        return {
            messages: agentMessages,
            turns: Object.fromEntries(turns),
            totalTurns: turns.size,
        };
    }

    // Get conversation history (excluding agent activity details)
    async getConversationHistory(requestId: string): Promise<RequestMessage[]> {
        const messages = await this.getThread(requestId);
        const conversationTypes: MessageType[] = [
            'initial_request', 'clarification_ask', 'clarification_answer',
            'follow_up_request', 'processing_started', 'processing_update',
            'pr_created', 'pr_updated', 'error', 'retry', 'cancelled', 'agent_summary'
        ];

        return messages.filter(m => conversationTypes.includes(m.type));
    }

    /**
     * Get last N conversation messages for agent context.
     * Only includes clarification Q&A and follow-up requests (not system messages).
     */
    async getAgentConversationContext(requestId: string, limit: number = 10): Promise<RequestMessage[]> {
        const messages = await this.getThread(requestId);

        // Only include user-relevant conversation messages
        const relevantTypes: MessageType[] = [
            'clarification_ask', 'clarification_answer', 'follow_up_request'
        ];

        const relevantMessages = messages.filter(m => relevantTypes.includes(m.type));

        // Return last N messages
        return relevantMessages.slice(-limit);
    }

    // Get errors for a request
    async getErrors(requestId: string): Promise<RequestMessage[]> {
        const messages = await this.getThread(requestId);
        return messages.filter(m => m.type === 'error');
    }

    /**
     * Check if a follow-up request with a specific Slack messageTs already exists.
     * Used for deduplication when Slack retries events.
     */
    async hasFollowUpWithMessageTs(requestId: string, messageTs: string): Promise<boolean> {
        const messages = await this.getThread(requestId);
        return messages.some(m => {
            if (m.type !== 'follow_up_request') return false;
            const meta = m.metadata as Record<string, any> | null;
            return meta?.messageTs === messageTs;
        });
    }

    // Get file changes for a request
    async getFileChanges(requestId: string): Promise<RequestMessage[]> {
        const messages = await this.getThread(requestId);
        return messages.filter(m => m.type === 'agent_file_change');
    }
}
