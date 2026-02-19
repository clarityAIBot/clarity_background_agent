# Contributing to Clarity AI

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/clarityAIBot/clarity_background_agent.git
   cd clarity-ai
   npm install
   ```

2. **Set up local environment:**
   ```bash
   cp .env.example .dev.vars
   # Edit .dev.vars with your local configuration
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```
   This starts a local Wrangler dev server at `http://localhost:8787`.

4. **Regenerate types after config changes:**
   ```bash
   npm run cf-typegen
   ```
   Always run this after modifying `wrangler.jsonc`.

## Submitting Changes

### Issues

- Search existing issues before opening a new one
- Use the provided issue templates (bug report or feature request)
- Include enough detail to reproduce bugs

### Pull Requests

1. Fork the repository and create a feature branch from `main`
2. Make your changes with clear, focused commits
3. Ensure the project builds without errors (`npm run build`)
4. Fill out the PR template with a description of your changes
5. Link any related issues

### Code Style

- TypeScript with strict mode
- Use existing patterns in the codebase as reference
- Keep functions small and focused
- Add comments only where the logic is not self-evident

## Project Structure

```
src/                    # Cloudflare Worker source
  index.ts              # Main router
  handlers/             # Request handlers (webhooks, API, Slack)
  queue/                # Queue consumer and message types
  db/                   # Database schema and repositories (Drizzle ORM)
  services/             # Business logic services
  integrations/         # External service clients (GitHub, Slack)
  core/                 # Shared utilities (auth, crypto, logging)
container_src/          # Docker container source (Claude Code runner)
frontend/               # SvelteKit dashboard UI
docs/adr/               # Architecture Decision Records
```

## Questions?

Open an issue with the question label and we'll do our best to help.
