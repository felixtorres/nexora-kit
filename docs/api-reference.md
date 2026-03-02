# API Reference

NexoraKit exposes a REST + WebSocket API. The full OpenAPI 3.1 spec is available at `GET /v1/openapi.json` on any running instance.

## Base URL

Default: `http://localhost:3000/v1`

Configurable via `apiPrefix` in `GatewayConfig` (default: `/v1`).

## Authentication

All endpoints except health and OpenAPI spec require authentication.

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

### Chat

#### `POST /v1/chat`
Send a message and receive a response.

**Request:**
```json
{
  "message": "How do I reset my password?",
  "sessionId": "optional-session-id",
  "pluginNamespaces": ["faq"],
  "metadata": {}
}
```

**Response:** `200`
```json
{
  "message": "To reset your password, go to Settings > Security...",
  "sessionId": "sess-abc123",
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

### Admin (requires `role: admin`)

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

## WebSocket

### Connection

Upgrade to WebSocket at the server root. Authentication is performed during the upgrade handshake.

```
GET / HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Authorization: Bearer <api-key>
```

### Messages

**Client → Server:**

```json
{ "type": "chat", "message": "Hello", "sessionId": "optional" }
```

```json
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

### Rate Limits

WebSocket connections support configurable rate limits:
- `wsMaxMessagesPerMinute` — sliding window per connection (default: unlimited)
- `wsMaxConcurrentChats` — max parallel chat sessions per connection (default: unlimited)
- `wsMaxConnectionsPerUser` — max WebSocket connections per user (default: unlimited)

## Common Headers

| Header | Description |
|--------|-------------|
| `X-Request-Id` | Correlation ID (set by server, or echo client-provided value) |
| `X-RateLimit-Remaining` | Requests remaining in current window |
| `X-RateLimit-Reset` | Seconds until rate limit window resets |
| `Retry-After` | Seconds to wait (on 429 responses) |

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
