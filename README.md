# Clarity AI

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

AI-powered GitHub issue processor that uses Claude Code on Cloudflare Workers with Containers. It listens to issues from your connected repositories and creates Pull Requests to solve them.

## Architecture

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

**Key components:**
- **TypeScript Worker** (`src/index.ts`) -- Routes requests, handles webhooks, manages OAuth flows
- **Node.js Container** (`container_src/`) -- Runs Claude Code in an isolated Docker container
- **Durable Objects** -- Encrypted credential storage (GitHub App, Slack, LLM keys)
- **Cloudflare Queues** -- Reliable async processing with retries and dead-letter queue

## Features

- **Claude Code integration** -- Same coding agent from [claude.ai/code](https://claude.ai/code)
- **Slack-first workflow** -- `@clarity` mentions or `/clarity-feature` slash command
- **GitHub App** -- One-click setup, auto-refreshing installation tokens
- **Multi-LLM support** -- Anthropic, OpenAI, or other providers via configuration
- **Follow-up changes** -- Iteratively refine PRs with additional instructions
- **Clarification flow** -- AI asks questions when requirements are ambiguous
- **Google SSO** -- Optional authentication with IAM-style policy authorization
- **Secure storage** -- AES-256-GCM encrypted credentials in Durable Objects

## Quickstart

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)
- A Cloudflare account with Containers enabled
- An Anthropic API key

### 1. Clone and install

```bash
git clone https://github.com/clarityAIBot/clarity_background_agent.git
cd clarity-ai
npm install
```

### 2. Configure environment

Copy the example environment file and fill in your values:

```bash
cp .env.example .dev.vars
```

See [`.env.example`](.env.example) for required variables.

### 3. Set up secrets and queues

```bash
# Authenticate with Cloudflare
wrangler login

# Create queues
wrangler queues create issue-processing-queue
wrangler queues create issue-processing-dlq

# Set secrets
wrangler secret put SETUP_SECRET
wrangler secret put ENCRYPTION_KEY    # generate with: openssl rand -hex 32
```

### 4. Deploy

```bash
npm run deploy
```

### 5. Configure integrations

After deployment, visit your worker URL and use the setup wizard:

1. `/claude-setup` -- Configure your Anthropic API key
2. `/gh-setup` -- Create and install a GitHub App
3. `/slack-setup` -- (Optional) Connect Slack for slash commands

## Local Development

```bash
npm run dev          # Start local dev server (http://localhost:8787)
npm run cf-typegen   # Regenerate TypeScript types after wrangler.jsonc changes
npm run deploy       # Deploy to Cloudflare Workers
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute.

## Security

See [SECURITY.md](SECURITY.md) for our security policy and how to report vulnerabilities.

## License

This project is licensed under the MIT License -- see [LICENSE](LICENSE) for details.
