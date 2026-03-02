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

## Request Lifecycle (HTTP)

```
Client Request
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
     │     │     └─ MemoryStore → persist messages
     │     │
     │     └─ Collect events → ApiResponse
     │
     ├─ MetricsCollector.recordRequest()
     │
     └─ sendResponse() → HTTP response
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

All backends implement 6 store interfaces: `IMemoryStore`, `IConfigStore`, `IPluginStateStore`, `ITokenUsageStore`, `IUsageEventStore`, `IAuditEventStore`.

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
