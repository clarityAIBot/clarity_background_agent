# ADR-001: Slack to Claude Code Containers Bridge for PM Feature Requests

**Status**: Implemented
**Date**: 2026-01-07
**Last Updated**: 2026-01-13
**Author**: Engineering Team

## Context

### Problem Statement

Product Managers (PMs) and non-technical stakeholders need a way to request code changes and features without:
- Learning GitHub's interface
- Understanding git workflows
- Leaving their primary communication tool (Slack)

Currently, feature requests require:
1. PM creates a GitHub Issue manually
2. Developer picks it up and implements
3. Multiple back-and-forth communications

This creates friction, delays, and dependency on developer availability for even simple changes.

### Business Drivers

- **Reduced friction**: PMs can request changes from Slack, their primary workspace
- **Faster iteration**: Direct path from idea to PR without developer handoff
- **AI-powered development**: Leverage Claude Code for autonomous feature implementation
- **Accessibility**: Lower barrier to entry for non-technical team members
- **Developer productivity**: Free up developers from routine feature requests

### Technical Context

The existing infrastructure includes:
- **Claude Code GitHub Action** (`.github/workflows/claude.yml`) for code review via `@claude` mentions
- **Cloudflare Workers API** (`apps/workers-api/`) with Hono framework for handling webhooks
- **Doppler** for secrets management across environments
- **Established webhook patterns** for Chatwoot and Typeform integrations
- **Durable Objects** for stateful operations

### Constraints

- Must work with existing Slack workspace
- Should not require additional cloud provider accounts (AWS, GCP)
- Must be secure (verify Slack requests, protect GitHub tokens)
- Must handle rate limits and long-running operations gracefully

## Decision

