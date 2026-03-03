# Agents and Bots

NexoraKit uses a two-layer deployment model: **Bots** define what the LLM does, **Agents** define how end users interact with it.

## Concepts

### Bot — Capability Profile

A Bot is an internal configuration profile. It is never exposed directly to end users.

| Field | Description |
|-------|-------------|
| `name` | Display name (unique per team) |
| `systemPrompt` | LLM system prompt |
| `model` | LLM model identifier (e.g., `claude-sonnet-4-6`) |
| `pluginNamespaces` | Which plugins this bot can use |
| `temperature` | LLM temperature (0–2) |
| `maxTurns` | Max agent loop iterations |
| `workspaceId` | Optional workspace for context injection |
| `metadata` | Arbitrary key-value data |

Bots are team-scoped. Create and manage them via the admin API.

### Agent — Deployment Profile

An Agent is the user-facing endpoint. It has a URL slug, auth configuration, and references one or more bots.

| Field | Description |
|-------|-------------|
| `slug` | URL-safe identifier (`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`) |
| `name` | Display name |
| `orchestrationStrategy` | `single`, `route`, or `orchestrate` |
| `botId` | Primary bot (for `single` mode) |
| `fallbackBotId` | Fallback bot when no binding matches |
| `orchestratorModel` | LLM model for orchestration decisions |
| `orchestratorPrompt` | System prompt for the orchestrator |
| `endUserAuth` | Auth mode for end users (see below) |
| `rateLimits` | Per-end-user rate limits |
| `appearance` | UI branding (name, avatar, colors) |
| `features` | Feature flags (artifacts, feedback, etc.) |
| `enabled` | Whether the agent accepts traffic |

Agents are team-scoped for admin operations but globally routable by slug for end users.

### Binding — Bot-to-Agent Link

Bindings connect bots to agents for multi-bot orchestration. Each binding has:

| Field | Description |
|-------|-------------|
| `botId` | The bot to bind |
| `priority` | Ranking (higher = preferred) |
| `description` | What this bot handles |
| `keywords` | Keywords for `route` mode matching |

Bindings are only needed for `route` and `orchestrate` strategies.

## Orchestration Strategies

### Single Bot

The simplest mode. The agent delegates every message to one bot.

```
End User → Agent → BotRunner(botId) → LLM → Response
```

Set `orchestrationStrategy: "single"` and provide `botId`.

### Route (Keyword Matching)

The agent picks the best bot based on keyword scoring. No extra LLM call.

```
End User → Agent → Keyword Matcher → Best Bot → BotRunner → Response
```

How scoring works:
1. Extract text from the user's input
2. For each binding, count keyword matches
3. Score = `matchCount × (priority + 1)`
4. Highest score wins; ties broken by priority
5. If no match, use `fallbackBotId`

Best for: clearly categorized queries where keywords reliably distinguish domains.

### Orchestrate (LLM Fan-out)

The agent uses an orchestrator LLM that can invoke multiple bots in parallel.

```
End User → Agent → Orchestrator LLM
                        │
                        ├─ ask_billing_bot("question")
                        ├─ ask_tech_bot("question")
                        │
                   [parallel execution]
                        │
                        └─ Synthesize → Response
```

How it works:
1. Each binding becomes a tool: `ask_<botname>({ question: string })`
2. The orchestrator LLM decides which bot(s) to call
3. Bot calls execute in parallel via `BotRunner.runToCompletion()`
4. If multiple bots respond, responses are synthesized into one answer
5. Single bot response is returned directly

Best for: complex multi-domain questions requiring cross-bot synthesis.

## Two API Surfaces

NexoraKit exposes two distinct API surfaces:

### Operator API (Admin)

For team members managing the platform. Requires admin auth (API key or JWT with `role: admin`).

```
POST   /v1/bots                    Create a bot
GET    /v1/bots                    List bots
GET    /v1/bots/:id                Get bot details
PATCH  /v1/bots/:id                Update a bot
DELETE /v1/bots/:id                Delete a bot

POST   /v1/agents                  Create an agent
GET    /v1/agents                  List agents
GET    /v1/agents/:id              Get agent + bindings
PATCH  /v1/agents/:id              Update an agent
DELETE /v1/agents/:id              Delete an agent

PUT    /v1/agents/:id/bindings     Replace all bindings
GET    /v1/agents/:id/end-users    List end users
```

### Client API (End Users)

For customers interacting with an agent. Routed by agent slug. Uses end-user auth (not operator auth).

```
GET    /v1/agents/:slug                              Agent info + appearance
POST   /v1/agents/:slug/conversations                Start a conversation
GET    /v1/agents/:slug/conversations                List conversations
GET    /v1/agents/:slug/conversations/:id            Get conversation
POST   /v1/agents/:slug/conversations/:id/messages   Send a message
WS     /v1/agents/:slug/ws                           WebSocket streaming
```

The slug is resolved globally via `getBySlugGlobal()` — it finds the first enabled agent matching that slug across all teams.

## End-User Authentication

Each agent configures its own end-user auth mode:

### Anonymous (default)

