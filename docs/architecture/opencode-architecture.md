# OpenCode Architecture Diagram

**Date**: 2026-01-15
**Source**: https://github.com/anomalyco/opencode
**Location**: `/external_modules/opencode`

## Overview

OpenCode is an AI-powered development assistant CLI built as a sophisticated monorepo with multiple packages. It supports 20+ LLM providers and provides extensible tooling for code generation, editing, and analysis.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERFACES                                     │
├─────────────────┬─────────────────┬─────────────────┬───────────────────────────┤
│   CLI (yargs)   │  Desktop App    │   Web Console   │     IDE Extensions        │
│                 │   (Tauri)       │   (Solid.js)    │      (VSCode SDK)         │
└────────┬────────┴────────┬────────┴────────┬────────┴──────────────┬────────────┘
         │                 │                 │                       │
         └─────────────────┴────────┬────────┴───────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           HTTP SERVER (Hono)                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Routes: /session, /message, /tool, /config, /auth, /mcp, /lsp         │    │
│  │  WebSocket: Real-time streaming, SSE for responses                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────┬────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         SESSION MANAGEMENT                                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │ Session Create  │  │ Message History │  │  Context Compaction & Storage   │  │
│  │ Load/Save/List  │  │ Turn Tracking   │  │  Per-directory State           │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────────┘  │
└────────────────────────────────────┬────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           AGENT SYSTEM                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                         Multi-Agent Architecture                         │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────────┐  │    │
│  │  │ Build Agent  │  │ Plan Agent   │  │    General Agent (Subagent)   │  │    │
│  │  │ (Primary)    │  │ (Read-only)  │  │    (Complex searches)         │  │    │
│  │  │ Full access  │  │ Analysis     │  │    Restricted permissions     │  │    │
│  │  └──────────────┘  └──────────────┘  └───────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                      Permission System (PermissionNext)                  │    │
│  │  Rules: allow | deny | ask  │  Granular per-tool/file pattern control   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────┬────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         PROVIDER ABSTRACTION                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                    Vercel AI SDK Multi-Provider                          │    │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │    │
│  │  │Anthropic│ │ OpenAI  │ │ Google  │ │ Mistral │ │  Groq   │  + 15+    │    │
│  │  │ Claude  │ │  GPT    │ │ Gemini  │ │         │ │         │  more     │    │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘           │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────┬────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            TOOL SYSTEM                                           │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │  Built-in Tools                                                            │  │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────────┐ │  │
│  │  │  Bash  │ │  Edit  │ │  Glob  │ │  Grep  │ │  Read  │ │    Write     │ │  │
│  │  │Terminal│ │ Files  │ │ Search │ │ Content│ │ Files  │ │    Files     │ │  │
│  │  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └──────────────┘ │  │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌─────────────────────────────────────┐ │  │
│  │  │  LSP   │ │  MCP   │ │  PTY   │ │   External Directory Access         │ │  │
│  │  │ Server │ │ Tools  │ │Terminal│ │   (with permission controls)        │ │  │
│  │  └────────┘ └────────┘ └────────┘ └─────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────┬────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         EXTENSION POINTS                                         │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────────────┐ │
│  │   MCP Servers      │  │   LSP Integration  │  │      Plugin System         │ │
│  │  (stdio/HTTP)      │  │  Code Intelligence │  │   Custom tool definitions  │ │
│  │  Tools/Resources   │  │  Diagnostics       │  │   Zod schema validation    │ │
│  └────────────────────┘  └────────────────────┘  └────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Package Structure