We will **extend [claude-code-containers](https://github.com/ghostwriternr/claude-code-containers)** to add Slack slash command support, enabling direct Slack → Claude Code → PR workflow without a separate bridge.

### Why extend claude-code-containers?

- **Single deployment**: No need for separate Cloudflare Workers infrastructure
- **Already built**: Handles Claude Code execution, issue detection, and PR creation out of the box
- **Cloudflare-native**: Already runs on Cloudflare Workers with Durable Objects
- **Sub-millisecond response**: Edge network deployment for fast webhook processing
- **Community contribution**: Benefits the broader community, not just us

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    CLARITY AI SYSTEM                                        │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                             │
│  ┌─────────────┐     /clarity-feature      ┌──────────────────────────────────────────┐    │
│  │   Slack     │─────────────────────────▶│  Cloudflare Worker                        │    │
│  │  Workspace  │                           │                                          │    │
│  │             │◀────── Modal ─────────────│  /slack/command → Opens Modal            │    │
│  │  ┌───────┐  │                           │  /slack/interactivity → Form Submit      │    │
│  │  │ Modal │  │                           │  /slack/events → Thread Replies          │    │
│  │  │ Form  │──┼── Submit ────────────────▶│                                          │    │
│  │  └───────┘  │                           │  ┌────────────────────────────────────┐  │    │
│  │             │◀── Confirmation Thread ───│  │  GitHubAppConfigDO (SQLite)        │  │    │
│  │  ┌───────┐  │                           │  │  - GitHub App credentials          │  │    │
│  │  │Thread │  │                           │  │  - Slack config (token, secret)    │  │    │
│  │  │Updates│◀─┼── Clarifications ─────────│  │  - Thread mappings                 │  │    │
│  │  │       │  │                           │  └────────────────────────────────────┘  │    │
│  │  └───────┘  │                           │                                          │    │
│  └─────────────┘                           │  ┌────────────────────────────────────┐  │    │
│                                            │  │  FeatureRequestDO (per request)    │  │    │
│  ┌─────────────┐                           │  │  - Request metadata                │  │    │
│  │   GitHub    │◀── Create Issue ──────────│  │  - Slack user/channel/thread       │  │    │
│  │             │                           │  │  - Status tracking                 │  │    │
│  │  ┌───────┐  │                           │  └────────────────────────────────────┘  │    │
│  │  │ Issue │  │                           │                                          │    │
│  │  │#123   │──┼── Webhook ───────────────▶│  /webhooks/github                        │    │
│  │  └───────┘  │                           │         │                                │    │
│  │             │                           │         ▼                                │    │
│  │  ┌───────┐  │                           │  ┌────────────────────────────────────┐  │    │
│  │  │  PR   │◀─┼── Create PR ──────────────│  │  Claude Code Container             │  │    │
│  │  │ #456  │  │                           │  │  (Durable Object with Container)   │  │    │
│  │  └───────┘  │                           │  │  - Runs Claude Code CLI            │  │    │
│  └─────────────┘                           │  │  - Clones repo, implements feature │  │    │
│                                            │  │  - Creates PR automatically        │  │    │
│                                            │  └────────────────────────────────────┘  │    │
│                                            └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### User Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                              SLACK FEATURE REQUEST FLOW                                   │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  1. USER INITIATES                    2. MODAL FORM                                      │
│  ┌─────────────────┐                  ┌─────────────────────────────┐                    │
│  │ /clarity-feature│ ───────────────▶ │ ┌─────────────────────────┐ │                    │
│  └─────────────────┘                  │ │ New Feature Request     │ │                    │
│                                       │ ├─────────────────────────┤ │                    │
│                                       │ │ Repository: [dropdown]  │ │                    │
│                                       │ │ Title: [___________]    │ │                    │
│                                       │ │ Description: [textarea] │ │                    │
│                                       │ │ Type: [Feature ▼]       │ │                    │
│                                       │ │                         │ │                    │
│                                       │ │ [Cancel]      [Submit]  │ │                    │
│                                       │ └─────────────────────────┘ │                    │
│                                       └─────────────────────────────┘                    │
│                                                     │                                    │
│                                                     ▼                                    │
│  3. CONFIRMATION POSTED               4. GITHUB ISSUE CREATED                            │
│  ┌─────────────────────────────┐      ┌─────────────────────────────┐                    │
│  │ 🚀 Feature Request Submitted│      │ ✨ Add dark mode toggle     │                    │
│  │                             │      │                             │                    │
│  │ *Add dark mode toggle*      │      │ ## Feature Request          │                    │
│  │                             │      │ **Requested by:** @user     │                    │
│  │ Repository: `my-app`        │      │ **Type:** feature           │                    │
│  │ Issue: #123                 │      │ **Tracking ID:** `fr-xxx`   │                    │
│  │                             │      │                             │                    │
│  │ _Updates in this thread_    │      │ ## Description              │                    │
│  └─────────────────────────────┘      │ User's description here...  │                    │
│              │                        └─────────────────────────────┘                    │
│              │                                                                           │
│              ▼                                                                           │
│  5. CLARIFICATION (if needed)         6. PR CREATED                                      │
│  ┌─────────────────────────────┐      ┌─────────────────────────────┐                    │
│  │ 🤔 Clarity AI needs info    │      │ 🎉 PR Created!              │                    │
│  │                             │      │                             │                    │
│  │ Before implementing:        │      │ Pull Request: #456          │                    │
│  │ - Question 1?               │      │ Branch: feature/dark-mode   │                    │
│  │ - Question 2?               │      │                             │                    │
│  │                             │      │ [View PR] [Suggest Changes] │                    │
│  │ [📝 Answer] [🔗 GitHub]     │      └─────────────────────────────┘                    │
│  └─────────────────────────────┘                  │                                      │
│                                                   ▼                                      │
│                                        7. FOLLOW-UP (optional)                           │
│                                        ┌─────────────────────────────┐                   │
│                                        │ ✏️ Suggest More Changes      │                   │
│                                        │                             │                   │
│                                        │ Describe changes...         │                   │
│                                        │ [____________]              │                   │
│                                        │                             │                   │
│                                        │ [Cancel]        [Submit]    │                   │
│                                        └─────────────────────────────┘                   │
│                                                   │                                      │
│                                                   ▼                                      │
│                                        8. PR UPDATED                                     │
│                                        ┌─────────────────────────────┐                   │
│                                        │ ✅ PR Updated!              │                   │
│                                        │                             │                   │
│                                        │ Additional changes pushed   │                   │
│                                        │ to PR #456                  │                   │
│                                        └─────────────────────────────┘                   │
│                                                                                          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Implementation Approach

#### Component 1: Fork and Extend claude-code-containers

Fork [claude-code-containers](https://github.com/ghostwriternr/claude-code-containers) and add Slack integration:

1. **Fork the repository** to our GitHub organization
2. **Add Slack router** alongside existing GitHub webhook handler
3. **Extend Durable Objects** to track Slack request metadata
4. **Add Slack notification callbacks** for PR creation events
5. **Submit PR upstream** to contribute back to the community

#### Component 2: Slack App Integration

**Slash Command**: `/claude-feature`
```
/claude-feature [repo] [description]
/claude-feature supernova-app Add dark mode toggle to settings page
```

**Slack App Configuration**:
- Request URL pointing to Cloudflare Workers endpoint
- OAuth scopes: `commands`, `chat:write`, `users:read`
- Signing secret for request verification

#### Component 3: Slack Router (to be added to claude-code-containers)

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'crypto';

const SlackCommandSchema = z.object({
  token: z.string(),
  team_id: z.string(),
  team_domain: z.string(),
  channel_id: z.string(),
  channel_name: z.string(),
  user_id: z.string(),
  user_name: z.string(),
  command: z.string(),
  text: z.string(),
  response_url: z.string(),
  trigger_id: z.string(),
});

export const slackRouter = new Hono()
  .post('/commands/feature', async (c) => {
    // 1. Verify Slack signature
    const signature = c.req.header('x-slack-signature');
    const timestamp = c.req.header('x-slack-request-timestamp');
    const body = await c.req.text();

    if (!verifySlackSignature(signature, timestamp, body, c.env.SLACK_SIGNING_SECRET)) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    // 2. Parse and validate command
    const params = new URLSearchParams(body);
    const command = SlackCommandSchema.parse(Object.fromEntries(params));

    // 3. Parse feature request: "[repo] [description]"
    const [repo, ...descParts] = command.text.split(' ');
    const description = descParts.join(' ');

    // 4. Create tracking record in Durable Object
    const requestId = crypto.randomUUID();
    const tracker = c.env.FEATURE_REQUEST_DO.get(
      c.env.FEATURE_REQUEST_DO.idFromName(requestId)
    );

    await tracker.fetch('/init', {
      method: 'POST',
      body: JSON.stringify({
        requestId,
        repo,
        description,
        slackUserId: command.user_id,
        slackChannelId: command.channel_id,
        responseUrl: command.response_url,
        status: 'pending',
      }),
    });

    // 5. Create GitHub Issue (claude-code-containers will pick it up automatically)
    const issue = await createGitHubIssue(c.env, {
      repo,
      title: `[Slack Feature Request] ${description.slice(0, 50)}...`,
      body: `## Feature Request from Slack

**Requested by:** ${command.user_name}
**Tracking ID:** \`${requestId}\`

## Description

${description}

## Requirements

- Follow existing code patterns and conventions
- Add appropriate tests
- Document any significant changes

---
*This issue was automatically created via Slack slash command.*
*claude-code-containers will automatically implement this and create a PR.*`,
      labels: ['slack-feature-request', 'claude-code'],
    });

    // 6. Update tracker with issue URL
    await tracker.fetch('/update', {
      method: 'POST',
      body: JSON.stringify({ issueUrl: issue.html_url, issueNumber: issue.number }),
    });

    // 7. Immediate acknowledgment to Slack
    return c.json({
      response_type: 'in_channel',
      text: `Feature request received! Tracking ID: \`${requestId}\`\n` +
            `Repository: \`${repo}\`\n` +
            `Description: ${description}\n\n` +
            `GitHub Issue: ${issue.html_url}\n` +
            `Claude Code is analyzing your request and will create a PR automatically...`,
    });
  })

  .post('/webhook/github', async (c) => {
    // Handle GitHub webhooks for PR creation notifications
    const payload = await c.req.json();

    // Check if this is a PR that references our tracking issue
    if (payload.action === 'opened' && payload.pull_request) {
      const prBody = payload.pull_request.body || '';
      const trackingIdMatch = prBody.match(/Tracking ID: `([^`]+)`/);

      if (trackingIdMatch) {
        const requestId = trackingIdMatch[1];
        const tracker = c.env.FEATURE_REQUEST_DO.get(
          c.env.FEATURE_REQUEST_DO.idFromName(requestId)
        );
        const state = await tracker.fetch('/state').then(r => r.json());

        // Notify Slack that PR was created
        if (state.responseUrl) {
          await fetch(state.responseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              response_type: 'in_channel',
              text: `🎉 PR created for your feature request!\n` +
                    `Pull Request: ${payload.pull_request.html_url}\n` +
                    `Tracking ID: \`${requestId}\``,
            }),
          });
        }
      }
    }

    return c.json({ success: true });
  });

