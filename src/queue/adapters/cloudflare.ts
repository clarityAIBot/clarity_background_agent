/**
 * Cloudflare Queue adapter implementation
 * Wraps Cloudflare-specific queue types with our abstract interfaces
 */

import type { IQueueMessage, IQueueBatch, IQueueProducer } from "../abstractions";

/**
 * Wraps a Cloudflare Queue Message with our abstract interface
 */
export class CloudflareQueueMessage<T> implements IQueueMessage<T> {
  constructor(private cfMessage: Message<T>) {}

  get body(): T {
    return this.cfMessage.body;
  }

  get attempts(): number {
    return this.cfMessage.attempts;
  }

  ack(): void {
    this.cfMessage.ack();
  }

  retry(): void {
    this.cfMessage.retry();
  }
}

/**
 * Wraps a Cloudflare Queue MessageBatch with our abstract interface
 */
export class CloudflareQueueBatch<T> implements IQueueBatch<T> {
  private wrappedMessages: IQueueMessage<T>[];

  constructor(private cfBatch: MessageBatch<T>) {
    this.wrappedMessages = cfBatch.messages.map(
      (msg) => new CloudflareQueueMessage(msg)
    );
  }

  get queue(): string {
    return this.cfBatch.queue;
  }

  get messages(): IQueueMessage<T>[] {
    return this.wrappedMessages;
  }
}

/**
 * Wraps a Cloudflare Queue with our abstract producer interface
 */
export class CloudflareQueueProducer<T> implements IQueueProducer<T> {
  constructor(private cfQueue: Queue<T>) {}

  async send(message: T): Promise<void> {
    await this.cfQueue.send(message);
  }

  async sendBatch(messages: T[]): Promise<void> {
    // Cloudflare Queue sendBatch expects MessageSendRequest objects
    await this.cfQueue.sendBatch(
      messages.map((body) => ({ body }))
    );
  }
}

/**
 * Factory function to create a batch adapter from Cloudflare MessageBatch
 */
export function fromCloudflareBatch<T>(batch: MessageBatch<T>): IQueueBatch<T> {
  return new CloudflareQueueBatch(batch);
}

/**
 * Factory function to create a producer adapter from Cloudflare Queue
 */
export function fromCloudflareQueue<T>(queue: Queue<T>): IQueueProducer<T> {
  return new CloudflareQueueProducer(queue);
}
