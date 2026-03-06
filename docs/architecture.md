# Architecture

## Package Graph

```
                        ┌───────────┐
                        │    cli    │
                        └─────┬─────┘
                              │ wires everything together
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │   api    │   │  admin   │   │ testing  │
        └────┬─────┘   └────┬─────┘   └──────────┘
             │              │
     ┌───────┴───────┐     │
     ▼               ▼     ▼
┌─────────┐   ┌──────────────┐
│websocket│   │   plugins    │──────────┐
└─────────┘   └──────┬───────┘          │
                     │                  ▼
              ┌──────┴──────┐    ┌──────────┐
              ▼             ▼    │   mcp    │
        ┌──────────┐  ┌────────┐└──────────┘
        │  skills  │  │commands│
        └──────────┘  └────────┘
              │
              ▼
        ┌──────────────┐
        │tool-registry │
        └──────┬───────┘
               │
               ▼
        ┌──────────┐
        │   core   │
        └──┬───┬───┘
           │   │
     ┌─────┘   └─────┐
     ▼               ▼
┌─────────┐   ┌──────────┐   ┌──────────┐
│   llm   │   │  config  │   │ sandbox  │
└─────────┘   └──────────┘   └──────────┘
                                    │
                              ┌─────┘
                              ▼
                        ┌──────────┐
                        │ storage  │
                        └──────────┘
```

### Layer Summary

| Layer | Packages | Dependencies |
|-------|----------|-------------|
| Foundation | `llm`, `config`, `sandbox` | No internal deps |
| Core | `core` | llm, config, sandbox |
| Storage | `storage` | None (standalone) |
| Discovery | `tool-registry` | core |
| Extensions | `skills`, `commands`, `mcp` | core |
| Runtime | `plugins` | core, sandbox, config, skills, commands, mcp |
| Presentation | `api`, `admin` | core, plugins, storage |
| Orchestration | `cli` | All packages |
| Frontend | `nexora-frontend` | None (standalone Next.js app) |
| Testing | `testing`, `benchmarks` | core, llm, plugins |

## Request Lifecycle (HTTP — Operator)

```
Operator Request
     │
     ▼
Gateway.handleRequest()
     │
     ├─ Generate/echo X-Request-Id
     ├─ Set CORS headers (resolveCorsOrigin)
     ├─ Route match (Router.match)
     │
     ├─ [public endpoints] → handler directly
     │
     ├─ AuthProvider.authenticate()
     │     ├─ ApiKeyAuth: lookup Bearer token
     │     └─ JwtAuth: verify HS256 signature, check alg/iat
     │
     ├─ RateLimiter.check() → 429 if exceeded
     │
     ├─ parseRequest() → ApiRequest (body size check)
     │
     ├─ RouteHandler (e.g. createChatHandler)
     │     │
     │     ├─ AgentLoop.run(request, signal?)
     │     │     ├─ Build system prompt (SystemPromptBuilder)
     │     │     │     ├─ workspace docs + artifact listing + skill index
     │     │     │     └─ working memory notes + turn reminders
     │     │     ├─ Context compaction (if ≥75% of budget)
     │     │     │     └─ LLM summarizes old messages, keeps recent verbatim
     │     │     ├─ LlmProvider.chat() → stream tokens + thinking
     │     │     ├─ Parallel tool execution (Promise.all)
     │     │     │     ├─ ToolSelector → rank + select tools
     │     │     │     ├─ Sub-agent spawning (_spawn_agent)
     │     │     │     └─ Working memory tools (_note_to_self, _recall)
     │     │     ├─ MessageStore → persist messages
     │     │     └─ Loop until done or max turns (default 25)
     │     │
     │     └─ Stream ChatEvents → ApiResponse
     │
     ├─ MetricsCollector.recordRequest()
     │
     └─ sendResponse() → HTTP response
```

## Request Lifecycle (HTTP — Client API)