No credentials required. The client must provide `X-End-User-Id` header with any string identifier.

```yaml
endUserAuth:
  mode: anonymous
```

```bash
curl -X POST /v1/agents/support/conversations \
  -H "X-End-User-Id: visitor-123"
```

### Token

Requires `Authorization: Bearer <prefix><externalId>`. The prefix defaults to `nk_`.

```yaml
endUserAuth:
  mode: token
  tokenPrefix: nk_
```

```bash
curl -X POST /v1/agents/support/conversations \
  -H "Authorization: Bearer nk_user456"
```

### JWT

Requires a signed JWT (HMAC-SHA256). The `sub` claim becomes the external ID.

```yaml
endUserAuth:
  mode: jwt
  jwtSecret: your-secret-here
```

```bash
curl -X POST /v1/agents/support/conversations \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9..."
```

JWT claims: `sub` (required), `name` (optional), `exp` (optional).

End-user records are auto-created on first contact and scoped per agent.

## BotRunner

`BotRunner` wraps an `AgentLoop` with bot-specific configuration at runtime:

- Overrides the model, system prompt, temperature, and max turns
- Scopes plugin access to the bot's `pluginNamespaces`
- Injects workspace context if the bot has a `workspaceId`
- Preserves streaming semantics (`run()` yields `ChatEvent[]`)
- `runToCompletion()` collects all events and returns a `BotResponse` with content, token usage, and duration

The orchestrator uses `runToCompletion()` to fan out to bots in parallel.

## Example: Setting Up a Multi-Bot Agent

### 1. Create Bots

```bash
# Billing bot
curl -X POST http://localhost:3000/v1/bots \
  -H "Authorization: Bearer admin-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Billing Bot",
    "systemPrompt": "You are a billing specialist. Help customers with invoices, payments, and subscription changes.",
    "model": "claude-sonnet-4-6",
    "pluginNamespaces": ["billing"]
  }'

# Tech Support bot
curl -X POST http://localhost:3000/v1/bots \
  -H "Authorization: Bearer admin-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Tech Support Bot",
    "systemPrompt": "You are a technical support engineer. Help customers troubleshoot product issues.",
    "model": "claude-sonnet-4-6",
    "pluginNamespaces": ["support", "knowledge-base"]
  }'
```

### 2. Create Agent

```bash
curl -X POST http://localhost:3000/v1/agents \
  -H "Authorization: Bearer admin-key" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "customer-support",
    "name": "Customer Support",
    "orchestrationStrategy": "orchestrate",
    "orchestratorModel": "claude-sonnet-4-6",
    "endUserAuth": { "mode": "anonymous" },
    "rateLimits": { "messagesPerMinute": 30 },
    "features": { "artifacts": true, "feedback": true },
    "appearance": {
      "displayName": "Support Assistant",
      "welcomeMessage": "Hi! How can I help you today?"
    }
  }'
```

### 3. Bind Bots to Agent

```bash
curl -X PUT http://localhost:3000/v1/agents/<agent-id>/bindings \
  -H "Authorization: Bearer admin-key" \
  -H "Content-Type: application/json" \
  -d '{
    "bindings": [
      {
        "botId": "<billing-bot-id>",
        "priority": 1,
        "description": "Handles billing, invoices, and payment questions",
        "keywords": ["bill", "invoice", "payment", "subscription", "charge", "refund"]
      },
      {
        "botId": "<tech-bot-id>",
        "priority": 1,
        "description": "Handles technical issues and product troubleshooting",
        "keywords": ["bug", "error", "crash", "not working", "help", "how to"]
      }
    ]
  }'
```

`PUT /bindings` replaces all bindings atomically — send the full list every time.

### 4. End Users Chat

```bash
# Start a conversation
curl -X POST http://localhost:3000/v1/agents/customer-support/conversations \
  -H "X-End-User-Id: visitor-42" \
  -H "Content-Type: application/json"

# Send a message
curl -X POST http://localhost:3000/v1/agents/customer-support/conversations/<conv-id>/messages \
  -H "X-End-User-Id: visitor-42" \
  -H "Content-Type: application/json" \
  -d '{
    "input": { "type": "text", "text": "I have a billing question about my invoice" }
  }'
```

The orchestrator LLM sees this message, recognizes it as billing-related, calls `ask_billing_bot`, and returns the billing bot's response.

## Data Model

### Storage Schema

```
bots                  Bot configuration profiles
agents                Agent deployment profiles
agent_bot_bindings    Many-to-many bot-agent bindings
end_users             End-user records (per agent)
conversations         Conversation sessions
messages              Message history (with bot_ids, bot_responses)
```

### Team Scoping

All operator resources (bots, agents) are scoped to a `teamId`. Admin API calls operate within the authenticated user's team. The client API resolves agents globally by slug.

### Entity Relationships

```
Team
 ├── Bots (config profiles)
 ├── Agents (deployments)
 │    ├── Bindings → Bots
 │    ├── End Users
 │    │    └── Conversations
 │    │         └── Messages
 │    └── Rate Limits, Auth, Features
 └── Workspaces, Templates
```
