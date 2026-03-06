# NexoraKit Hardening Tasks

Issues identified during the March 5, 2026 architecture review.
Prioritized for tackling in future sessions.

---

## P0 — Security & Cost Control

### 1. Sub-agent token accounting is uncapped
**Package:** `core` (`sub-agent.ts`, `agent-loop.ts`)
**Problem:** Sub-agents run with their own AgentLoop and don't consume from the parent's token budget. A recursive or parallel sub-agent chain can generate unlimited LLM cost with no guardrail.
**Fix:** Pass the parent's `TokenBudget` instance into sub-agents. Each sub-agent `consume()` call should debit from the shared budget. Abort the sub-agent if budget is exhausted.

### 2. Plugin sandbox resource limits not enforced
**Package:** `sandbox` (`resource-limiter.ts`), `plugins` (`lifecycle.ts`)
**Problem:** `PermissionGate.check()` gates tool access, but `ResourceLimiter` (memory, CPU, timeout) exists as dead code — it's never wired into plugin tool execution. A misbehaving plugin handler can hog the event loop or leak memory.
**Fix:** Wrap plugin tool handlers in `ResourceLimiter.execute()` during `lifecycle.enable()`. Respect the `sandbox.limits` from the plugin manifest (memoryMb, timeoutMs). Kill handlers that exceed limits.

---

## P1 — Reliability

### 3. Action router memory leak
**Package:** `core` (`action-router.ts`, `agent-loop.ts`)
**Problem:** `ActionRouter` accumulates action-to-tool mappings per conversation and never cleans them up. Over a long-running server with many conversations, this grows unbounded.
**Fix:** Add `ActionRouter.clearConversation(id)` and call it when a conversation is deleted. Also consider an LRU eviction policy or TTL per conversation entry.

### 4. No cost estimation before compaction
**Package:** `core` (`compaction.ts`)
**Problem:** Compaction triggers an LLM summarization call when context exceeds 75% of budget. There's no cost check — if the cheap model is unavailable or misconfigured, it falls through to an expensive model silently.
**Fix:** Before compaction, estimate the summarization cost (input tokens of messages to compact). Log a warning if cost exceeds a configurable threshold. Optionally skip compaction and fall back to hard truncation if budget is tight.

### 5. WebSocket per-connection rate limiting
**Package:** `api` (`websocket.ts`)
**Problem:** Rate limiting is global (per-user, per-endpoint) but not per-WebSocket-connection. A single connection sending rapid messages can monopolize the agent loop for that user.
**Fix:** Track message count per WebSocket connection with a sliding window. Reject or queue messages that exceed the per-connection limit. Send a `rate_limited` event to the client.

---

## P2 — Scalability

### 6. Tool selection O(n) scan won't scale
**Package:** `tool-registry` (`tool-selector.ts`, `tool-index.ts`)
**Problem:** Keyword matching scans all registered tools linearly. At 1000+ tools (realistic for team deployments with many plugins), this runs on every LLM turn and becomes a latency bottleneck.
**Fix options:**
- Pre-build an inverted index (keyword -> tool list) on tool registration
- Cluster tools by namespace/category and search within clusters
- Cache top-K results per query with TTL invalidation
- Profile first — measure actual latency at 500/1000/2000 tools before optimizing

---

## P3 — Operational Polish

### 7. Conversation cleanup cascade
**Package:** `storage`, `core`
**Problem:** Deleting a conversation should cascade to: action router entries, working memory notes, artifact references, file associations. Currently only messages are cleaned up.
**Fix:** Add a `ConversationCleanup` service that orchestrates deletion across all stores. Call it from the DELETE conversation API handler.

### 8. Plugin hot-reload stability
**Package:** `plugins` (`lifecycle.ts`)
**Problem:** `reload()` does uninstall + re-load + re-enable. If the re-load fails (bad YAML, missing file), the plugin is gone with no rollback.
**Fix:** Load the new version into a staging area first. Only swap if load succeeds. Keep the old version running on failure and report the error.

### 9. MCP health monitoring adaptive backoff
**Package:** `mcp` (`health-monitor.ts`, `circuit-breaker.ts`)
**Problem:** Circuit breaker uses fixed thresholds and recovery windows. No distinction between transient errors (timeout) and permanent errors (auth failure). Recovery is binary (open -> closed).
**Fix:** Classify error types. Use exponential backoff for transient errors. Mark permanent errors as requiring manual intervention. Add half-open probing before full recovery.

---

## Done (this session)

- [x] **Removed per-tool-result truncation** — MCP tool results (and all tool results) are no longer truncated before being stored in conversation history. Context compaction and `ContextManager.truncate()` handle the overall budget. This fixed the dbinsight `generate_context` returning "0 tables" in Nexora while working in other tools.
