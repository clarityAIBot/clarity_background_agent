// Queue consumer and factory function
export { QueueConsumer, handleQueueMessage } from './consumer';

// Queue abstractions (provider-agnostic interfaces)
export type { IQueueMessage, IQueueBatch, IQueueProducer, RetryInfo, RetryConfig } from './abstractions';
export { getMessageRetryInfo, handleMessageRetryOrFail } from './abstractions';

// Queue adapters
export { fromCloudflareBatch, fromCloudflareQueue, CloudflareQueueMessage, CloudflareQueueBatch, CloudflareQueueProducer } from './adapters';

// Queue types
export type { IssueQueueMessage, SlackFeatureRequestMessage, SlackRetryRequestMessage, QueueMessage } from './types';
export { REQUEST_TYPE_EMOJI, getRequestTypeEmoji, buildErrorCommentBody } from './types';
