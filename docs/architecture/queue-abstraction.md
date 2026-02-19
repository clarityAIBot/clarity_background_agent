# Queue Abstraction Layer

**Date**: 2026-01-18
**Location**: `/src/queue/`

## Overview

The queue abstraction layer provides a provider-agnostic interface for queue operations. This allows Clarity AI to switch between different queue implementations (Cloudflare Queues, AWS SQS, Redis) without modifying the core consumer logic.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           QUEUE CONSUMER                                     │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      QueueConsumer Class                             │    │
│  │  - processBatch(batch: IQueueBatch<T>)                              │    │
│  │  - handleIssueMessage()                                              │    │
│  │  - handleSlackFeatureRequest()                                       │    │
│  │  - handleSlackRetryRequest()                                         │    │
│  └───────────────────────────────┬─────────────────────────────────────┘    │
│                                  │                                           │
│                                  ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Abstract Interfaces                               │    │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │    │
│  │  │ IQueueMessage<T>│  │ IQueueBatch<T>  │  │ IQueueProducer<T>   │  │    │
│  │  │ - body: T       │  │ - queue: string │  │ - send(msg: T)      │  │    │
│  │  │ - attempts: num │  │ - messages[]    │  │ - sendBatch(msgs[]) │  │    │
│  │  │ - ack()         │  │                 │  │                     │  │    │
│  │  │ - retry()       │  │                 │  │                     │  │    │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │    │
│  └───────────────────────────────┬─────────────────────────────────────┘    │
│                                  │                                           │
│                                  ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Factory Functions                                 │    │
│  │  ┌────────────────────────────┐  ┌────────────────────────────┐     │    │
│  │  │ createQueueProducer()      │  │ createQueueBatch()         │     │    │
│  │  │ - Reads CURRENT_QUEUE_     │  │ - Reads CURRENT_QUEUE_     │     │    │
│  │  │   PROVIDER from constants  │  │   PROVIDER from constants  │     │    │
│  │  │ - Returns correct adapter  │  │ - Returns correct adapter  │     │    │
│  │  └────────────────────────────┘  └────────────────────────────┘     │    │
│  └───────────────────────────────┬─────────────────────────────────────┘    │
└──────────────────────────────────┼──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ADAPTERS                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                  Cloudflare Adapter (Implemented)                    │    │
│  │  ┌─────────────────────┐  ┌─────────────────────┐                   │    │
│  │  │CloudflareQueueMessage│ │CloudflareQueueBatch │                   │    │
│  │  │ wraps Message<T>    │  │ wraps MessageBatch  │                   │    │
│  │  └─────────────────────┘  └─────────────────────┘                   │    │
│  │  ┌─────────────────────┐                                            │    │
│  │  │CloudflareQueueProducer                                           │    │
│  │  │ wraps Queue<T>      │                                            │    │
│  │  └─────────────────────┘                                            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                  SQS Adapter (TODO)                                  │    │
│  │  - SQSQueueMessage                                                   │    │
│  │  - SQSQueueBatch                                                     │    │
│  │  - SQSQueueProducer                                                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                  Redis Adapter (TODO)                                │    │
│  │  - RedisQueueMessage                                                 │    │
│  │  - RedisQueueBatch                                                   │    │
│  │  - RedisQueueProducer                                                │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## File Structure

```
src/queue/
├── index.ts              # Barrel exports
├── abstractions.ts       # Provider-agnostic interfaces and factory functions
├── consumer.ts           # QueueConsumer class
├── types.ts              # Message type definitions (IssueQueueMessage, etc.)
├── utils.ts              # Retry helpers, GitHub token refresh
└── adapters/
    ├── index.ts          # Adapter exports
    └── cloudflare.ts     # Cloudflare Queues implementation
```

## Core Interfaces

### IQueueMessage<T>

Wraps a queue message with operations for acknowledgment and retry:

```typescript
interface IQueueMessage<T> {
  readonly body: T;        // Message payload
  readonly attempts: number; // Delivery attempt count (1-based)
  ack(): void;             // Acknowledge successful processing
  retry(): void;           // Request re-queue for retry
}
```

### IQueueBatch<T>

Represents a batch of messages to process:

```typescript
interface IQueueBatch<T> {
  readonly queue: string;           // Queue name/identifier
  readonly messages: IQueueMessage<T>[]; // Messages in batch
}
```

### IQueueProducer<T>

Interface for sending messages to a queue:

```typescript
interface IQueueProducer<T> {
  send(message: T): Promise<void>;
  sendBatch?(messages: T[]): Promise<void>;
}
```

## Configuration

Queue provider selection is controlled via constants in `src/core/constants.ts`:

