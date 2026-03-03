# API Reference

NexoraKit exposes a REST + WebSocket API. The full OpenAPI 3.1 spec is available at `GET /v1/openapi.json` on any running instance.

## Base URL

Default: `http://localhost:3000/v1`

Configurable via `apiPrefix` in `GatewayConfig` (default: `/v1`).

## Authentication

NexoraKit has two auth layers:

- **Operator auth** — API key or JWT for team members managing the platform
- **End-user auth** — anonymous, token, or JWT for customers using agents (see [Agents and Bots](agents-and-bots.md#end-user-authentication))

System endpoints (health, OpenAPI spec) require no auth. Client API endpoints (`/v1/agents/:slug/*`) use end-user auth. All other endpoints require operator auth.

### API Key

Pass in the `Authorization` header:

```
Authorization: Bearer <api-key>
```

Keys are configured in `nexora.yaml`:

```yaml
auth:
  type: api-key
  keys:
    - key: my-key
      userId: user1
      teamId: default
      role: user
    - key: admin-key
      userId: admin1
      teamId: default
      role: admin
```

### JWT

For programmatic access, JwtAuth supports HMAC-SHA256 tokens:
- Algorithm must be `HS256` (other algorithms are rejected)
- Tokens with `iat` in the future (>30s tolerance) are rejected
- Key rotation: configure multiple secrets — the first valid match is accepted

## Endpoints

### System

#### `GET /v1/health`
Health check. No auth required.

**Response:** `200`
```json
{ "status": "healthy" }
```

#### `GET /v1/metrics`
Request metrics. Requires auth by default (`publicMetrics: false`). Set `publicMetrics: true` in config to make public.

**Response:** `200`
```json
{
  "uptime_seconds": 3600,
  "requests_total": 1500,
  "requests_by_status": { "200": 1400, "401": 50, "500": 50 },
  "requests_by_method": { "GET": 800, "POST": 700 },
  "active_connections": 5,
  "avg_latency_ms": 12,
  "p95_latency_ms": 45
}
```

#### `GET /v1/openapi.json`
OpenAPI 3.1 specification. No auth required.

### Chat (Legacy)

#### `POST /v1/chat`
Send a message directly to the agent loop. This is the legacy v1 endpoint — for new integrations, use the [Client API](#client-api-end-users) instead.

**Request:**
```json
{
  "message": "How do I reset my password?",
  "conversationId": "optional-conversation-id",
  "pluginNamespaces": ["faq"],
  "metadata": {}
}
```

**Response:** `200`
```json
{
  "message": "To reset your password, go to Settings > Security...",
  "conversationId": "conv-abc123",
  "events": [
    { "type": "text", "content": "To reset your password..." },
    { "type": "done" }
  ]
}
```

### Plugins

#### `GET /v1/plugins`
List installed plugins.

**Response:** `200`
```json
{
  "plugins": [
    { "namespace": "faq", "name": "faq-bot", "version": "1.0.0", "state": "enabled" }
  ]
}
```

#### `GET /v1/plugins/:name`
Get plugin details.

**Response:** `200`
```json
{
  "namespace": "faq",
  "name": "faq-bot",
  "version": "1.0.0",
  "description": "A knowledge-base FAQ bot",
  "state": "enabled",
  "tools": [{ "name": "answer-question" }]
}
```

### Bots (requires `role: admin`)

See [Agents and Bots](agents-and-bots.md) for concept details.

#### `POST /v1/bots`
Create a bot.

**Request:**
```json
{
  "name": "Support Bot",
  "systemPrompt": "You are a helpful support agent...",
  "model": "claude-sonnet-4-6",
  "description": "Handles general support queries",
  "pluginNamespaces": ["faq", "knowledge-base"],
  "temperature": 0.7,
  "maxTurns": 10,
  "workspaceId": null,
  "metadata": {}
}
```

Required fields: `name`, `systemPrompt`, `model`.

**Response:** `201` — the created `BotRecord`.

#### `GET /v1/bots`
List all bots for the authenticated user's team.

#### `GET /v1/bots/:id`
Get a bot by ID.

#### `PATCH /v1/bots/:id`
Update a bot. Send only the fields to change.

**Request:**
```json
{
  "systemPrompt": "Updated prompt...",
  "temperature": 0.5
}
```

#### `DELETE /v1/bots/:id`
Delete a bot.

### Agents (requires `role: admin`)

#### `POST /v1/agents`
Create an agent.

**Request:**
```json
{
  "slug": "customer-support",
  "name": "Customer Support",
  "orchestrationStrategy": "orchestrate",
  "orchestratorModel": "claude-sonnet-4-6",
  "orchestratorPrompt": "You coordinate between specialist bots...",
  "botId": null,
  "fallbackBotId": "<bot-id>",
  "endUserAuth": { "mode": "anonymous" },
  "rateLimits": { "messagesPerMinute": 30 },
  "appearance": {
    "displayName": "Support Assistant",
    "welcomeMessage": "How can I help?"
  },
  "features": { "artifacts": true, "feedback": true },
  "enabled": true
}
```

Required fields: `slug`, `name`.

**Response:** `201` — the created `AgentRecord`.

#### `GET /v1/agents`
List all agents for the authenticated user's team.

#### `GET /v1/agents/:id`
Get an agent by ID, including its bindings.

#### `PATCH /v1/agents/:id`
Update an agent. Send only the fields to change.

#### `DELETE /v1/agents/:id`
Delete an agent and clean up its bindings.

#### `PUT /v1/agents/:id/bindings`
Replace all bot bindings for an agent. This is atomic — all existing bindings are removed and replaced with the new list.

**Request:**
```json
{
  "bindings": [
    {
      "botId": "<billing-bot-id>",
      "priority": 2,
      "description": "Billing and payment queries",
      "keywords": ["bill", "invoice", "payment", "refund"]
    },
    {
      "botId": "<tech-bot-id>",
      "priority": 1,
      "description": "Technical support",
      "keywords": ["bug", "error", "crash", "how to"]
    }
  ]
}
```

All `botId` references are validated — the request fails if any bot doesn't exist.

#### `GET /v1/agents/:id/end-users`
List end users for an agent.

### Admin — Plugins (requires `role: admin`)

#### `POST /v1/admin/plugins/:name/enable`
Enable a plugin.

#### `POST /v1/admin/plugins/:name/disable`
Disable a plugin.

#### `DELETE /v1/admin/plugins/:name`
Uninstall a plugin.

#### `GET /v1/admin/audit-log`
Query audit events.

**Query params:** `actor`, `action`, `since` (ISO 8601), `limit`

#### `POST /v1/admin/audit-log/purge`
Purge audit events older than N days.

**Request:** `{ "olderThanDays": 30 }`

#### `GET /v1/admin/usage`
Query usage analytics.

**Query params:** `breakdown` (`plugin` | `daily`), `since` (ISO 8601), `pluginName`

### Client API (End Users)

These endpoints are routed by agent slug and use [end-user authentication](agents-and-bots.md#end-user-authentication) instead of operator auth.

#### `GET /v1/agents/:slug`
Get agent appearance and public info. Used by client UIs to render the chat interface.

#### `POST /v1/agents/:slug/conversations`
Create a new conversation.

**Headers:** End-user auth (varies by agent config — see [auth modes](agents-and-bots.md#end-user-authentication))

**Response:** `201`
```json
{
  "id": "conv-abc123",
  "agentId": "<agent-id>",
  "createdAt": "2026-03-03T10:00:00Z"
}
```

#### `GET /v1/agents/:slug/conversations`
List the authenticated end user's conversations.

#### `GET /v1/agents/:slug/conversations/:id`
Get a conversation by ID.

#### `POST /v1/agents/:slug/conversations/:id/messages`
Send a message in a conversation. The agent processes it through its orchestration strategy and returns a response.

**Request:**
```json
{
  "input": { "type": "text", "text": "I need help with my invoice" }
}
```

**Response:** `200` — streamed events:
```json
{ "type": "text", "content": "I'd be happy to help with your invoice..." }
{ "type": "done" }
```

### Conversations (Operator)

Operators can also manage conversations directly (team-scoped):

#### `POST /v1/conversations`
Create a conversation.

#### `GET /v1/conversations`
List conversations.

#### `GET /v1/conversations/:id`
Get a conversation.

#### `PATCH /v1/conversations/:id`
Update conversation metadata.

#### `DELETE /v1/conversations/:id`
Delete a conversation and its messages.

#### `POST /v1/conversations/:id/messages`
Send a message in a conversation (operator context, no bot orchestration).

## WebSocket

### Operator WebSocket

Upgrade at the server root. Authentication is performed during the upgrade handshake.

```
GET / HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Authorization: Bearer <api-key>
```

**Client → Server:**

```json
{ "type": "chat", "message": "Hello", "conversationId": "optional" }
{ "type": "cancel", "conversationId": "conv-123" }
{ "type": "ping" }
```

**Server → Client:**

```json
{ "type": "text", "content": "Hello! How can I help?" }
{ "type": "tool_call", "name": "search", "input": { "query": "..." } }
{ "type": "tool_result", "name": "search", "output": { "results": [...] } }
{ "type": "done" }
{ "type": "error", "message": "Something went wrong" }
{ "type": "pong" }
```

### Client WebSocket

End users connect via the agent slug:

```
GET /v1/agents/:slug/ws HTTP/1.1
Upgrade: websocket
Connection: Upgrade
```

End-user auth is performed during the upgrade (same mode as the agent's HTTP endpoints). Messages follow the same format as the operator WebSocket but are scoped to the agent's orchestration strategy and rate limits.

### Rate Limits

WebSocket connections support configurable rate limits:
- `wsMaxMessagesPerMinute` — sliding window per connection (default: unlimited)
- `wsMaxConcurrentChats` — max parallel chat sessions per connection (default: unlimited)
- `wsMaxConnectionsPerUser` — max WebSocket connections per user (default: unlimited)

Agent-level rate limits also apply to client WebSocket connections.

## Common Headers

| Header | Description |
|--------|-------------|
| `X-Request-Id` | Correlation ID (set by server, or echo client-provided value) |
| `X-RateLimit-Remaining` | Requests remaining in current window |
| `X-RateLimit-Reset` | Seconds until rate limit window resets |
| `Retry-After` | Seconds to wait (on 429 responses) |
| `X-End-User-Id` | End-user identifier (for anonymous auth mode) |

## Error Format

All errors follow a consistent format:

```json
{
  "error": {
    "message": "Human-readable error message",
    "code": "ERROR_CODE"
  }
}
```

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid auth token |
| `FORBIDDEN` | 403 | Insufficient permissions (admin required) |
| `NOT_FOUND` | 404 | Resource not found |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `BAD_REQUEST` | 400 | Invalid request body |
| `INTERNAL_ERROR` | 500 | Server error |

## CORS

Configure allowed origins in `GatewayConfig`:

```yaml
allowedOrigins:
  - https://app.example.com
  - https://admin.example.com
```

If `allowedOrigins` is empty or omitted, the server responds with `Access-Control-Allow-Origin: *`. When origins are configured, the server reflects the exact matching origin and sets `Vary: Origin`.
