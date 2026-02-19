# Why We Built Clarity AI: An Open-Source Background Coding Agent

*Febin Sathar -- February 2026*

We built Clarity AI, an open-source background coding agent that turns GitHub issues and Slack messages into Pull Requests. Describe what you want -- a feature, a bug fix, a refactor -- and Clarity clones your repo, spins up Claude Code in a sandboxed container, writes the code, and opens a PR. No local checkout required. No laptop needed.

We open-sourced the whole thing: [github.com/clarityAIBot/clarity_background_agent](https://github.com/clarityAIBot/clarity_background_agent)

## The Problem

Every team has a backlog of "this should be simple" tasks that never get done. Small bug fixes, documentation updates, minor refactors. They sit in the issue tracker because nobody wants to context-switch away from their current work to clone a repo, set up a branch, make the change, push, and open a PR.

We wanted an agent that could pick up these tasks autonomously -- triggered from the tools we already use (GitHub and Slack) -- without requiring anyone to babysit a terminal.

## How It Works

The architecture is straightforward:

```
Slack / GitHub Issue
        |
        v
  Cloudflare Worker (Hono router)
        |
        ├── GitHub Webhook Handler
        ├── Slack Command Handler
        └── Queue Producer
                |
                v
        Cloudflare Queue
                |
                v
        Queue Consumer
                |
                v
        Cloudflare Container (Docker)
          ├── Claude Code SDK
          ├── Git clone + branch
          └── Create PR
```

A request comes in from a GitHub issue (labeled `clarity-ai`) or a Slack command. The worker validates it, stores the request in PostgreSQL, and drops a message on a Cloudflare Queue. The queue consumer picks it up and dispatches it to a sandboxed Docker container running the Claude Code SDK. The container clones the repo, lets Claude Code do its thing, commits the changes, pushes, and opens a PR.

The entire infrastructure runs on Cloudflare Workers, Containers, and Queues. No VMs to manage. No Kubernetes. The container sleeps after 15 minutes of inactivity and wakes up on the next request.

## The Container

Each coding session runs in an isolated Docker container built from `node:22-slim` with Python 3, Git, and the Claude Code SDK. The container exposes a single endpoint: `POST /process-issue`.

When a request arrives, the container:

1. Shallow-clones the target repository into `/tmp/workspace/`
2. Loads any configured Skills (reusable prompt patterns)
3. Downloads Slack file attachments into `.clarity-attachments/` if the user attached screenshots or mockups
4. Builds a prompt from the issue context and conversation history
5. Runs Claude Code with `permissionMode: 'bypassPermissions'` -- the agent has full access to read, write, edit, run bash, search the web, and use tools
6. Checks the workspace for changes

If there are code changes, it commits, pushes to a `clarity-ai/issue-{id}` branch, and opens a PR. If the changes are documentation-only, it posts the content as a GitHub comment instead. If the agent determines it needs more information, it writes clarifying questions and sends them back to the user.

The container doesn't install the Claude Code CLI. It uses the `@anthropic-ai/claude-agent-sdk` programmatically via the `query()` function, streaming messages in real-time. This gives us full control over the session lifecycle -- we capture the transcript, compress it, and store it for later resumption.

## Session Persistence

This was one of the trickier design decisions. When a user asks for follow-up changes to an existing PR, the agent needs the full context of what it did before. Without it, it's starting from scratch every time.

Our solution: after every execution, we capture the SDK's JSONL session transcript, gzip it (typically 60-80% compression), base64-encode it, and store it in PostgreSQL. When a follow-up request comes in, the container downloads the session blob via a signed URL and passes `resume: sessionId` to the SDK. The agent picks up right where it left off, with full memory of the previous conversation.

This means you can iteratively refine a PR across multiple rounds without losing context. The agent remembers what files it changed, what approaches it tried, and what the user said.

## Slack-First Workflow

We believe the fastest way to get adoption is to meet people where they already work. For us, that's Slack.

**`@clarity` mentions**: Tag the bot in any channel or thread with a description of what you want. It parses the message, figures out which repository to work in, and kicks off a session. If you're in a thread, it pulls in the full thread context (up to 50 messages) so the agent understands the conversation.

**`/clarity-feature` slash command**: Opens a modal where you pick a repo, select the request type (feature, bug, refactor, docs), choose an agent, and describe the work. The bot creates a GitHub issue, queues the work, and posts a confirmation.

**Real-time progress**: As the agent works, it sends progress updates to your Slack thread -- which files it's reading, what tools it's using, when it's running tests. When it's done, you get a rich Block Kit message with the PR link, a summary, cost, duration, and action buttons.

**Follow-ups in-thread**: Reply to the bot's message with `@clarity make the button blue instead` and it'll push changes to the same PR branch. No new issue needed. The session resumes with full context.

**Clarification flow**: If the agent isn't sure what you want, it posts clarifying questions with an interactive "Answer Questions" button. You answer in a modal, and it continues with your input.

We added emoji reactions too: hourglass when it's working, checkmark when it succeeds, X when it fails. Small touches, but they make it feel alive.

## Multi-LLM Support

Clarity isn't locked to a single model provider. We implemented a Strategy Pattern with two agent backends:

**Claude Code Strategy**: Uses the `@anthropic-ai/claude-agent-sdk` with session persistence, Skills support, and tool streaming. This is our primary and most capable backend.

**OpenCode Strategy**: Uses the `@opencode-ai/sdk` for providers beyond Anthropic -- OpenAI, Google, Groq, DeepSeek, Mistral, Together AI, and Fireworks. Real-time event streaming. No session persistence yet.

You select the agent via GitHub issue labels (`clarity-ai-opencode-openai`, etc.), Slack modal dropdown, or system defaults. The `AgentRouter` resolves which strategy to use based on label specificity -- longer, more specific labels take priority.

## Security

All credentials -- GitHub App private keys, Slack bot tokens, LLM API keys -- are encrypted at rest with AES-256-GCM using the Web Crypto API. GitHub webhook payloads are verified with HMAC-SHA256 signature checks. Slack requests are signature-verified the same way.

Authentication uses Google SSO with JWT sessions. The first user to log in becomes the super admin automatically. We built an IAM-style policy system with `Allow/Deny` statements over `Action:Resource` pairs, so you can control who can configure integrations vs. who can just trigger builds.

The container receives decrypted API keys as environment variables per-request -- they're never stored on the container filesystem.

## The Dashboard

The SvelteKit frontend gives you visibility into everything:

- **Task history**: Every request with status, duration, cost, and the full conversation timeline
- **Message timeline**: Shows the initial request, clarifications, tool calls, agent summaries, PR creation events, and errors
- **Session inspector**: View and download the raw JSONL session transcript for debugging or local resumption
- **Handover export**: Generate a markdown context file you can feed to local Claude Code to continue the work on your machine
- **Configuration pages**: Set up GitHub App, Slack bot, LLM providers, and system defaults through the UI
- **User management**: Super admins can manage users and assign policies

The handover feature is worth highlighting. Sometimes the agent gets 80% of the way there, and you want to finish the last 20% locally. The dashboard generates a signed URL that lets you `curl` down the full conversation context -- or the raw session file -- and resume in your local Claude Code with `--resume`.

## Queue Architecture

We use Cloudflare Queues with a dead-letter queue for reliability. Six message types flow through a single queue:

- GitHub issue processing
- Slack feature requests (from slash command modal)
- Slack app mentions (from `@clarity`)
- Slack clarification answers
- Slack follow-up changes
- Retry requests

The queue consumer handles deduplication at multiple levels: tracking IDs in issue bodies, message timestamps for Slack events, and branch naming for container operations. Failed messages retry with exponential backoff, and after exhausting retries, land in the DLQ.

For Slack, we have to beat the 3-second response timeout. The webhook handlers do the absolute minimum -- signature verification, queue dispatch, immediate 200 response -- and all heavy lifting happens in the queue consumer.

## Architecture Decision Records

We documented every major architectural decision as an ADR in [`docs/adr/`](https://github.com/clarityAIBot/clarity_background_agent/tree/main/docs/adr). If you're building something similar, these are worth reading:

| ADR | Decision | Why it matters |
|-----|----------|----------------|
| [001 - Session Blob Persistence](https://github.com/clarityAIBot/clarity_background_agent/blob/main/docs/adr/001-session-blob-persistence.md) | Store gzipped JSONL transcripts in PostgreSQL, fetch via signed URLs | Enables session resumption across stateless containers without hitting HTTP body size limits |
| [002 - Slack Mention Triggers](https://github.com/clarityAIBot/clarity_background_agent/blob/main/docs/adr/002-slack-mention-trigger.md) | Queue-first architecture for `@clarity` mentions | Beats Slack's 3-second timeout while supporting thread context, file attachments, and follow-ups |
| [ADR-001 - Slack to GitHub Bridge](https://github.com/clarityAIBot/clarity_background_agent/blob/main/docs/adr/ADR-001-slack-to-github-actions-bridge.md) | Route Slack requests through GitHub issues | Single processing pipeline regardless of input source |
| [ADR-002 - Autonomous Loop Patterns](https://github.com/clarityAIBot/clarity_background_agent/blob/main/docs/adr/ADR-002-ralph-patterns-autonomous-loop.md) | Let the agent run autonomously with full tool access | `bypassPermissions` mode with structured output detection for clarifications and PR creation |
| [ADR-003 - Durable Objects to PostgreSQL](https://github.com/clarityAIBot/clarity_background_agent/blob/main/docs/adr/ADR-003-migrate-durable-objects-to-postgres-drizzle.md) | Migrate credential storage from Durable Objects to PostgreSQL with Drizzle ORM | Better querying, relational integrity, and familiar tooling over per-object SQLite |
| [ADR-004 - OpenCode Support](https://github.com/clarityAIBot/clarity_background_agent/blob/main/docs/adr/ADR-004-add-opencode-support.md) | Add OpenCode SDK as a second agent backend | Multi-LLM support via Strategy Pattern -- OpenAI, Google, Groq, DeepSeek, Mistral, and more |
| [ADR-005 - Google SSO & User Management](https://github.com/clarityAIBot/clarity_background_agent/blob/main/docs/adr/ADR-005-google-sso-user-management.md) | Google OAuth + IAM-style policy system | Role-based access control with `Allow/Deny` statements over `Action:Resource` pairs |
| [ADR-006 - Multi-Agent Task System](https://github.com/clarityAIBot/clarity_background_agent/blob/main/docs/adr/ADR-006-generic-multi-agent-task-system.md) | Design for agents that can spawn sub-agents | Research tasks, parallel workstreams, and breaking large tasks into smaller PRs |

These ADRs capture not just what we decided, but the alternatives we considered and why we rejected them. They're the best place to understand the "why" behind the architecture.

## What We Learned

**Let the agent ask questions.** The clarification flow was one of the most impactful features. Instead of guessing and producing a mediocre PR, the agent asks 2-3 targeted questions and produces something much better. Users prefer a 5-minute delay with good output over an instant mediocre one.

**Thread context matters.** When someone says `@clarity fix the login bug` in a thread where they've been discussing the bug for 20 messages, the agent needs that context. Injecting thread history into the prompt dramatically improved output quality.

**Follow-ups are the killer feature.** The first PR is rarely perfect. The ability to say "make the error message more specific" and have the agent push to the same branch -- with full context of what it already did -- is what makes this feel like working with a colleague rather than a tool.

**Doc-only changes don't need PRs.** When the agent's changes are entirely documentation, posting them as a comment is faster and less noisy than opening a PR that needs review.

## Try It Yourself

Clarity AI is fully open-source under the MIT license. You can deploy your own instance on Cloudflare Workers in under 30 minutes:

```bash
git clone https://github.com/clarityAIBot/clarity_background_agent.git
cd clarity-ai
npm install
cp .env.example .dev.vars  # Fill in your API keys
npm run deploy
```

Then visit your worker URL, set up the GitHub App and Slack bot through the web UI, and start labeling issues with `clarity-ai`.

The codebase is designed to be extended. The sandbox abstraction supports plugging in different container providers (E2B, Docker). The agent strategy pattern makes adding new LLM backends straightforward. The queue abstraction can be swapped for SQS or any other message broker.

We think every team should have a background coding agent. Not because it replaces developers, but because it handles the work that was never going to get done otherwise. The issue that sits in the backlog for months. The refactor everyone agrees is needed but nobody picks up. The documentation that's always out of date.

Label it. Let Clarity cook. Review the PR in the morning.

---

*Clarity AI is open-source under the MIT license. Star the repo, open an issue, or contribute at [github.com/clarityAIBot/clarity_background_agent](https://github.com/clarityAIBot/clarity_background_agent).*