```
End-User Request
     │  POST /v1/agents/:slug/conversations/:id/messages
     ▼
Gateway.handleRequest()
     │
     ├─ isClientApiRoute() → true
     ├─ Skip operator auth
     │
     ├─ Client Handler
     │     │
     │     ├─ agentStore.getBySlugGlobal(slug)
     │     ├─ authenticateEndUser(agent.endUserAuth)
     │     │     ├─ anonymous: X-End-User-Id header
     │     │     ├─ token: Bearer prefix + externalId
     │     │     └─ jwt: HS256 verify, sub claim
     │     │
     │     ├─ AgentRateLimiter.check(endUserId)
     │     │
     │     ├─ Resolve orchestration strategy
     │     │     │
     │     │     ├─ [single] → BotRunner(agent.botId)
     │     │     │                 └─ AgentLoop.run()
     │     │     │
     │     │     ├─ [route] → Keyword match bindings
     │     │     │              └─ BotRunner(bestMatch)
     │     │     │
     │     │     └─ [orchestrate] → Orchestrator LLM
     │     │           ├─ Creates ask_<bot> tools
     │     │           ├─ LLM decides which bot(s)
     │     │           ├─ Fan-out: parallel BotRunner calls
     │     │           └─ Synthesize responses
     │     │
     │     └─ Stream events → Response
     │
     └─ sendResponse()
```

## Request Lifecycle (WebSocket)

```
Client Upgrade Request
     │
     ▼
WebSocketManager.handleUpgrade()
     ├─ Verify Upgrade/Connection headers
     ├─ AuthProvider.authenticate()
     ├─ Check per-user connection limit
     ├─ WebSocket handshake (Sec-WebSocket-Accept)
     │
     ▼
WsConnection (persistent)
     │
     ├─ Heartbeat (ping/pong at wsHeartbeatMs interval)
     │
     ├─ Client message → handleData()
     │     ├─ Per-connection rate limit check
     │     ├─ JSON parse → validate schema
     │     ├─ type: "ping" → send pong
     │     └─ type: "chat" → handleChat()
     │           ├─ Check concurrent chat cap
     │           ├─ AgentLoop.run() → yield events
     │           └─ Stream events to client as JSON frames
     │
     └─ Close → cleanup, decrement user connection count
```

## Agent Loop

The agent loop is the core execution engine. It runs a multi-turn conversation between the LLM and the user, executing tools in parallel, managing context through compaction, and spawning sub-agents for complex tasks.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       AgentLoop.run()                        │
│                                                              │
│  ┌─────────────────┐  ┌──────────────┐  ┌───────────────┐   │
│  │ SystemPrompt     │  │ Context      │  │ Working       │   │
│  │ Builder          │  │ Compactor    │  │ Memory        │   │
│  │                  │  │              │  │               │   │
│  │ workspace docs   │  │ LLM-based    │  │ _note_to_self │   │
│  │ artifact listing │  │ summarization│  │ _recall       │   │
│  │ skill index      │  │ atomic group │  │ _save_to_     │   │
│  │ turn reminders   │  │ preservation │  │   memory      │   │
│  └────────┬─────────┘  └──────┬───────┘  └───────┬───────┘   │
│           │                   │                   │           │
│  ┌────────▼───────────────────▼───────────────────▼────────┐ │
│  │                    Turn Loop                             │ │
│  │                                                          │ │
│  │  turn_start → LLM call → parse response                 │ │
│  │    → parallel tool execution (Promise.all)               │ │
│  │    → check: done / max turns / _request_continue         │ │
│  │    → loop                                                │ │
│  └──────────────────────────┬───────────────────────────────┘ │
│                             │                                 │
│  ┌──────────────────────────▼───────────────────────────────┐ │
│  │                  Sub-Agent Pool                           │ │
│  │  _spawn_agent → child AgentLoop (depth ≤ 2)              │ │
│  │  Inherits filtered tools, gets isolated conversation      │ │
│  │  Runs concurrently (max 3 parallel sub-agents)            │ │
│  └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Turn Lifecycle

Each turn follows this sequence:

