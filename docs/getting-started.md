# Getting Started

## Prerequisites

- Node.js 20+
- npm 9+

## Install

```bash
git clone <your-repo-url> nexora-kit
cd nexora-kit
npm install
npm run build
```

## Initialize an Instance

```bash
npx nexora-kit init my-bot
cd my-bot
```

This creates a directory with:

- `nexora.yaml` — instance configuration
- `plugins/` — plugin directory

## Configure

Edit `nexora.yaml`:

```yaml
name: my-bot
port: 3000
host: 127.0.0.1

auth:
  type: api-key
  keys:
    - key: my-secret-key
      userId: admin
      teamId: default
      role: admin

storage:
  path: ./data/nexora.db

plugins:
  directory: ./plugins

# Optional: rate limiting
# rateLimit:
#   windowMs: 60000
#   maxRequests: 100
```

### Storage Backends

**SQLite (default)** — zero config, single-file database:

```yaml
storage:
  path: ./data/nexora.db
```

**PostgreSQL** — for multi-instance / high-scale deployments:

```yaml
storage:
  backend: postgres
  connectionString: postgresql://user:pass@host:5432/nexora
  poolSize: 10
```

PostgreSQL requires `pg` as a dependency: `npm install pg`.

### LLM Providers

The provider is selected automatically based on `llm.provider` in `nexora.yaml`. No code changes required.

#### Anthropic

```yaml
llm:
  provider: anthropic
  apiKey: sk-... # or set ANTHROPIC_API_KEY env var
  model: claude-sonnet-4-20250514
```

#### WSO2-proxied Azure OpenAI

```yaml
llm:
  provider: wso2-azure-openai
  wso2AuthUrl: https://api-gateway.example.com:443/token
  wso2ClientId: <your-client-id>
  wso2ClientSecret: <your-client-secret>
  wso2BaseUrl: https://api-gateway.example.com:443/t/org/openaiendpoint/1
  wso2DeploymentId: gpt-4o-deployment
  wso2ApiVersion: '2024-12-01-preview'
```

All credential fields fall through to environment variables (`WSO2_AUTH_URL`, `WSO2_CLIENT_ID`, `WSO2_CLIENT_SECRET`, `WSO2_BASE_URL`, `WSO2_DEPLOYMENT_ID`, `WSO2_API_VERSION`), so secrets can be kept out of the YAML file entirely.

If `llm` is omitted, the server starts with a stub provider that returns a configuration reminder instead of real responses.

## Start the Server

```bash
npx nexora-kit serve
```

Or with Docker:

```bash
docker compose up
```

The server starts on `http://127.0.0.1:3000`.

## First API Call

```bash
# Health check (no auth required)
curl http://localhost:3000/v1/health

# Send a chat message
curl -X POST http://localhost:3000/v1/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer my-secret-key" \
  -d '{"message": "Hello!"}'

# List plugins
curl http://localhost:3000/v1/plugins \
  -H "Authorization: Bearer my-secret-key"
```

## Add a Plugin

```bash
npx nexora-kit plugin init my-plugin
npx nexora-kit plugin add ./my-plugin
npx nexora-kit serve
```

See [Plugin Authoring](plugin-authoring.md) for details.

## CLI Commands

| Command                               | Description                 |
| ------------------------------------- | --------------------------- |
| `nexora-kit init <name>`              | Scaffold a new instance     |
| `nexora-kit serve`                    | Start the server            |
| `nexora-kit plugin init <name>`       | Scaffold a new plugin       |
| `nexora-kit plugin add <path>`        | Install a plugin            |
| `nexora-kit plugin dev <path>`        | Watch plugin for hot-reload |
| `nexora-kit plugin test <path>`       | Run plugin validation       |
| `nexora-kit plugin validate <path>`   | Validate plugin manifest    |
| `nexora-kit config get <key>`         | Read a config value         |
| `nexora-kit config set <key> <value>` | Set a config value          |
| `nexora-kit admin usage`              | Show usage analytics        |
