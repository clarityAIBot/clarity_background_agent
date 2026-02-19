# ADR-002: Slack @Mention Trigger for Clarity AI

## Status
Implemented (Phase 1)

## Date
2026-01-17

## Context

Currently, Clarity AI is triggered via:
1. **GitHub Issues** - Adding `clarity-ai` label to an issue
2. **Slack Feature Requests** - Using a specific message format with emoji reactions

Cursor has implemented a more streamlined Slack integration where users can simply mention `@cursor` in any message or thread to trigger an AI agent. This provides a more natural interaction pattern.

### Cursor's Approach

```
@Cursor [repo=owner/repo, branch=main, model=...] Fix the login bug
```

Key features:
- **Thread context**: Agent reads entire thread for context
- **Inline options**: Repository, branch, model can be specified inline
- **Follow-ups**: Mention `@cursor` again in the same thread
- **Status reactions**: ⏳ (running), ✅ (completed), ❌ (failed)
- **Multi-agent**: Multiple agents can run in the same thread

### Current Clarity AI Limitations

1. **Rigid trigger format**: Requires specific Slack message structure
2. **No inline options**: Configuration is done via GitHub labels
3. **Limited thread context**: Only reads direct replies
4. **Single agent per request**: Can't have multiple agents in a thread

## Decision

Implement **Slack @Mention Trigger** for Clarity AI, allowing users to invoke the AI by mentioning `@clarity` (or configured bot name) in any Slack message.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ SLACK EVENT: app_mention                                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. User mentions @clarity in Slack:                                │
│     "@clarity [repo=speak] add share button to lesson complete"     │
│                                                                     │
│  2. Slack sends app_mention event to /api/slack/events             │
│                                                                     │
│  3. Parse message for:                                              │
│     - Options: [repo=..., branch=..., model=...]                   │
│     - Prompt: Everything after options                              │
│                                                                     │
│  4. Fetch thread context (if in thread):                            │
│     - Get all messages in thread via conversations.replies         │
│     - Include as context for the agent                              │
│                                                                     │
│  5. Add reaction ⏳ to indicate processing started                  │
│                                                                     │
│  6. Queue the request (same as current flow)                        │
│                                                                     │
│  7. On completion:                                                  │
│     - Remove ⏳, add ✅ or ❌                                        │
│     - Reply in thread with PR link or error                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Message Format

```
@clarity [options] prompt

Options (all optional, comma-separated inside brackets):
  repo=owner/repo     Target repository (default: system default from Settings)
  branch=main         Base branch (default: repo's default branch)
  type=feature        Request type: feature, bug, refactor, docs, question
  model=opus          AI model to use (future)

Examples:
  @clarity fix the login bug
  @clarity [repo=speak] add dark mode
  @clarity [repo=speak, type=bug] fix crash on startup
  @clarity [repo=supernova-app/speak] refactor auth module

Special Commands:
  @clarity help              Show usage instructions and available options
  @clarity agent <prompt>    Force creation of a new agent (skip follow-up routing)
```

### Repository Resolution Priority

When no `repo` option is specified inline, the repository is resolved in this order:

1. **Inline option**: `@clarity [repo=myrepo] ...` takes highest priority
2. **System default**: Configured in Settings → Default Repository
3. **Single repo fallback**: If only one repository is available, use it
4. **Prompt user**: Ask the user to specify a repository

### Thread Context

When invoked in a thread, Clarity AI will:
1. Fetch all messages in the thread using `conversations.replies`
2. Format messages as conversation context
3. Include in the agent prompt

```typescript
// Example thread context
const threadMessages = await slack.conversations.replies({
  channel: channelId,
  ts: threadTs,
  limit: 100 // Configurable
});

const context = threadMessages.messages
  .map(m => `**${m.user}**: ${m.text}`)
  .join('\n\n');
```

### Follow-up Handling

In threads with existing Clarity AI agents:
- `@clarity [prompt]` adds follow-up instructions to the existing agent
- `@clarity agent [prompt]` forces creation of a new agent

Detection logic:
```typescript
// Check if thread already has a Clarity AI agent
const existingAgent = await findAgentInThread(channelId, threadTs);

if (existingAgent && !forceNewAgent) {
  // Add follow-up to existing agent
  await queueFollowUp(existingAgent.requestId, prompt);
} else {
  // Create new agent
  await createNewAgent(channelId, threadTs, prompt, options);
}
```

### Status Reactions