1. **Emit `turn_start`** with current turn number and max
2. **Assemble system prompt** — base prompt + workspace docs + artifacts + skill index + working memory notes + turn reminders
3. **Check compaction** — if message history ≥ 75% of context budget, the `ContextCompactor` summarizes older messages via a cheap LLM call, keeping the last 4 atomic groups verbatim
4. **Call LLM** — stream text, tool calls, thinking events
5. **Execute tools in parallel** — all tool calls from the LLM response run concurrently via `Promise.all`, each emitting `tool_status` events (executing → completed/error)
6. **Truncate tool results** for message history (default 2000 tokens; full results already streamed to client)
7. **Check completion** — if no tool calls, emit `done`; if max turns reached, emit error; if `_request_continue` was called, grant additional turns and emit `turn_continue`

### Parallel Tool Execution

When the LLM emits multiple tool calls in a single response, they execute concurrently:

```
LLM response: [tool_call A, tool_call B, tool_call C]
                    │              │              │
                    ▼              ▼              ▼
              Promise.all([dispatch(A), dispatch(B), dispatch(C)])
                    │              │              │
                    └──────────────┼──────────────┘
                                   ▼
                    All results returned to LLM in next turn
```

Each tool emits lifecycle events visible to the client:
- `tool_status { status: 'executing' }` — before execution starts
- `tool_status { status: 'completed' | 'error' }` — after execution finishes

### Context Compaction

Hard-truncating old messages loses critical context. The `ContextCompactor` uses an LLM call to summarize older messages into a compressed prefix, preserving key decisions, facts, and tool results.

```
Before compaction:
  [msg 1] [msg 2] ... [msg 18] [msg 19] [msg 20]

After compaction:
  [summary of msgs 1-16] [msg 17] [msg 18] [msg 19] [msg 20]
                          └─────── kept verbatim ──────────┘
```

Key design:
- **Atomic groups** — an assistant message with tool calls and its tool results are never split. `buildAtomicGroups()` ensures coherent units for both truncation and compaction.
- **Cheap model** — compaction auto-selects the cheapest available model (smallest context window) from the LLM provider to minimize cost.
- **Trigger ratio** — configurable, defaults to 75% of `maxContextTokens`.
- **Fallback** — if compaction is not configured, the system falls back to hard truncation (drop oldest atomic groups).

### Working Memory

Three built-in tools give the agent a persistent scratchpad within a conversation:

| Tool | Purpose |
|------|---------|
| `_note_to_self` | Save a fact or plan for later turns (survives compaction) |
| `_recall` | Retrieve all saved notes for the current conversation |
| `_save_to_memory` | Promote a fact to permanent cross-conversation user memory |

Working memory notes are injected into the system prompt each turn under a `## Working Memory` section, ensuring the agent always has access to its own notes even after context compaction.

`_save_to_memory` is only available when a `UserMemoryStoreInterface` is configured, and writes to the per-user persistent store (namespace-scoped).

### Sub-Agent Spawning

For complex, multi-step tasks, the agent can delegate independent subtasks to child agents via the `_spawn_agent` tool:

```
Parent Agent (depth 0)
     │
     ├─ _spawn_agent("research API options")
     │        └─ Child Agent (depth 1)
     │             ├─ Uses parent's tools (filtered)
     │             ├─ Gets isolated conversation
     │             └─ Returns text result + token usage
     │
     ├─ _spawn_agent("draft implementation plan")
     │        └─ Child Agent (depth 1)
     │
     └─ Integrates both results into response
```

Constraints:
- **Max depth:** 2 (configurable). Sub-agents at max depth cannot spawn further children.
- **Max concurrent:** 3 (configurable). Siblings share the concurrency counter.
- **Tool filtering:** Internal tools (`_note_to_self`, `_recall`, etc.) are available to children. `_spawn_agent` is excluded at max depth - 1.
- **Isolation:** Each sub-agent gets a fresh conversation. No shared message history with the parent.
- **Events:** `sub_agent_start` and `sub_agent_end` events are emitted for client visibility.

### Turn Management

The default turn limit is 25 (up from 10 in earlier versions). Two mechanisms prevent premature termination:

**Adaptive turns (`_request_continue`):** When the agent is within 2 turns of the limit, a special `_request_continue` tool is dynamically registered. Calling it grants additional turns (default +10) and emits a `turn_continue` event. This is one-shot — the tool is unregistered after use to prevent infinite loops.