async function createGitHubIssue(env: Env, options: {
  repo: string;
  title: string;
  body: string;
  labels: string[];
}) {
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_ORG}/${options.repo}/issues`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: options.title,
        body: options.body,
        labels: options.labels,
      }),
    }
  );
  return response.json();
}
```

#### Component 4: Extended Durable Object for Slack Tracking

Extend the existing Durable Object in claude-code-containers to track Slack metadata:

```typescript
// Extend existing DO to include Slack fields
export class FeatureRequestDO implements DurableObject {
  private state: DurableObjectState;
  private data: FeatureRequest | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case '/init':
        this.data = await request.json();
        await this.state.storage.put('data', this.data);
        return new Response(JSON.stringify({ success: true }));

      case '/state':
        this.data = await this.state.storage.get('data');
        return new Response(JSON.stringify(this.data));

      case '/update':
        const update = await request.json();
        this.data = { ...this.data, ...update };
        await this.state.storage.put('data', this.data);
        return new Response(JSON.stringify({ success: true }));

      default:
        return new Response('Not found', { status: 404 });
    }
  }
}
```

#### Component 5: Security Implementation

**Slack Request Verification**:
```typescript
function verifySlackSignature(
  signature: string,
  timestamp: string,
  body: string,
  signingSecret: string
): boolean {
  // Prevent replay attacks (requests older than 5 minutes)
  const time = Math.floor(Date.now() / 1000);
  if (Math.abs(time - parseInt(timestamp)) > 300) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(sigBasestring)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(mySignature),
    Buffer.from(signature)
  );
}
```

