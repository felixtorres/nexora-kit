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

#### `POST /v1/admin/bots`
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

#### `GET /v1/admin/bots`
List all bots for the authenticated user's team.

#### `GET /v1/admin/bots/:id`
Get a bot by ID.

#### `PATCH /v1/admin/bots/:id`
Update a bot. Send only the fields to change.

**Request:**
```json
{
  "systemPrompt": "Updated prompt...",
  "temperature": 0.5
}
```

#### `DELETE /v1/admin/bots/:id`
Delete a bot.

### Agents (requires `role: admin`)

#### `POST /v1/admin/agents`
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

#### `GET /v1/admin/agents`
List all agents for the authenticated user's team.

#### `GET /v1/admin/agents/:id`
Get an agent by ID, including its bindings.

#### `PATCH /v1/admin/agents/:id`
Update an agent. Send only the fields to change.

#### `DELETE /v1/admin/agents/:id`
Delete an agent and clean up its bindings.

#### `PUT /v1/admin/agents/:id/bindings`
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

#### `GET /v1/admin/agents/:id/end-users`
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

#### `GET /v1/conversations/:id/messages`
List messages in a conversation. Filters out system/tool messages and empty assistant messages.

**Response:** `200`
```json
{
  "messages": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi! How can I help?", "blocks": [] }
  ]
}
```

#### `POST /v1/conversations/:id/messages`
Send a message in a conversation (operator context, no bot orchestration).

**Request:**
```json
{
  "input": "How do I reset my password?",
  "pluginNamespaces": ["faq"],
  "metadata": {}
}
```

The `input` field accepts a string or a typed union:
- Text: `{ "type": "text", "text": "..." }`
- Action: `{ "type": "action", "actionId": "...", "payload": {} }`
- File: `{ "type": "file", "fileId": "...", "text": "optional caption" }`

**Response:** `200`
```json
{
  "conversationId": "conv-abc123",
  "message": "To reset your password...",
  "blocks": []
}
```

### Message Edit & Regenerate

Requires `conversationStore` and `messageStore` to be configured.

#### `PUT /v1/conversations/:id/messages/:seq`
Edit a user message at the given sequence number. Truncates conversation history after that point and replays the edited message through the agent loop.

**Request:**
```json
{
  "input": "Actually, I meant to ask about billing"
}
```

**Response:** `200`
```json
{
  "conversationId": "conv-abc123",
  "message": "Sure, I can help with billing...",
  "blocks": []
}
```

#### `POST /v1/conversations/:id/messages/:seq/regenerate`
Regenerate the assistant response at the given sequence number. Truncates from that point and replays the preceding user message.

**Response:** `200`
```json
{
  "conversationId": "conv-abc123",
  "message": "Let me try a different approach...",
  "blocks": []
}
```

### Files

Requires `fileStore` and `fileBackend` to be configured.

#### `POST /v1/files`
Upload a file (base64-encoded).

**Request:**
```json
{
  "conversationId": "conv-abc123",
  "filename": "report.pdf",
  "mimeType": "application/pdf",
  "content": "<base64-encoded data>"
}
```

Allowed MIME types: `text/plain`, `text/markdown`, `text/csv`, `text/html`, `application/json`, `application/pdf`, `image/png`, `image/jpeg`, `image/gif`, `image/webp`. Max size: 10 MB. Max filename: 255 chars.

**Response:** `201`
```json
{
  "id": "file-abc123",
  "conversationId": "conv-abc123",
  "userId": "user1",
  "filename": "report.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 102400,
  "createdAt": "2026-03-03T10:00:00Z"
}
```

#### `GET /v1/files/:id`
Get file metadata.

**Response:** `200` — FileRecord (same shape as above).

#### `GET /v1/files/:id/content`
Download file content (base64-encoded).

**Response:** `200`
```json
{
  "id": "file-abc123",
  "filename": "report.pdf",
  "mimeType": "application/pdf",
  "content": "<base64-encoded data>"
}
```

#### `DELETE /v1/files/:id`
Delete a file.

**Response:** `204`

#### `GET /v1/conversations/:id/files`
List all files in a conversation.

**Response:** `200`
```json
{
  "files": [{ "id": "file-abc123", "filename": "report.pdf", "mimeType": "application/pdf", "sizeBytes": 102400, "createdAt": "..." }]
}
```

### Workspaces & Documents (requires `role: admin` for mutations)

Requires `workspaceStore` and `contextDocumentStore` to be configured.

#### `POST /v1/admin/workspaces`
Create a workspace. Requires admin role.

**Request:**
```json
{
  "name": "Product Knowledge",
  "description": "Internal product documentation",
  "systemPrompt": "Use these documents to answer questions accurately.",
  "metadata": {}
}
```

**Response:** `201` — WorkspaceRecord.

#### `GET /v1/workspaces`
List all workspaces.

**Response:** `200`
```json
{
  "workspaces": [
    { "id": "ws-abc123", "teamId": "default", "name": "Product Knowledge", "description": "...", "createdAt": "...", "updatedAt": "..." }
  ]
}
```

#### `GET /v1/workspaces/:id`
Get a workspace by ID.

#### `PATCH /v1/admin/workspaces/:id`
Update a workspace. Requires admin role. Send only the fields to change. Set optional fields to `null` to clear them.

#### `DELETE /v1/admin/workspaces/:id`
Delete a workspace. Requires admin role.

**Response:** `204`