**Turn reminders:** The `SystemPromptBuilder` injects turn-awareness into the system prompt:
- Turn 1: guidance on available tools
- Near limit: "[Turn X/Max] You have N turn(s) remaining. Prioritize completing your current task."

### System Prompt Assembly

The system prompt is rebuilt each turn from these components (in order):

```
1. Workspace context docs (budget-capped, priority-ordered)
2. Base system prompt (tool usage guidance, reasoning patterns)
3. Command prompt (if a prompt-based /command was invoked)
4. Artifact listing (titles + versions of conversation artifacts)
5. Skill index (per-namespace tool summaries for progressive disclosure)
6. Working memory section (saved notes + turn reminders)
```

The default system prompt teaches the agent to:
- Reason step-by-step and use `_note_to_self` for planning
- Use tools proactively rather than guessing
- Try alternatives when a tool call fails
- Be direct and transparent about what it's doing

### Event Stream

`AgentLoop.run()` yields an `AsyncIterable<ChatEvent>`. The full event vocabulary:

| Event | Description |
|-------|-------------|
| `turn_start` | Beginning of a new turn (includes turn number + max) |
| `text` | Streamed text token from the LLM |
| `thinking` | Extended thinking / reasoning from the LLM |
| `tool_call` | LLM requested a tool invocation |
| `tool_status` | Tool execution lifecycle (executing → completed / error) |
| `tool_result` | Full tool output (before truncation for history) |
| `blocks` | Structured response blocks (cards, tables, forms, etc.) |
| `artifact_create` | New artifact created (empty, followed by stream chunks) |
| `artifact_stream` | Artifact content chunk |
| `artifact_update` | Existing artifact updated |
| `artifact_done` | Artifact streaming complete |
| `turn_continue` | Additional turns granted via `_request_continue` |
| `compaction` | Context was compacted (includes message count + summary tokens) |
| `sub_agent_start` | Sub-agent spawned (includes task description) |
| `sub_agent_end` | Sub-agent completed (includes token usage) |
| `usage` | Token usage for the turn |
| `error` | Error occurred (includes code) |
| `cancelled` | Run was cancelled via AbortSignal |
| `done` | Run completed |

## Context Budget

NexoraKit carefully allocates the model's context window across competing needs. The `ContextBudget` class computes how many tokens each component gets.

### Budget Allocation

```
┌──────────────────────────────────────────────────┐
│              Model Context Window                 │
│                                                   │
│  ┌────────────┐                                   │
│  │  Reserved   │  maxOutputTokens (from ModelInfo) │
│  │  Output     │                                   │
│  └────────────┘                                   │
│  ┌────────────┐                                   │
│  │  System     │  base prompt + workspace docs     │
│  │  Prompt     │  + artifacts + skill index        │
│  └────────────┘                                   │
│  ┌────────────┐                                   │
│  │  Tools      │  tool definitions (JSON schema)   │
│  └────────────┘                                   │
│  ┌────────────┐                                   │
│  │  Messages   │  conversation history (remainder) │
│  └────────────┘                                   │
└──────────────────────────────────────────────────┘
```

The `maxContextTokens` ceiling is auto-derived from the model:

```
maxContextTokens = contextWindow − maxOutputTokens − toolTokenBudget
```

If not derivable (e.g., custom provider), falls back to 100,000 tokens.

### Adaptive Tool Budget

When conversation history grows large, the tool budget shrinks to make room:

- Messages ≤ 70% of available → full tool budget
- Messages at 90% of available → 30% of tool budget
- Smooth linear scale between those points

This prevents long conversations from hitting context limits by gracefully reducing the number of tool definitions sent to the LLM.

### Tool Result Truncation

Tool results are handled at two levels:

1. **Event stream** — full, untruncated result yielded as `tool_result` event (client sees everything)
2. **Message history** — truncated to `maxToolResultTokens` (default 2000) at the nearest line boundary, with a truncation notice appended

This keeps conversation history lean without hiding information from the client.

### Component Budgets