**GitHub Token Management**:
- Use GitHub App installation tokens (auto-refreshing)
- Store tokens in Doppler
- Scope tokens to minimum required permissions (issues:write)

## Consequences

### Positive

- **Democratized development**: PMs can request features without GitHub knowledge
- **Faster feedback loops**: Direct path from idea to implementation
- **Simpler architecture**: Leverages existing claude-code-containers instead of custom GitHub Actions
- **Consistent infrastructure**: Uses existing Cloudflare Workers patterns
- **Auditability**: All requests tracked in Durable Objects
- **Scalability**: Cloudflare Workers handle concurrent requests efficiently
- **Cost efficiency**: No additional cloud provider costs
- **One-click deployment**: claude-code-containers provides ready-to-use infrastructure

### Negative

- **External dependency**: Relies on claude-code-containers project
- **Trust boundary**: PMs can trigger code generation (mitigated by PR review)
- **Learning curve**: Team needs to understand the slash command syntax

### Neutral

- **Slack dependency**: Ties workflow to Slack availability
- **Async nature**: Feature requests are not immediate (expected behavior)
- **Review requirement**: All Claude-generated code still requires human review

## Alternatives Considered

### Option 1: Custom GitHub Actions Workflow (Not Selected)

Build custom GitHub Actions workflows to run Claude Code on `repository_dispatch` events.

**Pros:**
- Full control over the workflow
- No external dependencies
- Native GitHub integration

**Cons:**
- More code to write and maintain
- Need to handle Claude Code execution, error handling, PR creation
- GitHub Actions usage limits to consider
- More complex architecture

### Option 2: Dedicated Backend Service (AWS Lambda / GCP Cloud Functions)

Deploy a standalone service on AWS or GCP to handle the integration.

**Pros:**
- More compute options
- Familiar deployment patterns

**Cons:**
- Additional cloud provider costs
- More infrastructure to manage
- Doesn't leverage existing Cloudflare Workers setup
- Separate secrets management