```
opencode/
├── packages/
│   ├── opencode/          # Core CLI application (38K+ lines)
│   │   ├── src/
│   │   │   ├── agent/     # Multi-agent system
│   │   │   ├── cli/cmd/   # CLI commands
│   │   │   ├── server/    # HTTP server (Hono)
│   │   │   ├── session/   # Session lifecycle
│   │   │   ├── provider/  # LLM provider abstraction
│   │   │   ├── tool/      # Extensible tools
│   │   │   ├── project/   # Workspace detection
│   │   │   ├── config/    # Configuration system
│   │   │   ├── mcp/       # Model Context Protocol
│   │   │   ├── lsp/       # Language Server Protocol
│   │   │   ├── file/      # File operations
│   │   │   ├── permission/# Permission system
│   │   │   ├── bus/       # Event bus
│   │   │   ├── auth/      # Authentication
│   │   │   └── plugin/    # Plugin system
│   │   └── package.json
│   │
│   ├── app/               # Desktop/Web UI (Solid.js)
│   ├── ui/                # Shared UI components
│   ├── sdk/js/            # TypeScript SDK
│   ├── web/               # Marketing site (Astro)
│   ├── console/           # SaaS console
│   │   ├── app/           # Web application
│   │   ├── core/          # Business logic
│   │   ├── resource/      # Resource management
│   │   └── function/      # Functions
│   ├── plugin/            # Plugin development kit
│   ├── desktop/           # Desktop app (Tauri)
│   ├── slack/             # Slack integration
│   ├── identity/          # User authentication
│   ├── enterprise/        # Enterprise features
│   └── util/              # Shared utilities
│
├── sdks/                  # IDE integrations
│   └── vscode/            # VSCode extension
│
├── github/                # GitHub integration
├── specs/                 # API specifications
├── themes/                # UI themes
└── infra/                 # Infrastructure config
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              REQUEST FLOW                                        │
└─────────────────────────────────────────────────────────────────────────────────┘

  User Input                                                          Response
      │                                                                   ▲
      ▼                                                                   │
┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐
│    CLI    │───▶│  Server   │───▶│  Session  │───▶│   Agent   │───▶│ Provider  │
│  (yargs)  │    │  (Hono)   │    │  Manager  │    │  System   │    │   (LLM)   │
└───────────┘    └───────────┘    └───────────┘    └───────────┘    └───────────┘
                                                         │                │
                                                         ▼                │
                                                   ┌───────────┐          │
                                                   │   Tool    │◀─────────┘
                                                   │ Executor  │  (tool calls)
                                                   └───────────┘
                                                         │
                                                         ▼
                                                   ┌───────────┐
                                                   │Permission │
                                                   │  Check    │
                                                   └───────────┘
                                                         │
                                                         ▼
                                                   ┌───────────┐
                                                   │  Execute  │
                                                   │(bash/edit)│
                                                   └───────────┘
                                                         │
                                                         ▼
                                                   ┌───────────┐
                                                   │Event Bus  │───▶ LSP, UI, Storage
                                                   └───────────┘
```

## Technology Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Bun 1.3.5 |
| **Language** | TypeScript 5.8 |
| **HTTP Framework** | Hono 4.10 |
| **UI Framework** | Solid.js 1.9 |
| **Build System** | Turborepo |
| **CSS** | TailwindCSS 4 |
| **AI SDK** | Vercel AI SDK |
| **Desktop** | Tauri |
| **Static Site** | Astro |
| **Validation** | Zod |

## Supported LLM Providers (20+)

| Provider | Models |
|----------|--------|
| Anthropic | Claude 3.5 Sonnet, Claude 3 Opus, Haiku |
| OpenAI | GPT-4o, GPT-4 Turbo, GPT-3.5 |
| Google | Gemini Pro, Gemini Ultra |
| Mistral | Mistral Large, Medium, Small |
| Groq | LLaMA, Mixtral (fast inference) |
| DeepInfra | Various open models |
| Cohere | Command, Command-R |
| OpenRouter | Multi-provider gateway |
| Azure OpenAI | GPT-4, GPT-3.5 |
| AWS Bedrock | Claude, Titan |
| Ollama | Local models |
| + More | Fireworks, Together, Perplexity, etc. |

