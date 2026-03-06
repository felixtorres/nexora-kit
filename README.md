# NexoraKit

Enterprise AI agent platform — plugin-based, provider-agnostic, self-hosted.

## Overview

NexoraKit is a self-hosted AI agent platform that lets teams build and deploy intelligent bots using plugins. Each plugin is a bundle of skills, commands, and MCP connectors, defined in TypeScript and YAML.

The agent loop at the core goes beyond simple request-response: tools execute in parallel, context is compacted via LLM summarization instead of being dropped, agents can spawn sub-agents for complex tasks, and working memory persists across turns. See [docs/architecture.md](docs/architecture.md) for the full picture.

**Design docs:** See the ClawdNotes vault at `2-Projects/nexora-kit/` for PRD, architecture, and roadmap.

## Quick Start

```bash
# Install
git clone <your-repo-url> nexora-kit
cd nexora-kit
npm install && npm run build

# Install the CLI globally
cd packages/cli && npm link && cd ../..

# Create and start an instance
nexora-kit init my-bot
cd my-bot
# Edit nexora.yaml to configure LLM provider and auth
nexora-kit serve
```

See [docs/getting-started.md](docs/getting-started.md) for full setup instructions.

## CLI

32 commands covering the full platform lifecycle. Run `nexora-kit --help` for the complete list.

```bash
# Instance
nexora-kit init <name>              # Scaffold a new instance
nexora-kit serve                    # Start the server
nexora-kit status                   # Health, uptime, metrics

# Plugins
nexora-kit plugin init <name>       # Scaffold a new plugin
nexora-kit plugin add <source>      # Install from path, ZIP, or GitHub URL
nexora-kit plugin list              # List installed plugins
nexora-kit plugin enable <ns>       # Enable/disable at runtime
nexora-kit plugin validate <path>   # Validate manifest and permissions

# Bots & Agents
nexora-kit bot create --name "FAQ" --model claude-sonnet-4-6 --system-prompt "..."
nexora-kit bot list
nexora-kit agent create --slug support --name "Support" --bot <id>
nexora-kit agent bind <id> --bots <id1>,<id2>

# Config
nexora-kit config validate          # Check config before starting
nexora-kit config show              # Show resolved config (secrets masked)

# Admin
nexora-kit admin usage              # Token analytics
nexora-kit admin audit              # Audit log
nexora-kit admin feedback           # Feedback summary

# Shell completion
nexora-kit completion --shell fish > ~/.config/fish/completions/nexora-kit.fish
nexora-kit completion --shell bash  # eval "$(nexora-kit completion --shell bash)"
nexora-kit completion --shell zsh   # eval "$(nexora-kit completion --shell zsh)"
```

## Monorepo Structure

| Package | Description |
|---------|-------------|
| `@nexora-kit/core` | Agent loop (parallel tools, compaction, sub-agents, working memory), context budget, tool dispatcher |
| `@nexora-kit/llm` | Provider abstraction, routing, fallback, token budgets |
| `@nexora-kit/plugins` | Plugin loader, lifecycle, namespace isolation |
| `@nexora-kit/skills` | Skill framework: TS, YAML, MD handlers |
| `@nexora-kit/commands` | Command parser, help generation |
| `@nexora-kit/mcp` | MCP server manager, health monitoring |
| `@nexora-kit/api` | REST + WebSocket gateway |
| `@nexora-kit/admin` | Plugin registry, RBAC, audit logging |
| `@nexora-kit/config` | Hierarchical config resolution |
| `@nexora-kit/tool-registry` | Dynamic tool discovery, semantic search, per-request selection |
| `@nexora-kit/storage` | SQLite persistence (messages, config, plugin state, usage) |
| `@nexora-kit/sandbox` | Isolated execution, permission boundaries, code mode |
| `@nexora-kit/cli` | CLI tooling (32 commands) |
| `@nexora-kit/testing` | Test utilities, mock providers |
| `@nexora-kit/nexora-frontend` | Next.js 16 reference UI (chat, admin, playground) |
| `@nexora-kit/benchmarks` | Performance benchmarks |

## Tech Stack

- **Language:** TypeScript (Node.js 20+)
- **Monorepo:** Turborepo + npm workspaces
- **LLM:** Provider-agnostic (Claude, OpenAI, Azure, Ollama, Bedrock)
- **Storage:** SQLite (default), PostgreSQL + Redis (optional, for high-scale)
- **Deployment:** Kubernetes (Helm chart)