```typescript
export const QUEUE_PROVIDER = {
  CLOUDFLARE: 'cloudflare',
  SQS: 'sqs',
  REDIS: 'redis',
} as const;

export type QueueProviderType = typeof QUEUE_PROVIDER[keyof typeof QUEUE_PROVIDER];

// Change this to switch between queue implementations
export const CURRENT_QUEUE_PROVIDER: QueueProviderType = QUEUE_PROVIDER.CLOUDFLARE;
```

## Factory Functions

### createQueueProducer

Creates a queue producer based on the configured provider:

```typescript
function createQueueProducer<T>(
  config: QueueFactoryConfig<T>,
  providerOverride?: QueueProviderType
): IQueueProducer<T>
```

Usage:
```typescript
// Uses CURRENT_QUEUE_PROVIDER from constants
const producer = createQueueProducer({ cloudflareQueue: env.ISSUE_QUEUE });

// Or override provider
const sqsProducer = createQueueProducer(
  { sqsQueueUrl: 'https://sqs.us-east-1.amazonaws.com/...' },
  QUEUE_PROVIDER.SQS
);
```

### createQueueBatch

Wraps a provider-specific batch object:

```typescript
function createQueueBatch<T>(
  batch: unknown,
  providerOverride?: QueueProviderType
): IQueueBatch<T>
```

## QueueConsumer Class

The main consumer class that processes queue messages:

```typescript
class QueueConsumer {
  constructor(
    env: Env,
    queueProducer?: IQueueProducer<QueueMessage>
  )

  async processBatch(batch: IQueueBatch<QueueMessage>): Promise<void>
}
```

### Backward Compatibility

For Cloudflare Workers, a factory function maintains backward compatibility:

```typescript
// Called from Cloudflare Worker queue handler
export async function handleQueueMessage(
  batch: MessageBatch<QueueMessage>,
  env: Env
): Promise<void> {
  const consumer = new QueueConsumer(env);
  const abstractBatch = createQueueBatch<QueueMessage>(batch);
  return consumer.processBatch(abstractBatch);
}
```

## Switching Queue Providers

To switch from Cloudflare to another provider (e.g., SQS):

1. **Update constant** in `src/core/constants.ts`:
   ```typescript
   export const CURRENT_QUEUE_PROVIDER: QueueProviderType = QUEUE_PROVIDER.SQS;
   ```

2. **Implement adapter** in `src/queue/adapters/sqs.ts`:
   ```typescript
   export class SQSQueueMessage<T> implements IQueueMessage<T> {
     // Wrap SQS message
   }

   export class SQSQueueBatch<T> implements IQueueBatch<T> {
     // Wrap SQS batch
   }

   export class SQSQueueProducer<T> implements IQueueProducer<T> {
     // Use AWS SDK to send messages
   }
   ```

3. **Register adapter** in `src/queue/abstractions.ts` factory functions

4. **Update entry point** to use appropriate queue trigger (SQS Lambda trigger instead of Cloudflare Worker queue)

## Message Types

```typescript
// GitHub issue processing
interface IssueQueueMessage {
  requestId: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  // ... other fields
}

// Slack feature request
interface SlackFeatureRequestMessage {
  type: 'slack_feature_request';
  requestId: string;
  // ... Slack-specific fields
}

// Slack retry request
interface SlackRetryRequestMessage {
  type: 'slack_retry_request';
  requestId: string;
  // ... retry fields
}

type QueueMessage = IssueQueueMessage | SlackFeatureRequestMessage | SlackRetryRequestMessage;
```

## Retry Handling

Helper functions for consistent retry behavior:

```typescript
// Get retry information
const { attemptNumber, isLastAttempt } = getMessageRetryInfo(message, { maxAttempts: 3 });

// Handle retry or final failure
handleMessageRetryOrFail(message, isLastAttempt, () => {
  console.log('Final failure - max retries exceeded');
});
```

## Testing

The abstraction layer makes testing easier by allowing mock producers:

```typescript
class MockQueueProducer implements IQueueProducer<QueueMessage> {
  sentMessages: QueueMessage[] = [];

  async send(message: QueueMessage): Promise<void> {
    this.sentMessages.push(message);
  }
}

// In tests
const mockProducer = new MockQueueProducer();
const consumer = new QueueConsumer(env, mockProducer);
```

## Benefits

1. **Provider Independence**: Core consumer logic doesn't depend on specific queue implementation
2. **Easy Migration**: Switch providers by changing one constant and implementing adapter
3. **Testability**: Mock producers for unit testing without real queue infrastructure
4. **Type Safety**: Full TypeScript support with generic message types
5. **Consistency**: Uniform retry handling across all providers
