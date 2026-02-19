# LinkedIn Post - Copy/Paste Ready

---

We just open-sourced Clarity AI -- a background coding agent that turns GitHub issues and Slack messages into Pull Requests.

Here's how it works:

1. Label a GitHub issue with `clarity-ai` or type `@clarity` in Slack
2. A sandboxed container spins up with Claude Code
3. It clones your repo, analyzes the codebase, writes the code
4. You get a PR ready for review

No local checkout. No terminal babysitting. No laptop needed.

--

The stack: Cloudflare Workers + Containers + Queues. No VMs. No Kubernetes. The container sleeps when idle and wakes on the next request. The entire thing is serverless.

--

What made it actually useful:

The clarification flow. Instead of guessing and producing a mediocre PR, the agent asks 2-3 targeted questions first. Users prefer a 5-minute delay with a good result over an instant bad one.

Session persistence. When you ask for follow-up changes, the agent resumes with full memory of what it already did. It remembers the files it changed, the approaches it tried, and what you said. No starting from scratch.

Thread context. When someone says "@clarity fix the login bug" in a Slack thread where the team has been discussing the bug for 20 messages, the agent reads the entire thread. This alone dramatically improved output quality.

Follow-ups in-thread. The first PR is rarely perfect. Reply with "@clarity make the error message more specific" and it pushes to the same branch. This is what makes it feel like working with a colleague, not a tool.

--

We didn't just ship code. We documented every major architectural decision along the way:

- Session blob persistence -- how we compress and resume agent sessions across containers
- Slack mention triggers -- routing @clarity mentions through queues within Slack's 3-second timeout
- Migrating from Durable Objects to PostgreSQL -- why we moved credential storage to a relational database
- Multi-LLM support via OpenCode -- adding OpenAI, Google, Groq, DeepSeek, and others alongside Claude
- Google SSO with IAM-style policies -- building role-based access control from scratch
- Multi-agent task system -- designing for agents that can spawn sub-agents

All 8 Architecture Decision Records are in the repo at docs/adr/ for anyone building something similar.

--

The tech under the hood:

- TypeScript Worker with Hono router for request handling
- Docker containers with Claude Code SDK (not the CLI -- programmatic control via the query() API)
- Cloudflare Queues with dead-letter queue and automatic retries
- AES-256-GCM encrypted credential storage
- Strategy Pattern for multi-LLM support (Claude Code + OpenCode backends)
- SvelteKit dashboard with task history, session inspector, and handover export
- GitHub App with auto-refreshing installation tokens
- Google SSO with JWT sessions

--

The handover feature is one of my favorites. Sometimes the agent gets 80% of the way there. The dashboard lets you export the full conversation context as a markdown file or raw session transcript. Feed it to your local Claude Code and finish the last 20% yourself. Best of both worlds.

--

MIT licensed. Deploy your own in under 30 minutes:

git clone https://github.com/clarityAIBot/clarity_background_agent.git
npm install
cp .env.example .dev.vars
npm run deploy

Set up your GitHub App and Slack bot through the web UI. Start labeling issues.

Every team has a backlog of "this should be simple" tasks that never get done. Small bug fixes, docs updates, minor refactors. They sit in the tracker because nobody wants to context-switch.

Label it. Let Clarity cook. Review the PR in the morning.

Link: https://github.com/clarityAIBot/clarity_background_agent

#OpenSource #AI #CodingAgent #CloudflareWorkers #ClaudeCode #DevTools #SoftwareEngineering #Automation
