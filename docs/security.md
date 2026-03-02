# Security

## Authentication

### API Keys

The simplest auth method. Keys map to user identity (userId, teamId, role). Passed as `Authorization: Bearer <key>`.

```yaml
auth:
  type: api-key
  keys:
    - key: user-key-1
      userId: alice
      teamId: eng
      role: user
    - key: admin-key-1
      userId: bob
      teamId: eng
      role: admin
```

### JWT (HMAC-SHA256)

For programmatic/service-to-service auth. Hardened with:

- **Algorithm validation** — only `HS256` accepted; tokens with `alg: "none"` or other algorithms are rejected
- **Clock skew protection** — tokens with `iat` (issued-at) more than 30 seconds in the future are rejected
- **Key rotation** — configure multiple secrets; the first successful verification is accepted, allowing zero-downtime key rotation

```typescript
const auth = new JwtAuth(['current-secret', 'previous-secret']);
```

## Authorization

Two roles: `user` and `admin`.

| Role | Access |
|------|--------|
| `user` | Chat, list plugins, view plugin details |
| `admin` | All user endpoints + enable/disable/uninstall plugins, audit log, usage analytics |

Admin endpoints (`/v1/admin/*`) check `auth.role === 'admin'` and return 403 if insufficient.

## CORS

Configure `allowedOrigins` in the gateway config:

```yaml
allowedOrigins:
  - https://app.example.com
  - https://admin.example.com
```

Behavior:
- **No origins configured** — responds with `Access-Control-Allow-Origin: *`
- **Origins configured** — reflects the exact matching origin, sets `Vary: Origin`. Non-matching origins receive the first configured origin (browsers will block the request)

## Rate Limiting

### HTTP Rate Limiting

Sliding-window rate limiter keyed by userId:

```yaml
rateLimit:
  windowMs: 60000    # 1 minute window
  maxRequests: 100   # max requests per window
```

Response headers: `X-RateLimit-Remaining`, `X-RateLimit-Reset`. Exceeding the limit returns 429 with `Retry-After`.

### WebSocket Rate Limiting

Three independent limits:

| Config | Description |
|--------|-------------|
| `wsMaxMessagesPerMinute` | Per-connection sliding window for incoming messages |
| `wsMaxConcurrentChats` | Max parallel chat sessions per connection |
| `wsMaxConnectionsPerUser` | Max WebSocket connections per user across all connections |

Exceeding message rate or concurrent chat limits sends an error frame and ignores the message. Exceeding connection limit rejects the upgrade.

## Request Body Size

Configure `maxBodyBytes` to limit request body size (default: 1 MB):

```yaml
maxBodyBytes: 2097152  # 2 MB
```

Requests exceeding this limit receive a 413 response.

## Correlation IDs

Every request gets an `X-Request-Id` header:
- If the client sends `X-Request-Id`, the server echoes it back
- Otherwise, the server generates `req-<timestamp>-<random>`

Use this for log correlation and debugging.

## Sandbox

Plugins execute within a permission-gated sandbox:

| Tier | Description |
|------|-------------|
| `none` | No restrictions (development only) |
| `basic` | Permission gate checks, resource limits |
| `strict` | Full isolation with resource limiter enforcement |

The `PermissionGate` validates plugin permissions against their declared `permissions` in `plugin.yaml`. The `ResourceLimiter` enforces memory and CPU constraints.

**Known limitation:** Code execution via `CodeExecutor` uses Node.js worker threads. The `allowedModules` restriction can be bypassed via dynamic `import()`. Full OS-level sandboxing is out of scope — use container isolation for untrusted plugins.

## Audit Logging

All admin actions (enable, disable, uninstall) and their outcomes (success/failure) are recorded in the audit log:

```bash
# Query audit events
curl "http://localhost:3000/v1/admin/audit-log?actor=admin1&limit=50" \
  -H "Authorization: Bearer admin-key"

# Purge old events
curl -X POST "http://localhost:3000/v1/admin/audit-log/purge" \
  -H "Authorization: Bearer admin-key" \
  -H "Content-Type: application/json" \
  -d '{"olderThanDays": 90}'
```

## Metrics

The `/v1/metrics` endpoint is **auth-protected by default** (since Phase 9). Set `publicMetrics: true` to expose without auth.

Metrics include: uptime, total requests, status/method breakdown, active connections, average and p95 latency.

## Checklist

- [ ] Change default API keys before deploying to production
- [ ] Configure `allowedOrigins` for your frontend domains
- [ ] Set `maxBodyBytes` appropriate for your use case
- [ ] Enable rate limiting for public-facing instances
- [ ] Set WebSocket limits for multi-tenant deployments
- [ ] Use JWT with key rotation for service-to-service auth
- [ ] Review plugin permissions before enabling untrusted plugins
- [ ] Run untrusted plugins in containers (sandbox has known limitations)
- [ ] Regularly purge audit logs to manage storage