### Option 3: GitHub App with Direct Webhook

Build a GitHub App that handles Slack integration directly.

**Pros:**
- Native GitHub integration
- Better token management

**Cons:**
- More complex to build and maintain
- Requires hosting the GitHub App
- Overkill for the use case

## Implementation Plan

### Phase 1: Fork and Deploy claude-code-containers
1. Fork [claude-code-containers](https://github.com/ghostwriternr/claude-code-containers) to your org
2. Deploy to Cloudflare and test existing GitHub issue → PR flow
3. Configure GitHub App with repository access
4. Add Anthropic API key to Cloudflare secrets

### Phase 2: Add Slack Integration to Fork
1. Add Slack router to handle `/claude-feature` slash command
2. Extend Durable Objects to track Slack metadata (user, channel, response_url)
3. Add Slack signature verification
4. Implement Slack callback notifications when PRs are created
5. Create Slack App with slash command configuration

### Phase 3: Test & Contribute Back
1. Test end-to-end Slack → Claude Code → PR flow
2. Add error handling and retry logic
3. Implement Slack Block Kit for rich messages
4. Submit PR upstream to claude-code-containers repository
5. Deploy to production with monitoring

### Phase 4: Enhancements (Future)
1. Modal dialog for complex feature requests
2. Repository selection dropdown
3. Feature templates
4. Integration with project management tools

## References

- [claude-code-containers](https://github.com/ghostwriternr/claude-code-containers) - Containerized Claude Code for automatic issue-to-PR
- [Slack Slash Commands Documentation](https://api.slack.com/interactivity/slash-commands)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [GitHub Issues API](https://docs.github.com/en/rest/issues/issues)

## Implementation Status

### Completed
- [x] Initial setup of Cloudflare Worker with Containers and Durable Objects
- [x] Deploy to Cloudflare Workers
- [x] Add token-based authentication for setup routes (`/claude-setup`, `/gh-setup`)
- [x] Update dependencies to latest versions (@cloudflare/containers 0.0.30, wrangler 4.56.0)
- [x] GitHub App integration setup page ready
- [x] Set up SETUP_SECRET via `wrangler secret put SETUP_SECRET`
- [x] Configure Anthropic API key via `/claude-setup`
- [x] Create GitHub App via `/gh-setup`
- [x] Add Slack router to fork (`/slack/command` endpoint)
- [x] Extend Durable Objects for Slack metadata (`FeatureRequestDO` with SQLite)
- [x] Slack notification callbacks for PR events (`handleSlackPRNotification`)
- [x] **Interactive Slack Modal** - `/clarity-feature` opens a rich modal form instead of plain text input
- [x] **Slack Interactivity Endpoint** - `/slack/interactivity` handles modal submissions and button clicks
- [x] **Slack Events Endpoint** - `/slack/events` handles thread replies for clarification responses
- [x] **Clarification Flow with Interactive Buttons** - Users can respond via modal form, thread reply, or GitHub
- [x] **Confirmation Message Thread** - Posts confirmation to Slack channel when form submitted, all updates go to thread
- [x] **Multi-method Authentication** - Token accepted via query param, `Authorization: Bearer`, or `X-Setup-Token` header
- [x] **Interactive Dashboard Home Page** - Token storage in localStorage, live status checks for all integrations
- [x] **Combined Status Endpoint** - `/gh-status` returns GitHub, Claude, and Slack configuration status
- [x] **Slack App Manifest Generator** - Auto-generates manifest with all endpoints for easy app creation
- [x] **Dockerfile Fix** - Copy prompt files to dist directory for container deployment
- [x] **Container Timeout Increase** - Increased from 5 to 15 minutes for complex Claude Code tasks
- [x] **Claude Code Debug Logging** - Per-turn logging for tool calls, elapsed time, and progress tracking
- [x] **Retry Mechanism (GitHub)** - Add `clarity-ai-retry` label to retry failed processing
- [x] **Retry Mechanism (Slack)** - Retry button in error notifications
- [x] **Cost & Duration Tracking** - Display API cost and processing time in PR notifications
- [x] **Suggest More Changes (Follow-up Feature)** - Button to request additional changes to existing PR
- [x] **Follow-up PR Branch Checkout** - Clone existing PR branch for follow-up requests
- [x] **Follow-up Commit to Existing PR** - Push follow-up changes to same branch/PR
- [x] **Follow-up Prompt Template** - Dedicated prompt for follow-up change requests

### In Progress
- [ ] Production deployment and monitoring
- [ ] End-to-end testing with Slack workspace

### Not Started
- [ ] Per-request cost breakdown in dashboard

## Notes

### Security Considerations

1. **Request Verification**: All Slack requests must be verified using HMAC signatures
2. **Token Rotation**: GitHub tokens should be short-lived and auto-refreshed
3. **Rate Limiting**: Implement rate limits per user/team to prevent abuse
4. **Audit Logging**: Log all feature requests for compliance and debugging

### Future Enhancements

1. ~~**Interactive Modals**: Use Slack Block Kit for richer input forms~~ ✅ IMPLEMENTED
2. ~~**Repository Discovery**: Auto-suggest repositories based on user permissions~~ ✅ IMPLEMENTED (repos from GitHub App installation)
3. **Template Library**: Pre-defined feature templates for common requests
4. **Priority Queue**: Handle urgent requests with higher priority
5. **Cost Tracking**: Monitor Claude API usage per request

### Implemented Features (2026-01-13)

#### Follow-up Changes Feature
The "Suggest More Changes" button enables iterative refinement of PRs:

**Flow:**
1. After a PR is created, user clicks "Suggest More Changes" button in Slack
2. Modal opens for user to describe additional changes needed
3. System queues request with follow-up context (existing PR number, branch name)
4. Container clones the existing PR branch (not default branch)
5. Claude Code makes the requested changes
6. Changes are committed and pushed to the same PR branch
7. Slack notification shows "PR Updated" instead of "PR Created"

**Key Implementation Details:**
- `setupWorkspace()` accepts optional `prBranchName` to clone specific branch
- `commitAndPushToExistingBranch()` commits without creating new branch
- `prepareFollowUpPrompt()` uses dedicated prompt template for follow-ups
- `handleSlackPRNotification()` distinguishes between new PR and follow-up
- Follow-up requests can be repeated indefinitely - each push updates the same PR

**Files Modified:**
- `container_src/src/main.ts` - Branch checkout, commit logic, prompt handling
- `container_src/src/github_client.ts` - `getPullRequest()` method
- `container_src/src/prompts/follow_up_processor.md` - Follow-up prompt template
- `src/handlers/slack_interactivity.ts` - Modal handler, queue follow-up
- `src/handlers/slack.ts` - PR notification with isFollowUp flag
- `src/handlers/queue_consumer.ts` - Pass follow-up fields to container

### Implemented Features (2026-01-08)

#### Slack Interactive Components
- **Modal Form**: `/clarity-feature` command opens a rich modal with:
  - Repository dropdown (populated from GitHub App installation)
  - Feature title input
  - Description textarea
  - Request type selector (Feature, Bug Fix, Refactor, Documentation)
- **Confirmation Thread**: When form is submitted, posts a confirmation message to the channel
  - All subsequent updates (clarifications, PR creation) are posted as thread replies
  - Thread mapping stored in Durable Objects for tracking
- **Clarification Buttons**: When AI needs more info, presents interactive buttons:
  - "Answer in Form" - Opens a modal to answer questions
  - "Reply in Thread" - User can reply naturally in the Slack thread
  - "Go to GitHub Issue" - Direct link to the GitHub issue

#### Authentication Enhancements
- **Multi-method Token Authentication**: Accepts setup token via:
  - Query parameter: `?token=YOUR_SECRET`
  - Authorization header: `Bearer YOUR_SECRET`
  - Custom header: `X-Setup-Token: YOUR_SECRET`
- **Interactive Dashboard**: Home page includes:
  - Token input with localStorage persistence
  - Live status indicators for Claude, GitHub, and Slack integrations
  - Clickable endpoint URLs with copy buttons

#### API Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Interactive dashboard with status checks |
| `/slack/command` | POST | Handles `/clarity-feature` slash command |
| `/slack/interactivity` | POST | Handles modal submissions and button clicks |
| `/slack/events` | POST | Handles thread replies for clarifications |
| `/slack-setup` | GET | Slack app setup wizard with manifest generator |
| `/slack-setup/callback` | POST | Saves Slack credentials |
| `/gh-status` | GET | Combined status for GitHub, Claude, and Slack |
| `/webhooks/github` | POST | GitHub webhook receiver |

#### Slack App Manifest
Auto-generated manifest includes:
- Slash command: `/clarity-feature`
- Event subscriptions: `message.channels`, `message.groups`, `message.im`
- Interactivity enabled with request URL
- OAuth scopes: `chat:write`, `chat:write.public`, `commands`, `channels:history`, `groups:history`, `im:history`

### Setup Flow

#### Initial Deployment
```bash
# 1. Clone and deploy
cd clarity_ai
npm install
wrangler deploy

# 2. Set the setup secret
wrangler secret put SETUP_SECRET
# Enter a strong secret token

# 3. Access the dashboard
# Open https://your-worker.workers.dev
# Enter your SETUP_SECRET token
```

#### Integration Setup Order
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SETUP SEQUENCE                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  STEP 1: Claude API                                                         │
│  ┌─────────────────┐                                                        │
│  │ /claude-setup   │ → Enter Anthropic API Key → Stored in Durable Object   │
│  └─────────────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  STEP 2: GitHub App                                                         │
│  ┌─────────────────┐                                                        │
│  │ /gh-setup       │ → Create GitHub App → Install on repos → Webhook auto  │
│  └─────────────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  STEP 3: Slack App                                                          │
│  ┌─────────────────┐                                                        │
│  │ /slack-setup    │ → Copy manifest → Create Slack App → Enter credentials │
│  └─────────────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  STEP 4: Verify                                                             │
│  ┌─────────────────┐                                                        │
│  │ Dashboard (/)   │ → All status badges should show "Connected"            │
│  └─────────────────┘                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Slack App Setup Steps
1. Go to `/slack-setup` page
2. Copy the auto-generated JSON manifest
3. Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From Manifest
4. Paste the manifest and create the app
5. Install to your workspace
6. Copy **Signing Secret** from Basic Information
7. Copy **Bot User OAuth Token** from OAuth & Permissions
8. Enter credentials in the `/slack-setup` form
9. Test with `/clarity-feature` in Slack

#### File Structure
```
clarity_ai/
├── src/
│   ├── index.ts                    # Main worker, routes, home page
│   ├── auth.ts                     # Multi-method token authentication
│   ├── log.ts                      # Structured logging
│   ├── fetch.ts                    # Container fetch with timeout (15 min)
│   ├── github_client.ts            # GitHub API wrapper (Worker side)
│   ├── handlers/
│   │   ├── slack.ts                # /slack/command, PR notifications
│   │   ├── slack_interactivity.ts  # Modal submissions, button clicks, retry, follow-up
│   │   ├── slack_events.ts         # Thread reply handler
│   │   ├── slack_setup.ts          # Setup wizard with manifest
│   │   ├── slack_oauth_callback.ts # Credential storage
│   │   ├── github_webhook.ts       # GitHub event router
│   │   ├── github_webhooks/
│   │   │   └── issue.ts            # Issue event handler (retry label support)
│   │   ├── github_status.ts        # Combined status endpoint
│   │   ├── github_setup.ts         # GitHub App creation wizard
│   │   ├── claude_setup.ts         # API key configuration
│   │   └── queue_consumer.ts       # Issue processing queue (follow-up support)
│   └── durable_objects/
│       └── feature_request.ts      # Per-request state tracking
├── container_src/
│   └── src/
│       ├── main.ts                 # Container entry, Claude Code, git operations
│       ├── github_client.ts        # GitHub API wrapper (Container side)
│       └── prompts/
│           ├── issue_processor.md      # Main feature analysis prompt
│           └── follow_up_processor.md  # Follow-up changes prompt
├── Dockerfile                      # Container build config
├── wrangler.toml                   # Cloudflare configuration
└── docs/
    └── adr/
        └── ADR-001-slack-to-github-actions-bridge.md
```