| Reaction | Meaning |
|----------|---------|
| ⏳ `:hourglass_flowing_sand:` | Agent is running |
| ✅ `:white_check_mark:` | Agent completed successfully |
| ❌ `:x:` | Agent failed |
| ❓ `:question:` | Agent needs clarification |

Implementation:
```typescript
// Add reaction when starting
await slack.reactions.add({
  channel: channelId,
  timestamp: messageTs,
  name: 'hourglass_flowing_sand'
});

// On completion, remove and add appropriate reaction
await slack.reactions.remove({
  channel: channelId,
  timestamp: messageTs,
  name: 'hourglass_flowing_sand'
});

await slack.reactions.add({
  channel: channelId,
  timestamp: messageTs,
  name: isSuccess ? 'white_check_mark' : 'x'
});
```

## Implementation Plan

### Phase 1: Basic @Mention Trigger ✅ IMPLEMENTED

**Files created/modified:**

1. **`src/slack/parser.ts`** - Parse @mention commands (NEW FILE)

```typescript
// Parser for @clarity [options] prompt format
export function parseClarityCommand(text: string): ClarityCommand {
  // Remove @clarity mention (Slack format: <@U12345678>)
  const withoutMention = text.replace(/<@[A-Z0-9]+>/gi, '').trim();

  // Extract bracketed options [key=value, ...]
  const optionsMatch = withoutMention.match(/^\[(.*?)\]/);
  // ... parse options and prompt
}

export function resolveRepository(repoInput, availableRepos): string | undefined
export function extractTitle(prompt, maxLength): string
```

2. **`src/handlers/slack_events.ts`** - Added `app_mention` event handler

```typescript
// Handler for app_mention events
async function handleAppMention(event: any, env: Env): Promise<Response> {
  const { text, channel, ts, thread_ts, user } = event;

  // Parse command: @clarity [options] prompt
  const { options, prompt } = parseClarityCommand(text);

  // Resolve repository: inline > system default > single repo
  const repo = options.repo
    || systemDefaultsConfig?.defaultRepository
    || (availableRepos.length === 1 ? availableRepos[0] : undefined);

  // Add ⏳ reaction and queue request
  await addSlackReaction(botToken, channel, ts, 'hourglass_flowing_sand');
  await env.ISSUE_QUEUE.send({ type: 'slack_feature_request', ... });
}
```

3. **System Defaults Integration** - Uses existing `system_defaults` config table

The implementation uses the existing `systemDefaultsConfig` from PostgreSQL:
- `defaultRepository`: Used when no repo specified inline
- `defaultAgentType`: claude-code or opencode
- `defaultAgentProvider`: anthropic, openai, google, etc.

### Phase 2: Thread Context ✅ IMPLEMENTED

When `@clarity` is mentioned in a thread, the system now:
1. **Fetches thread messages** using `conversations.replies` API
2. **Formats as context** excluding bot messages and the current mention
3. **Includes in prompt** as a "Thread Context" section before the request

**Implementation in `src/handlers/slack_events.ts`:**

```typescript
async function getThreadContext(
  channelId: string,
  threadTs: string,
  botToken: string,
  limit: number = 50
): Promise<string | null> {
  const response = await fetch(
    `https://slack.com/api/conversations.replies?channel=${channelId}&ts=${threadTs}&limit=${limit}`,
    { headers: { Authorization: `Bearer ${botToken}` } }
  );

  const data = await response.json();
  if (!data.ok || !data.messages?.length) return null;

  // Format messages, excluding bot messages and current mention
  const contextMessages = data.messages
    .slice(0, -1) // Exclude current mention
    .filter((m: any) => !m.bot_id)
    .map((m: any) => `<@${m.user}>: ${m.text}`);

  return contextMessages.length > 0 ? contextMessages.join('\n\n') : null;
}

// In handleAppMention:
if (thread_ts) {
  threadContext = await getThreadContext(channel, thread_ts, botToken);
}