## Agent System

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AGENT CONFIGURATION                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  BUILD AGENT (Default)                                        │  │
│  │  ├── Mode: Primary                                            │  │
│  │  ├── Permission: allow_all                                    │  │
│  │  └── Purpose: Full development access (create, edit, execute) │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  PLAN AGENT                                                   │  │
│  │  ├── Mode: Primary                                            │  │
│  │  ├── Permission: read_only                                    │  │
│  │  └── Purpose: Analysis, planning, exploration                 │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  GENERAL AGENT                                                │  │
│  │  ├── Mode: Subagent                                           │  │
│  │  ├── Permission: restricted                                   │  │
│  │  └── Purpose: Internal use for complex searches               │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Permission System

```typescript
// Permission rules example
permission: {
  "*": "allow",                              // Default: allow
  "external_directory": { "*": "ask" },      // Ask before external access
  "edit": { "*.env": "deny" },               // Never edit .env files
  "bash": {
    "rm -rf": "deny",                        // Block dangerous commands
    "git push --force": "ask"                // Ask for force push
  }
}
```

## Configuration Layering

```
Priority (Highest to Lowest):
┌─────────────────────────────────────┐
│ 1. Project-level .opencode.jsonc   │  ← Per-project config
├─────────────────────────────────────┤
│ 2. Custom config via --config flag  │  ← CLI override
├─────────────────────────────────────┤
│ 3. Global user config (~/.opencode) │  ← User defaults
├─────────────────────────────────────┤
│ 4. Remote well-known config         │  ← Organization defaults
├─────────────────────────────────────┤
│ 5. Built-in defaults                │  ← Fallback values
└─────────────────────────────────────┘
```

## Event Bus Pattern

```typescript
// Type-safe event system
interface Events {
  "session.created": { info: SessionInfo }
  "session.message": { message: Message }
  "tool.executed": { tool: string, result: any }
  "error": { code: string, message: string }
}

// Publish events
Bus.publish("session.created", { info })

// Subscribe to events
Bus.subscribe("session.created", (event) => {
  // Handle session creation
})
```

## Key Entry Points

| File | Purpose |
|------|---------|
| `packages/opencode/src/index.ts` | CLI entry point |
| `packages/opencode/src/cli/cmd/run.ts` | Main `opencode run` command |
| `packages/opencode/src/server/server.ts` | HTTP server (95KB) |
| `packages/opencode/src/session/index.ts` | Session lifecycle |
| `packages/opencode/src/provider/provider.ts` | LLM provider factory (42KB) |
| `packages/opencode/src/agent/agent.ts` | Agent configuration |
| `packages/app/src/entry.tsx` | Web app entry |

## Extension Points

### 1. MCP Servers (Model Context Protocol)
```
┌─────────────────┐     ┌─────────────────┐
│  Local Server   │     │  Remote Server  │
│    (stdio)      │     │    (HTTP)       │
├─────────────────┤     ├─────────────────┤
│ • Tools         │     │ • Tools         │
│ • Prompts       │     │ • Resources     │
│ • Resources     │     │ • Sampling      │
└─────────────────┘     └─────────────────┘
```

### 2. Custom Plugins
```typescript
// Plugin definition
export interface Tool {
  id: string
  description: string
  schema: ZodSchema
  execute(input): Promise<output>
}
```

### 3. LSP Integration
- Code intelligence
- Diagnostics
- Symbol search
- Go to definition

## Comparison with Clarity AI

| Feature | OpenCode | Clarity AI |
|---------|----------|------------|
| **Architecture** | Monorepo CLI | Cloudflare Workers |
| **LLM Providers** | 20+ via AI SDK | Anthropic Claude |
| **UI** | Solid.js Desktop/Web | SvelteKit Web |
| **Database** | File-based sessions | PostgreSQL + Drizzle |
| **Deployment** | Local/Desktop | Edge (Cloudflare) |
| **Triggers** | CLI commands | GitHub/Slack webhooks |
| **State** | Session files | Durable Objects/PG |

## Integration Opportunities

1. **Provider Abstraction**: Adopt Vercel AI SDK pattern for multi-provider support
2. **Permission System**: Implement granular permission rules like PermissionNext
3. **Tool System**: Extensible tool interface with Zod validation
4. **Event Bus**: Type-safe pub/sub for inter-component communication
5. **Configuration Layering**: Multi-level config precedence system
