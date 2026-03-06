# Changelog

All notable changes to NexoraKit are documented in this file.

## [Unreleased]

### Fixed
- Lint errors in `@nexora-kit/llm` (missing error causes, useless assignments)
- Lint errors in `@nexora-kit/core` (unused vars/imports in tests, dead code in orchestrator)
- Lint errors in `@nexora-kit/nexora-frontend` (React compiler rules: refs during render, impure render, circular useCallback)

### Documentation
- Fixed incorrect API paths: bot/agent admin routes now correctly documented as `/v1/admin/bots` and `/v1/admin/agents`
- Added 33 missing endpoints to API reference (files, workspaces, templates, feedback, memory, artifacts, message edit/regenerate)
- Expanded OpenAPI spec from 15 to 68 operations with full component schemas
- Added `nexora-frontend` and `benchmarks` to package tables in README and architecture docs
- Created CHANGELOG

---

## Post-v1 Features

### Context Budget & Global Tools (2026-03-04)
- Model-aware context ceiling (`maxContextTokens` derived from `ModelInfo`)
- Tool result truncation (`maxToolResultTokens`, default 2000)
- Skill index token budget with overflow summaries
- `ContextBudget` class with adaptive tool budget (shrinks when messages >70%)
- `Tokenizer` interface with `HeuristicTokenizer` fallback; all 3 providers implement it
- Single global `get_skill_context` tool (refcounted, replaces per-plugin tools)
- **Tests:** 1496 total (+12)

### Skill Context Injection (2026-03-04)
- `buildSkillIndex()` — compact markdown index per namespace
- `SkillIndexAdapter` bridges SkillRegistry to `SkillIndexProvider`
- `get_skill_context` tool auto-registered on plugin enable
- Plugin docs via `CONNECTORS.md` (fallback `README.md`)
- Config toggle: `skillIndex: false` disables per-plugin
- **Tests:** 1390 total (+6)

### Deferred Items (2026-03-03)
- **Artifact streaming:** `chunkArtifactContent()`, create → stream → done events
- **Artifact context injection:** `buildArtifactPrompt()`, loaded once per agent loop run
- **SkillContext.workspace:** `ToolExecutionContext` threaded through dispatcher
- **WS client streaming:** `ClientWebSocketManager`, end-user auth, agent-scoped rate limits
- **Tests:** 1384 total (+48)

### F11: Workspace Context
- `WorkspaceContextProvider` with budget-capped document injection and priority ordering
- **Tests:** 1336 total

### F10: Streaming Cancellation
- AbortSignal integration, partial response storage

### F9: Message Edit & Regenerate
- Truncate-and-replay for both edit and regenerate
- Feedback cleanup on truncated messages

### F8: System Prompts & Templates
- Per-conversation persona templates, admin CRUD (5 endpoints)

### F7: Artifacts
- Versioned document artifacts with ArtifactStoreInterface
- 5 REST endpoints (list, get, versions, get version, delete)

### F6: Feedback Collection
- Thumbs up/down, comment, tags
- Admin query with pagination, summary aggregation, cascade delete

### F5: File Attachments
- Upload (base64), local storage backend, MIME validation
- 5 REST endpoints (upload, get, download, delete, conversation files)

### F4: User Memory
- Per-user facts with namespace scoping, bot-scoped storage
- 3 REST endpoints (list, delete key, delete all)

### F3: Structured Response Types (2026-03-02)
- 9 block types: text, code, table, image, card, action, form, progress, suggested_replies, custom
- `ToolHandler` widened to `Promise<string | ToolHandlerResponse>`
- `ActionRouter` for action callback routing (bypasses LLM)
- `ProgressBlock` transient (yielded, not stored), `MAX_BLOCKS_PER_MESSAGE=20`
- **Tests:** 1039 total

### F2: Agents, Bots & Client API (2026-03-02)
- **Bot** = config profile (system prompt, model, plugins, temperature)
- **Agent** = deployment profile (slug, auth, rate limits, orchestration)
- 3 orchestration strategies: single, route (keyword), orchestrate (LLM fan-out)
- `BotRunner` wraps AgentLoop with bot-specific config
- `Orchestrator` creates `ask_<bot>` tools, parallel fan-out, response synthesis
- End-user auth: anonymous, token, JWT (HS256)
- Admin API: 12 handlers (bot CRUD, agent CRUD, bindings, end-users)
- Client API: 5 endpoints at `/v1/agents/:slug/*`
- **Tests:** 1060 total (+148)

### F1: Conversation Management (2026-03-02)
- **Breaking:** `Session→Conversation`, `MemoryStore→MessageStore`, `sessionId→conversationId`
- **Breaking:** `ChatRequest.input: ChatInput` union (string | text | action | file)
- **Breaking:** `AgentLoop.run(request, signal?)` signature
- 19-table schema (7 core + 12 future-proof)
- 6 conversation REST endpoints + legacy `POST /v1/chat` kept
- OpenAPI v2, WebSocket cancel + envelope format
- **Tests:** 912 total

---

## v1 Platform

### Security Hardening — Phase 9 (2026-03-03)
- CORS origin config, correlation IDs (X-Request-Id)
- JWT hardening: algorithm whitelist (HS256 only), iat validation, key rotation
- WebSocket rate limits (per-connection, concurrent chats, per-user connections)
- Configurable body size limit
- **Tests:** 730 total (+16)

### PostgreSQL & Redis — Phase 10 (2026-03-03)
- 6 store interfaces with `T | Promise<T>` for sync/async compatibility
- 6 PostgreSQL stores (connection pooling, JSONB, parameterized queries)
- 2 Redis stores (message lists, atomic token counters)
- `createStorageBackend()` factory
- **Tests:** 768 total (+38)

