/**
 * SlackProgressReporter - Posts live progress updates to a Slack thread.
 *
 * Uses a single updatable message (chat.postMessage + chat.update) to avoid
 * flooding the thread. Inspired by pi-mono's SlackContext adapter pattern.
 *
 * Key design:
 * - One message, edited in place via chat.update
 * - 30-second debounce between updates
 * - Sequential promise queue prevents race conditions
 * - Auto-cleanup deletes the status message when done
 * - All errors are logged but never thrown (progress is non-critical)
 */

import type { AgentProgressEvent } from './types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('SlackProgress');

const EMOJI = ':clarity-loading:';

export class SlackProgressReporter {
  private messageTs: string | null = null;
  private updateQueue: Promise<void> = Promise.resolve();
  private lastUpdateTime = 0;
  private toolDescriptions: string[] = [];
  private pendingFlush = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private issueNumber: string;

  constructor(
    private botToken: string,
    private channelId: string,
    private threadTs: string,
    issueNumber: string,
    private debounceMs = 30_000
  ) {
    this.issueNumber = issueNumber;
  }

  /**
   * Handle a progress event from the agent strategy.
   * Called by the executor's onProgress wrapper.
   */
  onProgress(event: AgentProgressEvent): void {
    switch (event.type) {
      case 'started':
        this.enqueue(() => this.postInitial());
        break;

      case 'thinking':
        // Only post initial if not already posted
        if (!this.messageTs) {
          this.enqueue(() => this.postInitial());
        }
        break;

      case 'tool_use': {
        // Extract contextual tool descriptions from event data
        const details = (event.data as { toolDetails?: { name: string; context: string }[] })?.toolDetails;
        if (details) {
          for (const detail of details) {
            this.toolDescriptions.push(detail.context);
          }
        } else {
          // Fallback to plain tool names
          const tools = (event.data as { tools?: string[] })?.tools;
          if (tools) {
            for (const tool of tools) {
              this.toolDescriptions.push(tool);
            }
          }
        }
        this.scheduleFlush();
        break;
      }

      case 'completed':
      case 'error':
        // Final flush then cleanup handled by caller
        this.flushNow();
        break;
    }
  }

  /**
   * Delete the status message. Called when agent execution finishes.
   * The consumer posts its own final notification (PR, error, etc.),
   * so we remove the transient progress message.
   */
  async cleanup(): Promise<void> {
    // Cancel any pending flush
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Wait for any pending updates to finish
    await this.updateQueue;

    // Delete the status message
    if (this.messageTs) {
      try {
        await this.slackApi('chat.delete', {
          channel: this.channelId,
          ts: this.messageTs,
        });
        logger.log('CLEANUP', 'Status message deleted');
      } catch (error) {
        // Non-critical — message may already be deleted
        logger.log('CLEANUP', 'Failed to delete status message', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // ============= Private Methods =============

  /**
   * Enqueue an async operation to run sequentially.
   * Prevents race conditions on Slack API calls.
   */
  private enqueue(fn: () => Promise<void>): void {
    this.updateQueue = this.updateQueue.then(async () => {
      try {
        await fn();
      } catch (error) {
        logger.log('QUEUE', 'Enqueued operation failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /**
   * Post the initial "Task in progress..." message.
   */
  private async postInitial(): Promise<void> {
    if (this.messageTs) return; // Already posted

    const text = `${EMOJI} *Task #${this.issueNumber} in progress...*`;

    try {
      const result = await this.slackApi('chat.postMessage', {
        channel: this.channelId,
        thread_ts: this.threadTs,
        text,
      });

      if (result.ok && result.ts) {
        this.messageTs = result.ts;
        this.lastUpdateTime = Date.now();
        logger.log('POST', 'Initial status message posted', { ts: this.messageTs });
      }
    } catch (error) {
      logger.log('POST', 'Failed to post initial message', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Schedule a debounced flush of accumulated tool names.
   */
  private scheduleFlush(): void {
    if (this.pendingFlush) return; // Already scheduled

    const elapsed = Date.now() - this.lastUpdateTime;
    if (elapsed >= this.debounceMs) {
      // Enough time passed — flush immediately
      this.flushNow();
    } else {
      // Schedule flush for remaining debounce time
      this.pendingFlush = true;
      this.flushTimer = setTimeout(() => {
        this.pendingFlush = false;
        this.flushTimer = null;
        this.flushNow();
      }, this.debounceMs - elapsed);
    }
  }

  /**
   * Immediately flush accumulated tool names to Slack.
   */
  private flushNow(): void {
    if (!this.messageTs || this.toolDescriptions.length === 0) return;

    // Show last 3 actions for concise context
    const recent = this.toolDescriptions.slice(-3);
    const actionList = recent.map(d => `• ${d}`).join('\n');
    const text = `${EMOJI} *Task #${this.issueNumber} in progress...*\n${actionList}`;

    this.enqueue(async () => {
      try {
        await this.slackApi('chat.update', {
          channel: this.channelId,
          ts: this.messageTs,
          text,
        });
        this.lastUpdateTime = Date.now();
      } catch (error) {
        logger.log('UPDATE', 'Failed to update status message', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /**
   * Make a Slack Web API call using raw fetch.
   */
  private async slackApi(method: string, body: Record<string, unknown>): Promise<any> {
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Slack API ${method} returned ${response.status}`);
    }

    const data = await response.json() as Record<string, unknown>;
    if (!data.ok) {
      logger.log('API', `Slack API ${method} error`, { error: data.error });
    }
    return data;
  }
}