#### `POST /v1/admin/workspaces/:id/documents`
Add a document to a workspace. Requires admin role.

**Request:**
```json
{
  "title": "Refund Policy",
  "content": "Our refund policy covers...",
  "priority": 80,
  "metadata": {}
}
```

Priority ranges 0–100 (higher = injected first when context budget is limited).

**Response:** `201` — ContextDocumentRecord.

#### `GET /v1/workspaces/:id/documents`
List documents in a workspace.

**Response:** `200`
```json
{
  "documents": [
    { "id": "doc-abc", "workspaceId": "ws-abc123", "title": "Refund Policy", "content": "...", "priority": 80, "createdAt": "...", "updatedAt": "..." }
  ]
}
```

#### `PATCH /v1/admin/workspaces/:wsId/documents/:docId`
Update a document. Requires admin role.

#### `DELETE /v1/admin/workspaces/:wsId/documents/:docId`
Delete a document. Requires admin role.

**Response:** `204`

### Templates (requires `role: admin` for mutations)

Requires `templateStore` to be configured.

#### `POST /v1/admin/templates`
Create a conversation template. Requires admin role.

**Request:**
```json
{
  "name": "Customer Support",
  "description": "Template for support conversations",
  "systemPrompt": "You are a helpful support agent.",
  "pluginNamespaces": ["faq", "knowledge-base"],
  "model": "claude-sonnet-4-6",
  "temperature": 0.7,
  "maxTurns": 10,
  "metadata": {}
}
```

Required field: `name`. Temperature: 0–2. Max turns: 1–100.

**Response:** `201` — ConversationTemplateRecord.

#### `GET /v1/templates`
List all templates.

**Response:** `200`
```json
{
  "templates": [
    { "id": "tmpl-abc", "teamId": "default", "name": "Customer Support", "description": "...", "systemPrompt": "...", "createdAt": "...", "updatedAt": "..." }
  ]
}
```

#### `GET /v1/templates/:id`
Get a template by ID.

#### `PATCH /v1/admin/templates/:id`
Update a template. Requires admin role. Set optional fields to `null` to clear them.

#### `DELETE /v1/admin/templates/:id`
Delete a template. Requires admin role.

**Response:** `204`

### Feedback

Requires `feedbackStore` to be configured.

#### `POST /v1/conversations/:id/messages/:seq/feedback`
Submit feedback on a specific message.

**Request:**
```json
{
  "rating": "positive",
  "comment": "This was very helpful!",
  "tags": ["accurate", "fast"]
}
```

Required field: `rating` (`positive` or `negative`). Tags max: 10 items.

**Response:** `200` — FeedbackRecord.

#### `GET /v1/admin/feedback`
Query feedback entries. Requires admin role.

**Query params:** `pluginNamespace`, `rating` (`positive` | `negative`), `from` (ISO 8601), `to` (ISO 8601), `cursor`, `limit` (1–100).

**Response:** `200`
```json
{
  "items": [
    { "id": "fb-abc", "conversationId": "conv-abc", "messageSeq": 2, "userId": "user1", "rating": "positive", "comment": "...", "tags": [], "createdAt": "..." }
  ],
  "nextCursor": "fb-xyz"
}
```

#### `GET /v1/admin/feedback/summary`
Get aggregated feedback statistics. Requires admin role.

**Query params:** `pluginNamespace`, `model`, `from` (ISO 8601), `to` (ISO 8601).

**Response:** `200`
```json
{
  "total": 150,
  "positive": 120,
  "negative": 30,
  "positiveRate": 0.8,
  "topTags": [{ "tag": "accurate", "count": 45 }]
}
```

### User Memory

Requires `userMemoryStore` to be configured.

#### `GET /v1/me/memory`
List the authenticated user's memory facts.

**Query params:** `namespace` (optional, filter by namespace).

**Response:** `200`
```json
{
  "facts": [
    { "key": "preferred_language", "value": "TypeScript", "namespace": "default", "createdAt": "..." }
  ]
}
```

#### `DELETE /v1/me/memory/:key`
Delete a specific memory fact by key.

**Response:** `204`

#### `DELETE /v1/me/memory`
Delete all memory facts for the authenticated user.

**Query params:** `confirm=true` (required safety guard).

**Response:** `204`

### Artifacts

Requires `artifactStore` to be configured.

#### `GET /v1/conversations/:id/artifacts`
List all artifacts in a conversation.

**Response:** `200`
```json
{
  "artifacts": [
    { "id": "art-abc", "conversationId": "conv-abc", "title": "Report Draft", "currentVersion": 2, "createdAt": "...", "updatedAt": "..." }
  ]
}
```

#### `GET /v1/conversations/:id/artifacts/:artifactId`
Get an artifact (latest version content).

**Response:** `200` — ArtifactRecord with content.

#### `GET /v1/conversations/:id/artifacts/:artifactId/versions`
List all versions of an artifact.

**Response:** `200`
```json
{
  "versions": [
    { "artifactId": "art-abc", "version": 1, "content": "...", "createdAt": "..." },
    { "artifactId": "art-abc", "version": 2, "content": "...", "createdAt": "..." }
  ]
}
```

#### `GET /v1/conversations/:id/artifacts/:artifactId/versions/:version`
Get a specific version of an artifact.

**Response:** `200` — ArtifactVersionRecord.

#### `DELETE /v1/conversations/:id/artifacts/:artifactId`
Delete an artifact and all its versions.

**Response:** `204`

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