// Build description with context
let fullDescription = prompt;
if (threadContext) {
  fullDescription = `## Thread Context\n\n${threadContext}\n\n---\n\n## Request\n\n${prompt}`;
}
```

### Phase 3: Follow-up in Threads ✅ IMPLEMENTED

When `@clarity` is mentioned in a thread that already has an active agent (status: processing, awaiting_clarification, or pending), the system now:

1. **Detects existing agents** using `findActiveAgentInThread()` method
2. **Routes to follow-up** by adding follow-up instructions to the existing request
3. **Forces new agent** when user specifies `@clarity agent <prompt>` keyword

**Implementation in `src/handlers/slack_events.ts`:**

```typescript
// Check for existing active agent in thread (for follow-up handling)
if (thread_ts && !forceNewAgent) {
  const existingAgent = await requestService.findActiveAgentInThread(channel, thread_ts);

  if (existingAgent) {
    // Log the follow-up request
    await requestService.addFollowUpRequest(
      existingAgent.requestId,
      prompt,
      { id: user, name: user },
      "slack",
      { channelId: channel, threadTs: thread_ts, messageTs: ts }
    );

    // Re-queue with follow-up information
    await env.ISSUE_QUEUE.send({
      ...existingAgent,
      isFollowUp: true,
      followUpRequest: prompt,
      followUpAuthor: user,
    });

    return new Response("OK", { status: 200 });
  }
}
```

**Parser support in `src/slack/parser.ts`:**

```typescript
// Check for "agent" keyword to force new agent creation
let forceNewAgent = false;
if (prompt.toLowerCase().startsWith('agent ')) {
  forceNewAgent = true;
  prompt = prompt.slice(6).trim();
}
```

**Database method in `src/db/repositories/feature-request.ts`:**

```typescript
async findActiveAgentInThread(channelId: string, threadTs: string): Promise<FeatureRequest | null> {
  const result = await this.db.query.featureRequests.findFirst({
    where: and(
      eq(featureRequests.slackChannelId, channelId),
      eq(featureRequests.slackThreadTs, threadTs),
      sql`${featureRequests.status} IN ('processing', 'awaiting_clarification', 'pending')`
    ),
    orderBy: [desc(featureRequests.createdAt)],
  });
  return result ?? null;
}

### Phase 4: Channel Settings (DEFERRED)

Channel-specific settings are deferred in favor of system-wide defaults:
- System defaults in Settings page already provide default repository
- Channel-specific overrides can be added later if needed

## Database Schema

```sql
-- New table for channel settings
CREATE TABLE slack_channel_settings (
  id SERIAL PRIMARY KEY,
  channel_id TEXT NOT NULL UNIQUE,
  default_repo TEXT,           -- e.g., 'supernova-app/speak'
  default_branch TEXT,         -- e.g., 'main'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for quick lookup
CREATE INDEX idx_channel_settings_channel_id ON slack_channel_settings(channel_id);

-- Add trigger message tracking to feature_requests
ALTER TABLE feature_requests
ADD COLUMN trigger_message_ts TEXT,
ADD COLUMN trigger_channel_id TEXT;
```

## Slack App Configuration

Add required scopes to the Slack app:

```yaml
# Additional OAuth scopes needed
oauth_scopes:
  - app_mentions:read      # Detect @mentions
  - reactions:read         # Read reactions (for status)
  - reactions:write        # Add/remove status reactions
  - channels:history       # Read thread context in public channels
  - groups:history         # Read thread context in private channels
  - im:history             # Read DM history for context
  - mpim:history           # Read group DM history

# Event subscriptions
events:
  - app_mention            # When @clarity is mentioned
```

## Consequences

### Positive

1. **Natural interaction**: Users can invoke AI with simple @mention
2. **Thread context**: AI understands the conversation context
3. **Inline options**: No need to switch to GitHub for configuration
4. **Status visibility**: Emoji reactions provide clear status
5. **Follow-up friendly**: Easy to add instructions to running agents

### Negative

1. **More Slack API calls**: Thread context requires additional API calls
2. **Rate limiting**: Need to handle Slack rate limits carefully
3. **Permission complexity**: More OAuth scopes needed
4. **Migration**: Existing users need to re-authorize Slack app

### Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Rate limiting | Implement exponential backoff, cache thread context |
| Permission scope creep | Request only necessary scopes, document clearly |
| Thread context too large | Limit to last 50 messages, summarize if needed |
| Ambiguous commands | Provide clear error messages, help command |

## Alternatives Considered

### Alternative 1: Slash Commands

Use `/clarity [prompt]` instead of @mentions.

**Pros**:
- Simpler parsing
- No thread context by default

**Cons**:
- Less natural interaction
- Can't be used mid-conversation
- Slash commands don't work in threads as naturally

### Alternative 2: Emoji Trigger

React with specific emoji (e.g., 🤖) to trigger on a message.

**Pros**:
- Works on any message
- No typing required

**Cons**:
- Less control over options
- Can't easily specify repository
- Accidental triggers

## References

- [Cursor Slack Integration](https://docs.cursor.com/integrations/slack)
- [Slack Events API](https://api.slack.com/events)
- [Slack Conversations API](https://api.slack.com/methods/conversations.replies)
- [Current Clarity AI Slack Handler](../src/handlers/slack.ts)