### Embedding Search & OpenAPI — Phase 11 (2026-03-03)
- `EmbeddingProvider` interface with cosine similarity
- `TransformerEmbeddingProvider` (MiniLM-L6-v2 local inference)
- `LlmEmbeddingProvider` (custom callback wrapper)
- Hybrid `ToolSelector.selectAsync()` (keyword + embedding)
- OpenAPI 3.1 spec at `/v1/openapi.json`
- Benchmarks package
- **Tests:** 783 total (+15)

### Documentation & Deployment — Phase 12 (2026-03-03)
- 6 docs: getting-started, architecture, security, API reference, plugin development, agents-and-bots
- Helm chart (`deploy/helm/nexora-kit/`), 8 templates, lint clean
- Dockerfile (multi-stage, node:20-alpine, tini)
- docker-compose.yml

### MCP Server Manager — Phase 4 (2026-03-01)
- `@nexora-kit/mcp`: types, YAML parser, circuit breaker, transports (stdio + SSE)
- Server handle, health monitor (auto-restart), MCP manager (orchestrator + tool routing)
- Plugin integration: loader discovers `mcp/mcp.yaml`, lifecycle starts/stops on enable/disable
- No external MCP SDK — lightweight JSON-RPC over stdio/SSE
- **Tests:** 485 total (+98)

### Claude Plugin Compatibility (2026-03-01)
- `HttpTransport` for POST-based JSON-RPC
- `parseMdCommand` for markdown frontmatter commands
- `loadClaudePlugin` + `isClaudePlugin` adapter
- `discoverPlugins()` auto-detects nexora and Claude plugin formats
- **Tests:** 515 total (+30)

### REST + WebSocket Gateway — Phase 5 (2026-03-02)
- `@nexora-kit/api`: types, auth (API key + JWT), rate limiting, router, handlers
- WebSocket: RFC 6455, frame encode/decode, heartbeat, streaming
- Gateway: HTTP server + WS upgrade + auth + rate limit + CORS
- Zero external HTTP framework deps (Node `http` module)
- **Tests:** 585 total (+70)

### Admin & Audit — Phase 6 (2026-03-02)
- `@nexora-kit/admin`: AuditLogger, UsageAnalytics, AdminService
- 6 admin endpoints: plugin enable/disable/uninstall, audit-log query/purge, usage analytics
- `requireAdmin()` guard
- **Tests:** 632 total (+47)

### CLI — Phase 7 (2026-03-02)
- `@nexora-kit/cli`: 10 initial commands, zero external CLI deps
- `init`, `serve`, `plugin init/add/dev/test/validate`, `config get/set`, `admin usage`
- Custom arg parser (positionals, `--flag=value`, aliases, booleans, `--no-*`)
- **Tests:** 678 total (+46)

### Testing & Hardening — Phase 8 (2026-03-02)
- `@nexora-kit/testing`: e2e harness, 11 e2e tests
- Example plugins: faq-bot, onboarding-assistant
- `JsonLogger` + `NoopLogger`, structured JSON logging
- `MetricsCollector` (uptime, request counts, p95 latency), `/v1/metrics` endpoint
- Security audit: 11 findings, 4 fixed (path traversal, auth bypass, URI decode, content-type)
- **Tests:** 714 total (+36)

### Plugins — Phase 2 (2026-02-28)
- `@nexora-kit/plugins`: manifest (Zod + YAML), namespace isolation, dependency resolution (Kahn's), error boundary, loader, PluginLifecycleManager
- `@nexora-kit/tool-registry`: keyword scorer, token estimator, ToolIndex, ToolSelector (keyword 0.4 + recency 0.3 + context 0.3)
- Observability hooks: NoopObservability, LangfuseObservability
- **Tests:** 219 total (+138)

### Skills & Commands — Phase 3 (2026-02-28)
- `@nexora-kit/skills`: types, define-skill, YAML/MD parsers, template engine, SkillRegistry, SkillHandlerFactory
- `@nexora-kit/commands`: types, YAML parser, CommandParser (named/positional/alias args, type coercion, enum validation), CommandRegistry, CommandDispatcher
- `/namespace:command` preprocessing in AgentLoop (bypasses LLM)
- **Tests:** 334 total (+101)

### Storage & Hot Reload (2026-03-01)
- `@nexora-kit/storage`: SQLite via better-sqlite3 — 7 stores (messages, config, plugin state, token usage, usage events, audit events)
- Plugin hot-reload: `reload()` on PluginLifecycleManager, `PluginDevWatcher` (fs.watch, 300ms debounce, AbortSignal)
- **Tests:** 387 total (+53)

### Core Platform — Phase 1 (2026-02-27)
- `@nexora-kit/core`: AgentLoop, ContextManager, ToolDispatcher, InMemoryMessageStore
- `@nexora-kit/llm`: LlmProvider interface, Anthropic provider, ModelRouter, FallbackChain, TokenBudget
- `@nexora-kit/config`: 3-layer ConfigResolver + Zod validation
- `@nexora-kit/sandbox`: PermissionGate, ResourceLimiter, CodeExecutor
- **Tests:** 81 total

---

## Breaking Changes

### F1: Conversation Management (v2.0)
- `Session` → `Conversation` (all types, stores, API fields)
- `MemoryStore` → `MessageStore`
- `sessionId` → `conversationId` (everywhere)
- `ChatRequest.input` changed from `string` to `ChatInput` union
- `SkillResult.output` changed from `string` to `string | ResponseBlock[]`
- `AgentLoop.run()` signature: `run(request, signal?)` instead of `run(message, options)`
- `POST /v1/chat` deprecated in favor of `POST /v1/conversations/:id/messages`

### Context Budget & Global Tools
- `get_skill_context` changed from per-plugin (`{ns}:get_skill_context`) to single global tool with `namespace` param
