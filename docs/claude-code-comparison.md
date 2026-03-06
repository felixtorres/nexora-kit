# NexoraKit & Claude Code: Design Lineage and Comparison

NexoraKit's architecture is directly inspired by Claude Code — Anthropic's terminal-based AI agent. This document explains that lineage, maps every major subsystem between the two, and calls out where NexoraKit extends, diverges, or deliberately simplifies.

If you've used Claude Code, this is the fastest way to understand NexoraKit. If you haven't, this doubles as a deep walkthrough of the agent platform's design philosophy.

---

## Table of Contents

- [Philosophy](#philosophy)
- [Architecture at a Glance](#architecture-at-a-glance)
- [Agent Loop](#agent-loop)
- [Tools and Tool Dispatch](#tools-and-tool-dispatch)
- [Context Management](#context-management)
- [Plugin System](#plugin-system)
- [Skills](#skills)
- [Commands](#commands)
- [MCP Integration](#mcp-integration)
- [Sub-Agents](#sub-agents)
- [Working Memory](#working-memory)
- [System Prompt Engineering](#system-prompt-engineering)
- [Observability](#observability)
- [What NexoraKit Adds](#what-nexorakit-adds)
- [What Claude Code Has That NexoraKit Doesn't](#what-claude-code-has-that-nexorakit-doesnt)
- [Design Decisions That Diverge](#design-decisions-that-diverge)
- [Plugin Compatibility](#plugin-compatibility)

---

## Philosophy

Claude Code is a single-user, local-first agent. It runs in a terminal, reads your filesystem, and executes tools on your behalf. It's opinionated about the development workflow and assumes a trusted environment — the user and the agent share the same machine.

NexoraKit takes that core interaction model — an LLM that reasons over tools in a multi-turn loop — and adapts it for a fundamentally different environment:

- **Multi-tenant**: many users, many conversations, many bots
- **Server-deployed**: runs as a service behind an API, not in a terminal
- **Provider-agnostic**: works with Claude, GPT, Ollama, Azure, Bedrock — any LLM
- **Plugin-scoped**: capabilities come from isolated, hot-swappable plugins instead of hardcoded tool implementations
- **Enterprise-ready**: auth, rate limits, audit logging, RBAC, sandboxing

The design question NexoraKit answers is: *what if Claude Code's agent loop was the engine inside a product, not the product itself?*

---

## Architecture at a Glance

| Aspect | Claude Code | NexoraKit |
|--------|------------|-----------|
| Runtime | Terminal CLI (single process) | Node.js server (HTTP + WebSocket) |
| Users | Single user, local | Multi-user, multi-tenant |
| LLM | Claude (Anthropic API) | Any provider (Anthropic, OpenAI, Azure, Ollama, Bedrock) |
| Tools | Built-in (Read, Write, Bash, Grep, etc.) | Plugin-provided + MCP + built-in agent tools |
| Storage | Conversation transcripts (local JSON) | SQLite (default), PostgreSQL + Redis (optional) |
| Plugins | Directory-based (skills, commands, hooks, MCP) | Same model, plus lifecycle management and namespace isolation |
| Auth | Local user, permission prompts | API key, JWT, end-user auth (anonymous/token/JWT) |
| UI | Terminal | REST API + WebSocket + reference Next.js frontend |
| Config | `~/.claude/settings.json`, `CLAUDE.md`, env vars | Hierarchical YAML (instance → plugin → runtime), env var interpolation |
| Deployment | `npm install -g @anthropic-ai/claude-code` | Docker, Kubernetes (Helm chart), `nexora-kit serve` |

---

## Agent Loop

This is where the lineage is most direct. NexoraKit's `AgentLoop` in `@nexora-kit/core` mirrors Claude Code's interaction model almost exactly.

### Shared Design

Both systems run the same fundamental loop:

```
1. Assemble system prompt (instructions + context + memory)
2. Send messages + tools to LLM
3. LLM responds with text, tool calls, or both
4. Execute tool calls
5. Feed results back as tool_result messages
6. Repeat until done or turn limit reached
```

Both systems:
- Stream tokens and tool events incrementally
- Support cancellation via `AbortSignal`
- Have a configurable maximum turn count
- Auto-register special tools at specific turn thresholds
- Forward extended thinking / chain-of-thought events

### Where NexoraKit Extends

| Feature | Claude Code | NexoraKit |
|---------|------------|-----------|
| **Parallel tool execution** | Sequential (one tool at a time) | Concurrent via `Promise.all` when LLM emits multiple tool calls |
| **Context compaction** | Drops old messages when context is full | LLM-based summarization preserves key decisions and facts |
| **Working memory** | `CLAUDE.md` and conversation history | Explicit `_note_to_self` / `_recall` tools that survive compaction |
| **Adaptive turns** | Fixed turn limit | `_request_continue` tool dynamically grants more turns |
| **Tool status events** | Tool calls visible in terminal | Structured `tool_status` events (executing → completed/error) |
| **Structured output** | Text + artifacts | 9 block types (cards, tables, forms, actions, progress bars, etc.) |
| **Bot orchestration** | N/A (single agent) | Multi-bot fan-out with LLM-driven synthesis |

### The Critical Difference: Parallel Tools

When an LLM emits three tool calls in one response, Claude Code executes them sequentially. NexoraKit runs them concurrently:

```
Claude Code:       tool A → tool B → tool C  (serial)
NexoraKit:         tool A ─┐
                   tool B ─┤  Promise.all()
                   tool C ─┘
```

This matters for latency-sensitive deployments where tools involve network calls (MCP servers, database queries, API calls). A three-tool turn that takes 9 seconds serially can complete in 3 seconds parallel.

---

## Tools and Tool Dispatch

### Claude Code's Approach

Claude Code ships with a fixed set of built-in tools:

| Tool | Purpose |
|------|---------|
| `Read` | Read files |
| `Write` | Create files |
| `Edit` | Patch files with string replacement |
| `Bash` | Execute shell commands |
| `Glob` | Find files by pattern |
| `Grep` | Search file contents |
| `Agent` | Spawn sub-agents |
| `WebFetch` | Fetch URLs |
| `WebSearch` | Search the web |
| `NotebookEdit` | Edit Jupyter notebooks |
| `TodoWrite` | Track tasks |

These tools are always available. The LLM sees all of them (with some conditional registration). There is no tool selection — the model sees the full set every turn.

### NexoraKit's Approach

NexoraKit has no hardcoded tools. All tools come from three sources:

1. **Plugins** — each plugin declares tools in its manifest
2. **MCP servers** — tools exposed by connected MCP servers
3. **Built-in agent tools** — `_note_to_self`, `_recall`, `_save_to_memory`, `_spawn_agent`, `_request_continue` (auto-registered by the agent loop)

Because a deployment can have hundreds of tools across many plugins, NexoraKit adds a **tool selection layer** that Claude Code doesn't need:

```
All registered tools (potentially hundreds)
     │
     ▼
ToolSelector.select(query, budget)
     │
     ├── Keyword scoring (0.4 weight)
     ├── Recency scoring (0.3 weight)
     ├── Context scoring (0.3 weight)
     └── Optional: embedding similarity (cosine, MiniLM-L6-v2)
     │
     ▼
Top-K tools that fit within token budget
```

This is a problem Claude Code doesn't face — with ~12 built-in tools, the full set always fits in context. But a NexoraKit deployment with 20 plugins, each exposing 5-10 tools, can't send 200 tool definitions to the LLM every turn. The selector ensures only relevant tools consume context tokens.

### Tool Namespacing

Claude Code tools live in a flat namespace. NexoraKit namespaces all tools under their plugin:

```
Claude Code:   Read, Write, Bash, Grep
NexoraKit:     @analytics/query_data, @analytics/chart, @support/search_tickets
```

The `GLOBAL_NAMESPACE` (`__global__`) is reserved for tools that should always be included in selection regardless of query.

---

## Context Management

### Claude Code

Claude Code manages context primarily through message truncation. When the conversation exceeds the context window, old messages are dropped. The model's `CLAUDE.md` file and conversation transcripts provide some persistence, but within a conversation, context management is relatively simple:

- Messages fill up the context window
- Old messages are compressed or dropped when space runs out
- The model has no explicit awareness of its context budget

### NexoraKit

NexoraKit manages context as an explicit, budgeted resource. The `ContextBudget` class allocates the model's context window across competing needs:

```
Model Context Window
├── Reserved output tokens (from model config)
├── System prompt (base + workspace + artifacts + skills)
├── Tool definitions (adaptive — shrinks as messages grow)
└── Messages (everything that's left)
```

Key innovations:

**Adaptive tool budget**: When messages consume more than 70% of available context, the tool budget shrinks linearly (down to 30% of its normal size at 90%). This gracefully degrades tool selection in long conversations rather than hard-failing.

**LLM-based compaction**: Instead of dropping old messages, NexoraKit summarizes them via a cheap LLM call. The compactor groups messages into "atomic groups" (assistant message + its tool calls + tool results) and never splits them. Recent groups are kept verbatim; older groups are summarized into a compressed prefix.

```
Before:  [msg 1] [msg 2] ... [msg 16] [msg 17] [msg 18] [msg 19] [msg 20]
After:   [summary of msgs 1-16] [msg 17] [msg 18] [msg 19] [msg 20]
```

**Tool result truncation**: Tool results are streamed to the client at full fidelity, but truncated in message history (default 2000 tokens). This keeps conversation context lean without hiding data from the user.

---

## Plugin System

### Claude Code

Claude Code plugins are directory-based bundles discovered from standard locations:

```
.claude-plugin/
  plugin.json          # Manifest
skills/
  my-skill/
    SKILL.md           # Skill definition
    references/        # Supporting docs
    scripts/           # Executable scripts
commands/
  my-command.md        # Command definition
hooks/
  hooks.json           # Lifecycle hooks
.mcp.json              # MCP server config
```

Plugins are loaded at startup. There is no lifecycle management — a plugin is either present or not. There are no permission boundaries between plugins.

### NexoraKit

NexoraKit keeps the same directory-based convention but adds enterprise runtime management:

```
plugin.yaml              # Manifest (or .claude-plugin/plugin.json)
src/
  skills/                # Skill definitions (YAML, MD, or TS)
  commands/              # Command definitions (YAML or MD)
mcp/
  mcp.yaml               # MCP server config (or .mcp.json)
CONNECTORS.md            # Plugin documentation (optional)
```

**Lifecycle state machine**:

```
install() → [installed] → enable() → [enabled] → disable() → [disabled] → uninstall()
                                         ↑                        |
                                         └── reload() ────────────┘
```

On enable: tools registered, skills activated, MCP servers started.
On disable: everything reversed. Hot-reload watches the filesystem and auto-reloads on change.

**Namespace isolation**: Each plugin's tools, skills, and commands live under a namespace (`@pluginName/toolName`). Plugins cannot access each other's internals.

**Permission boundaries**: The `PermissionGate` in `@nexora-kit/sandbox` controls which system resources a plugin's tools can access. Plugin manifests declare required permissions; admins approve them.

**Audit logging**: Every lifecycle transition (enable, disable, install, uninstall) is logged with timestamp, actor, and outcome.

---

## Skills

### Claude Code: Behavioral Injection

Claude Code skills are **behavioral overlays**. A SKILL.md file is a set of instructions that modify how the agent behaves:

```markdown
---
name: commit
description: Create a git commit
argument-hint: optional message
allowed-tools: Bash, Read, Grep
---

Review the staged changes and create a well-formatted commit message...
(natural language instructions that Claude follows)
```

When a skill activates, Claude reads the instructions and orchestrates its built-in tools to accomplish the task. The skill doesn't call an API — it shapes the agent's behavior. This is Claude Code's most distinctive design choice.

Key properties:
- **Instructions, not code**: the skill body is natural language
- **Progressive disclosure**: the agent sees skill metadata at all times, loads the full body only when invoked, and reads resources on demand
- **Tool restriction**: `allowed-tools` limits which tools the agent can use during skill execution
- **Forking**: `context: fork` spawns an isolated sub-agent to execute the skill

### NexoraKit: Three Execution Modes

NexoraKit supports three skill execution modes to bridge the gap between Claude Code's behavioral model and traditional programmatic skills:

| Mode | Format | Execution | Use Case |
|------|--------|-----------|----------|
| `prompt` | YAML or MD | Render template → single LLM call → return text | Simple Q&A, formatting, summarization |
| `code` | TypeScript | Execute handler function → return result | API calls, data processing, custom logic |
| `behavioral` | SKILL.md (Claude format) | Inject instructions into agent context | Complex multi-tool workflows (Claude Code compatibility) |

**Prompt mode** (NexoraKit-native) is simpler than Claude Code's behavioral model. A skill template is rendered with parameters and sent to the LLM as a single call. This is efficient for skills that don't need multi-turn tool orchestration.

**Code mode** (NexoraKit-only) allows skills to execute arbitrary TypeScript. This has no equivalent in Claude Code — Claude Code skills are always natural language instructions interpreted by the LLM.

**Behavioral mode** mirrors Claude Code's approach. The skill body is injected into the agent's working memory, and the agent orchestrates tools to follow the instructions over multiple turns.

### Progressive Disclosure

Both systems use progressive disclosure to manage context budgets:

| Tier | Claude Code | NexoraKit |
|------|------------|-----------|
| Always visible | Skill name + description | Skill index (compact markdown per namespace) |
| On invoke | Full SKILL.md body | Full skill prompt / body |
| On demand | `references/`, `scripts/`, `assets/` | `references/` content inlined (scripts not supported) |

NexoraKit adds a `get_skill_context` tool that the agent can call to load a skill's full content on demand, without the user explicitly invoking it. This enables the agent to self-discover relevant skills during open-ended tasks.

---

## Commands

### Claude Code

Commands are `.md` files or SKILL.md files with `user-invocable: true`. Invoked via `/command-name free-form arguments`. Arguments are passed as a raw string (`$ARGUMENTS`). Commands and skills share the same registry — a command is just a user-invocable skill.

### NexoraKit

Commands are YAML definitions with structured argument schemas:

```yaml
name: search
description: Search the knowledge base
args:
  query:
    type: string
    required: true
  limit:
    type: number
    default: 10
```

Invoked via `/namespace:command --query "term" --limit 5`. Arguments are parsed, type-coerced, and validated against the schema. This is more structured than Claude Code's free-form approach but less flexible for natural-language arguments.

NexoraKit also supports Claude-format `.md` commands for compatibility. These bypass the argument parser and pass the raw string as a prompt.

---

## MCP Integration

### Claude Code

MCP servers are configured in `.mcp.json` at the project or plugin root. Supports stdio and SSE transports. Servers start when the plugin loads and expose tools to the agent.

### NexoraKit

NexoraKit's MCP integration adds operational hardening:

| Feature | Claude Code | NexoraKit |
|---------|------------|-----------|
| Config format | `.mcp.json` | `mcp/mcp.yaml` (also supports `.mcp.json`) |
| Transports | stdio, SSE | stdio, SSE, HTTP (POST-based JSON-RPC) |
| Health monitoring | None | Periodic health checks with auto-restart on failure |
| Circuit breaker | None | Closed → open → half-open state machine per server |
| Template variables | `${CLAUDE_PLUGIN_ROOT}` | `{{config.key}}` resolved from plugin config |
| Lifecycle | Start on load | Start on plugin enable, stop on disable |

The circuit breaker prevents a failing MCP server from blocking the agent loop. After a configurable failure threshold, the breaker opens and tools from that server return errors immediately rather than timing out.

---

## Sub-Agents

### Claude Code

Claude Code's `Agent` tool spawns specialized sub-agents:

- `general-purpose` — full tool access
- `Explore` — read-only codebase exploration
- `Plan` — architecture and planning (read-only)
- `claude-code-guide` — documentation lookup

Sub-agents run in isolated contexts with their own conversation histories. They can optionally run in git worktrees for isolated file changes.

### NexoraKit

NexoraKit's `_spawn_agent` tool mirrors this model:

```
Parent Agent (depth 0)
     ├── _spawn_agent("research API options")    → Child (depth 1)
     ├── _spawn_agent("draft implementation")    → Child (depth 1)
     └── Integrates both results
```

Key differences:

| Feature | Claude Code | NexoraKit |
|---------|------------|-----------|
| Max depth | Not documented / unlimited | Configurable (default 2) |
| Max concurrent | Not documented | Configurable (default 3) |
| Tool filtering | By agent type | Internal tools available, `_spawn_agent` excluded at max depth |
| Isolation | Separate conversation, optional worktree | Separate conversation, shared tool registry |
| Agent types | 5 specialized types | Generic — all sub-agents get the same tools |

NexoraKit doesn't have specialized sub-agent types like `Explore` or `Plan`. Instead, tool filtering is based on depth and explicit `allowedTools` lists (when used with behavioral skills).

---

## Working Memory

### Claude Code

Claude Code's persistent memory is file-based:
- `CLAUDE.md` — project-level instructions loaded every session
- `~/.claude/CLAUDE.md` — user-level global instructions
- Auto-memory (`~/.claude/projects/`) — facts saved across sessions
- Conversation transcripts — previous session logs searchable via Grep

The model doesn't have explicit tools for note-taking within a conversation. Its working memory is the conversation context itself.

### NexoraKit

NexoraKit has explicit working memory tools:

| Tool | Scope | Survives Compaction | Persists Across Conversations |
|------|-------|--------------------|-----------------------------|
| `_note_to_self` | Current conversation | Yes (injected into system prompt) | No |
| `_recall` | Current conversation | N/A (reads notes) | No |
| `_save_to_memory` | Per-user, namespace-scoped | N/A | Yes |

Working memory notes are injected into the system prompt every turn. This means they survive context compaction — even when old messages are summarized, the agent's notes remain verbatim.

Cross-conversation memory (`_save_to_memory`) stores facts in a persistent user memory store, scoped by namespace. This is similar to Claude Code's auto-memory but structured (key-value with metadata) rather than file-based.

---

## System Prompt Engineering

### Claude Code

Claude Code uses a single system prompt assembled from:
1. Base instructions (tool usage guidance, behavioral rules)
2. `CLAUDE.md` content (project + user level)
3. Auto-memory entries
4. Environment context (git status, OS, shell)

The prompt is relatively static within a session.

### NexoraKit

NexoraKit rebuilds the system prompt every turn from six components:

```
1. Workspace context docs (budget-capped, priority-ordered)
2. Base system prompt (tool guidance, reasoning patterns)
3. Command prompt (if a /command was invoked)
4. Artifact listing (titles + versions of conversation artifacts)
5. Skill index (per-namespace summaries for progressive disclosure)
6. Working memory (notes + turn reminders)
```

**Turn reminders** are injected based on the current turn number:
- Turn 1: guidance on available tools
- Near limit: "You have N turn(s) remaining. Prioritize completing your current task."

This per-turn adaptation is a key difference — Claude Code's system prompt is mostly static, while NexoraKit's actively shapes agent behavior based on conversation state.

---

## Observability

### Claude Code

Claude Code is a terminal application. Observability is visual — you see the agent's reasoning, tool calls, and outputs in real time. There's no structured telemetry.

### NexoraKit

NexoraKit treats observability as a first-class concern for production deployments:

| Feature | Implementation |
|---------|---------------|
| **Structured logging** | `JsonLogger` with levels, child loggers, `LOG_LEVEL` env var |
| **LLM tracing** | `ObservabilityHooks` interface with `LangfuseObservability` adapter |
| **Metrics** | `MetricsCollector` — uptime, request counts, latency p95, active connections |
| **Audit logging** | Every admin action logged with timestamp, actor, outcome |
| **Token usage tracking** | Per-plugin, per-conversation token accounting |
| **Dev panel** | Frontend WebSocket event inspector, token usage visualization |
| **Health endpoint** | `GET /v1/health` — dependency status, uptime |
| **Metrics endpoint** | `GET /v1/metrics` — request stats, latency percentiles |

---

## What NexoraKit Adds

These are capabilities that have no equivalent in Claude Code — they exist because NexoraKit serves a fundamentally different deployment model.

### Multi-Bot Orchestration

Claude Code is one agent. NexoraKit can deploy many bots behind one agent endpoint, each with different models, prompts, and plugin sets. The orchestrator LLM decides which bot(s) to invoke for each request:

```
End user message → Agent endpoint
                        │
                   Orchestrator LLM creates ask_<bot> tools
                        │
                   ├── ask_faq_bot("what are your hours?")
                   ├── ask_billing_bot("check my invoice")
                   └── Synthesize responses into one reply
```

Three orchestration strategies:
- **Single**: one bot handles everything
- **Route**: keyword matching picks the best bot
- **Orchestrate**: LLM fan-out to multiple bots in parallel, then synthesis

### Structured Response Types

Claude Code outputs text and artifacts. NexoraKit supports 9 response block types:

| Block Type | Description |
|------------|-------------|
| `text` | Markdown text |
| `code` | Syntax-highlighted code with language tag |
| `table` | Structured data tables |
| `image` | Images with alt text |
| `card` | Title + description + metadata cards |
| `action` | Clickable buttons that trigger tool calls |
| `form` | Input forms with field validation |
| `progress` | Progress bars and status indicators |
| `suggested-replies` | Quick-reply buttons |

Action blocks are particularly notable — they let the agent present interactive buttons that, when clicked, execute a tool call without going through the LLM again. The `ActionRouter` maps action IDs to tool invocations per conversation.

### Conversation Management

Claude Code conversations are ephemeral terminal sessions with optional transcript saving. NexoraKit has full conversation lifecycle management:

- Create, list, get, update, delete conversations via REST API
- Message persistence with full history
- Per-conversation metadata and titles
- Conversation-scoped artifacts with versioning
- File attachments with MIME validation
- Message edit and regenerate (truncate-and-replay)
- User feedback collection (thumbs up/down with analytics)

### End-User Authentication

Claude Code authenticates the developer via Anthropic API key. NexoraKit has a separate end-user identity layer for customer-facing deployments:

| Auth Mode | Mechanism |
|-----------|-----------|
| `anonymous` | `X-End-User-Id` header (no verification) |
| `token` | Bearer token with external ID lookup |
| `jwt` | HS256 JWT verification with `sub` claim |

End users are scoped to agents. Each agent can have different auth config. Rate limits apply per end-user.

### Storage Backends

Claude Code uses local files. NexoraKit supports pluggable storage:

- **SQLite** — zero-config default (better-sqlite3, WAL mode)
- **PostgreSQL** — connection pooling, JSONB, parameterized queries
- **Redis** — message caching, atomic token counters

All backends implement the same store interfaces. Switching backends is a config change.

---

## What Claude Code Has That NexoraKit Doesn't

| Feature | Notes |
|---------|-------|
| **IDE integrations** | VS Code, JetBrains — NexoraKit is server-only |
| **Git worktree isolation** | Sub-agents can work in isolated worktrees |
| **File editing tools** | `Read`, `Write`, `Edit` with permission prompts — NexoraKit tools come from plugins |
| **Permission prompts** | Interactive "allow/deny" per tool call — NexoraKit uses pre-configured permission gates |
| **Hooks** | `PreToolUse`, `PostToolUse`, `SessionStart` lifecycle hooks — planned for NexoraKit |
| **LSP integration** | Language server protocol support from plugins |
| **Output styles** | Plugin-defined terminal output formatting |
| **Auto-memory** | Automatic fact extraction and persistence across sessions |
| **Specialized sub-agent types** | `Explore`, `Plan`, `claude-code-guide` with tool filtering |
| **Conversation resume** | Resume previous sessions with full context |
| **Web search** | Built-in `WebSearch` tool |
| **Keyboard shortcuts & TUI** | Terminal UI with rich key bindings |

Some of these gaps are architectural (IDE integration doesn't apply to a server), some are planned (hooks), and some are solvable via plugins (a file-editing plugin could provide Read/Write/Edit tools).

---

## Design Decisions That Diverge

### 1. Provider Agnosticism vs Claude-Native

Claude Code is built for Claude. Tool schemas, extended thinking, token counting, and prompt engineering are all optimized for Anthropic's models.

NexoraKit abstracts the LLM behind a `LlmProvider` interface:

```typescript
interface LlmProvider {
  chat(request: LlmRequest): AsyncIterable<LlmEvent>;
  readonly modelInfo: ModelInfo;
  readonly tokenizer?: Tokenizer;
}
```

Providers exist for Anthropic, OpenAI, Azure, Ollama, and Bedrock. A `FallbackChain` tries providers in order. A `ModelRouter` routes requests based on model tier (fast/balanced/powerful).

Trade-off: NexoraKit can't rely on Claude-specific features like extended thinking being universally available. Features that depend on model capabilities degrade gracefully when the active provider doesn't support them.

### 2. Tools as Plugins vs Tools as Built-Ins

Claude Code's tools are first-party, hardcoded, and deeply integrated. `Read` understands images and PDFs. `Edit` has carefully tuned error messages. `Bash` has sandbox detection. Each tool is a polished, hand-tuned experience.

NexoraKit's tools come from plugins — there are no built-in user-facing tools (only internal agent tools like `_note_to_self`). This means:

- **Pro**: any capability can be added without modifying the core
- **Pro**: tools are isolated, namespaced, and independently deployable
- **Con**: no tools work out of the box — you need at least one plugin
- **Con**: tool quality depends on plugin authors, not the platform team

### 3. Config Hierarchy vs Convention

Claude Code uses convention and file discovery: `CLAUDE.md` at the project root, `.mcp.json` nearby, skills in well-known directories.

NexoraKit uses explicit hierarchical configuration:

```yaml
# nexora.yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-6
  apiKey: ${ANTHROPIC_API_KEY}

storage:
  backend: sqlite
  path: ./data/nexora.db

plugins:
  directory: ./plugins
```

Three layers merge (instance defaults → plugin config → runtime overrides) and all values are Zod-validated.

### 4. Streaming Architecture

Claude Code streams to a terminal. The output is text — what you see is what the agent produces.

NexoraKit streams structured events over WebSocket (or REST with server-sent events):

```json
{ "type": "turn_start", "turn": 1, "maxTurns": 25 }
{ "type": "text", "content": "Let me " }
{ "type": "text", "content": "look into that." }
{ "type": "tool_status", "toolName": "query", "status": "executing" }
{ "type": "tool_result", "toolName": "query", "result": "..." }
{ "type": "blocks", "blocks": [{ "type": "table", "data": [...] }] }
{ "type": "done" }
```

Clients (web, mobile, other services) consume these events and render them however they want. The agent's output is data, not presentation.

### 5. Security Model

Claude Code trusts the local user and prompts for permission per tool call. The security boundary is the permission prompt.

NexoraKit has layered security:
- **Gateway auth**: API key or JWT for operators
- **End-user auth**: per-agent auth config for customer-facing endpoints
- **Plugin sandboxing**: `PermissionGate` restricts which system resources plugins can access
- **Rate limiting**: per-user, per-endpoint, per-WebSocket-connection
- **CORS**: configurable origin allowlist
- **Audit logging**: every admin action and plugin lifecycle event recorded
- **Tool name sanitization**: prevents injection via special characters in tool names

---

## Plugin Compatibility

NexoraKit can load Claude Code plugins. The `loadClaudePlugin()` adapter reads the Claude directory format and produces a standard `LoadResult`:

```
.claude-plugin/plugin.json  →  PluginManifest
skills/*/SKILL.md            →  SkillDefinition[]
commands/*.md                →  CommandDefinition[]
.mcp.json                   →  McpServerConfig[]
references/*.md              →  Inlined into skill prompts
CONNECTORS.md                →  Plugin documentation
```

`discoverPlugins()` auto-detects both NexoraKit (`plugin.yaml`) and Claude (`.claude-plugin/`) formats. No configuration needed — drop a Claude plugin into the plugins directory and it loads.

### Current Limitations

| Claude Code Feature | NexoraKit Support |
|---------------------|-------------------|
| SKILL.md loading | Supported — parsed and registered as skills |
| References | Supported — content inlined into skill prompts |
| Commands (.md) | Supported — parsed with `prompt` field |
| `.mcp.json` | Supported — mapped to NexoraKit MCP config |
| Scripts (`scripts/*.py`) | Not supported — requires Python runtime |
| Hooks | Not yet supported — planned |
| `allowed-tools` | Not yet supported — planned |
| `context: fork` | Supported via `SubAgentRunner` |
| `model` override | Not yet supported — planned (provider-agnostic tiers) |
| LSP servers | Not supported |
| Output styles | Not supported |

The adapter approach means Claude plugin compatibility improves without downstream changes — all the work happens in the loader.
