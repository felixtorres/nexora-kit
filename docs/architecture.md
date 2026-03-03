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
| Testing | `testing` | core, llm, plugins |

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
     │     ├─ AgentLoop.run()
     │     │     ├─ ContextManager → build context
     │     │     ├─ LlmProvider.chat() → stream tokens
     │     │     ├─ ToolDispatcher → execute tool calls
     │     │     │     └─ ToolSelector → rank + select tools
     │     │     └─ MessageStore → persist messages
     │     │
     │     └─ Collect events → ApiResponse
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
