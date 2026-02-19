/**
 * Queue abstraction layer for provider-agnostic queue operations.
 * Allows switching between Cloudflare Queues, AWS SQS, etc.
 */

import { CURRENT_QUEUE_PROVIDER, QUEUE_PROVIDER, type QueueProviderType } from "../core/constants";
import { fromCloudflareQueue, fromCloudflareBatch } from "./adapters/cloudflare";

/**
 * Abstract queue message interface
 * Wraps the message payload with queue operations
 */
export interface IQueueMessage<T> {
  /** The message payload */
  readonly body: T;

  /** Number of delivery attempts (1-based) */
  readonly attempts: number;

  /** Acknowledge successful processing */
  ack(): void;

  /** Request retry (re-queue the message) */
  retry(): void;
}

/**
 * Abstract queue batch interface
 * Represents a batch of messages to process
 */
export interface IQueueBatch<T> {
  /** Queue name/identifier */
  readonly queue: string;

  /** Messages in this batch */
  readonly messages: IQueueMessage<T>[];
}

/**
 * Abstract queue producer interface
 * Used to send messages to a queue
 */
export interface IQueueProducer<T> {
  /** Send a message to the queue */
  send(message: T): Promise<void>;

  /** Send multiple messages (batch) */
  sendBatch?(messages: T[]): Promise<void>;
}

/**
 * Retry info extracted from a queue message
 */
export interface RetryInfo {
  attemptNumber: number;
  isLastAttempt: boolean;
}

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  maxAttempts: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
};

/**
 * Get retry information from a queue message
 */
export function getMessageRetryInfo(
  message: IQueueMessage<unknown>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): RetryInfo {
  const attemptNumber = message.attempts;
  const isLastAttempt = attemptNumber >= config.maxAttempts;
  return { attemptNumber, isLastAttempt };
}

/**
 * Handle message retry or final failure
 */
export function handleMessageRetryOrFail(
  message: IQueueMessage<unknown>,
  isLastAttempt: boolean,
  onFinalFailure?: () => void
): void {
  if (isLastAttempt) {
    message.ack(); // Acknowledge to prevent infinite retries
    onFinalFailure?.();
  } else {
    message.retry();
  }
}

/**
 * Queue factory configuration
 * Passed to createQueueProducer to create the appropriate producer
 */
export interface QueueFactoryConfig<T> {
  /** Cloudflare Queue instance (required for Cloudflare provider) */
  cloudflareQueue?: Queue<T>;
  /** SQS queue URL (required for SQS provider) */
  sqsQueueUrl?: string;
  /** Redis connection (required for Redis provider) */
  redisClient?: unknown;
}

/**
 * Create a queue producer based on the configured provider type
 * @param config - Provider-specific configuration
 * @param providerOverride - Optional override for the provider type (defaults to CURRENT_QUEUE_PROVIDER)
 */
export function createQueueProducer<T>(
  config: QueueFactoryConfig<T>,
  providerOverride?: QueueProviderType
): IQueueProducer<T> {
  const provider = providerOverride ?? CURRENT_QUEUE_PROVIDER;

  switch (provider) {
    case QUEUE_PROVIDER.CLOUDFLARE:
      if (!config.cloudflareQueue) {
        throw new Error("Cloudflare queue is required for Cloudflare provider");
      }
      return fromCloudflareQueue(config.cloudflareQueue);

    case QUEUE_PROVIDER.SQS:
      if (!config.sqsQueueUrl) {
        throw new Error("SQS queue URL is required for SQS provider");
      }
      // TODO: Implement SQS adapter
      throw new Error("SQS provider not yet implemented");

    case QUEUE_PROVIDER.REDIS:
      if (!config.redisClient) {
        throw new Error("Redis client is required for Redis provider");
      }
      // TODO: Implement Redis adapter
      throw new Error("Redis provider not yet implemented");

    default:
      throw new Error(`Unknown queue provider: ${provider}`);
  }
}

/**
 * Create a queue batch wrapper based on the configured provider type
 * @param batch - Provider-specific batch object
 * @param providerOverride - Optional override for the provider type
 */
export function createQueueBatch<T>(
  batch: unknown,
  providerOverride?: QueueProviderType
): IQueueBatch<T> {
  const provider = providerOverride ?? CURRENT_QUEUE_PROVIDER;

  switch (provider) {
    case QUEUE_PROVIDER.CLOUDFLARE:
      return fromCloudflareBatch(batch as MessageBatch<T>);

    case QUEUE_PROVIDER.SQS:
      // TODO: Implement SQS adapter
      throw new Error("SQS provider not yet implemented");

    case QUEUE_PROVIDER.REDIS:
      // TODO: Implement Redis adapter
      throw new Error("Redis provider not yet implemented");

    default:
      throw new Error(`Unknown queue provider: ${provider}`);
  }
}