| Component | Default | Config Key |
|-----------|---------|------------|
| Workspace docs | 2000 tokens | `workspaceBudget` |
| Artifact listing | 500 tokens | `artifactBudget` |
| Skill index | 500 tokens | `skillIndexBudget` |
| Tool definitions | 4000 tokens | `toolBudget` |
| Tool results (in history) | 2000 tokens | `maxToolResultTokens` |

## Plugin State Machine

```
          install()
    ┌──────────────────┐
    │                  ▼
    │            ┌──────────┐
    │            │installed │
    │            └────┬─────┘
    │                 │ enable()
    │                 ▼
    │            ┌──────────┐
    │            │ enabled  │◄──── reload()
    │            └────┬─────┘      (uninstall → load → install → enable)
    │                 │ disable()
    │                 ▼
    │            ┌──────────┐
    │            │ disabled │
    │            └────┬─────┘
    │                 │ uninstall()
    │                 ▼
    └───────────  (removed)
```

On enable: tools registered, skills activated, MCP servers started.
On disable: tools unregistered, skills deactivated, MCP servers stopped.
AdminService wraps these transitions with audit logging.

## Storage Backends

```
                    ┌─────────────────────┐
                    │  StorageBackend      │
                    │  (factory interface) │
                    └─────────┬───────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │  SQLite  │   │ Postgres │   │  Redis   │
        │(default) │   │(optional)│   │(optional)│
        └──────────┘   └──────────┘   └──────────┘
```

All backends implement store interfaces:

**Platform stores:** `IMessageStore`, `IConfigStore`, `IPluginStateStore`, `ITokenUsageStore`, `IUsageEventStore`, `IAuditEventStore`

**Deployment stores:** `IBotStore`, `IAgentStore`, `IAgentBotBindingStore`, `IEndUserStore`, `IConversationStore`

**SQLite** — default, zero-config. Uses `better-sqlite3` with WAL mode. Single-file database.

**PostgreSQL** — optional (`pg` peer dep). Connection pooling, JSONB storage, parameterized queries. Activated via `storage.backend: 'postgres'` in config.

**Redis** — optional (`ioredis` peer dep). `RedisMemoryStore` (message lists) and `RedisTokenUsageStore` (atomic counters). Useful as a caching layer alongside Postgres.

Factory: `createStorageBackend(config)` instantiates the appropriate backend based on config type.

## Tool Selection

The ToolSelector uses a weighted scoring algorithm to select the most relevant tools for each request:

| Signal | Weight | Description |
|--------|--------|-------------|
| Keyword | 0.4 | Fuzzy keyword matching on tool name/description |
| Recency | 0.3 | Recent usage boosts score |
| Context | 0.3 | Active plugin namespace matching |
| Embedding | 0.0* | Cosine similarity of vector embeddings |

*Embedding weight defaults to 0 (off). Set via `ToolSelectorOptions.weights.embedding` when an `EmbeddingProvider` is configured. The `selectAsync()` method enables hybrid keyword + embedding search.

Supported embedding providers:
- `TransformerEmbeddingProvider` — local inference via `@xenova/transformers` (MiniLM-L6-v2)
- `LlmEmbeddingProvider` — wraps any `(text) => Promise<number[]>` callback

## Agent / Bot Orchestration

Bots are capability profiles (system prompt, model, plugins). Agents are deployment profiles (slug, auth, rate limits) that reference bots. See [Agents and Bots](agents-and-bots.md) for full details.

```
                    ┌──────────────────────────┐
                    │         Agent             │
                    │  slug, auth, rate limits  │
                    └────────────┬─────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                   │
         [single]            [route]          [orchestrate]
              │                  │                   │
              ▼                  ▼                   ▼
         BotRunner          Keyword Match      Orchestrator LLM
         (1 bot)            → BotRunner        → N × BotRunner
                            (best match)       → Synthesize
```

**BotRunner** wraps `AgentLoop` with bot-specific config (model, prompt, plugins, temperature). It preserves streaming and provides `runToCompletion()` for orchestrator fan-out.

**Orchestrator** creates `ask_<botname>` tools from bindings, lets the LLM decide which bots to invoke, runs them in parallel via `Promise.all()`, and synthesizes multi-bot responses.
