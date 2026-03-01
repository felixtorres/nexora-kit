# NexoraKit

Enterprise chatbot platform — plugin-based, provider-agnostic, self-hosted.

## Overview

NexoraKit is a self-hosted chatbot platform that lets teams build and deploy AI-powered bots using plugins. Each plugin is a bundle of skills, commands, and MCP connectors, defined in TypeScript and YAML.

**Design docs:** See the ClawdNotes vault at `2-Projects/nexora-kit/` for PRD, architecture, and roadmap.

## Monorepo Structure

| Package | Description |
|---------|-------------|
| `@nexora-kit/core` | Agent loop, context manager, memory, tool dispatcher |
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
| `@nexora-kit/cli` | Developer CLI tooling |
| `@nexora-kit/testing` | Test utilities, mock providers |

## Getting Started

```bash
npm install
npm run build
npm run test
```

## Tech Stack

- **Language:** TypeScript (Node.js 20+)
- **Monorepo:** Turborepo + npm workspaces
- **LLM:** Provider-agnostic (Claude, OpenAI, Azure, Ollama, Bedrock)
- **Storage:** SQLite (default), PostgreSQL + Redis (optional, for high-scale)
- **Deployment:** Kubernetes (Helm chart)
