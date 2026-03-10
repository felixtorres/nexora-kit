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

### Install the CLI

Link the CLI package to make `nexora-kit` available globally:

```bash
cd packages/cli
npm link
cd ../..
```

Verify:

```bash
nexora-kit --version
```

### Shell Completion

```bash
# Fish
nexora-kit completion --shell fish > ~/.config/fish/completions/nexora-kit.fish

# Bash — add to ~/.bashrc
eval "$(nexora-kit completion --shell bash)"

# Zsh — add to ~/.zshrc
eval "$(nexora-kit completion --shell zsh)"
```

## Initialize an Instance

```bash
nexora-kit init my-bot
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
  # Required for models that reject legacy parameters (e.g. gpt-5.x, o1, o3):
  # useMaxCompletionTokens: true
  # omitUnsupportedParams: true

# Limit conversation history per turn for models with small context windows:
# agent:
#   maxContextTokens: 8000
```

All credential fields fall through to environment variables (`WSO2_AUTH_URL`, `WSO2_CLIENT_ID`, `WSO2_CLIENT_SECRET`, `WSO2_BASE_URL`, `WSO2_DEPLOYMENT_ID`, `WSO2_API_VERSION`), so secrets can be kept out of the YAML file entirely.

If `llm` is omitted, the server starts with a stub provider that returns a configuration reminder instead of real responses.

### Agent Loop

The agent loop controls how the LLM reasons, uses tools, and manages context. All settings are optional — the defaults work well for most use cases.

```yaml
agent:
  # Context window management
  # maxContextTokens: 100000  # Auto-derived from model if omitted
  maxToolResultTokens: 2000   # Truncate tool results in message history
  maxTurns: 25                # Max turns per run (extendable by the agent)

  # Context compaction — LLM-based summarization of old messages
  compaction:
    # model: claude-haiku-4-5-20251001  # Cheap model for summarization
    triggerRatio: 0.75          # Compact when history reaches 75% of budget
    keepRecentGroups: 4         # Keep last 4 message groups verbatim
    maxSummaryTokens: 1000      # Max tokens for the summary

  # Working memory — agent can save notes across turns
  enableWorkingMemory: true     # Enables _note_to_self and _recall tools

  # Sub-agents — agent can delegate subtasks to child agents
  subAgent:
    maxDepth: 2                 # Max nesting depth for sub-agents
    maxConcurrent: 3            # Max parallel sub-agents
    subAgentMaxTurns: 10        # Turn limit for child agents
```

Without `compaction`, the system falls back to hard truncation (dropping oldest messages). Enabling compaction is recommended for any bot that handles multi-step tasks or long conversations.

### System Prompts

System prompts can be set at three levels, with later levels overriding earlier ones:

**1. Instance default** — applies to all conversations when no bot or conversation override is set:

```yaml
# nexora.yaml — not a direct config key; set via the first bot or via API
# The instance's default system prompt comes from the base prompt in @nexora-kit/core.
```

**2. Bot-level** — each bot has its own `systemPrompt` that overrides the instance default:

```bash
nexora-kit bot create \
  --name "Support Bot" \
  --model claude-sonnet-4-6 \
  --system-prompt "You are a support agent. Be concise and helpful."
```

Or via the API:

```bash
curl -X POST http://localhost:3000/v1/admin/bots \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Support Bot", "model": "claude-sonnet-4-6", "systemPrompt": "You are a support agent."}'
```

**3. Conversation-level** — set when creating a conversation, overrides bot defaults:

```bash
curl -X POST http://localhost:3000/v1/conversations \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"systemPrompt": "You are a legal advisor. Only discuss contract law.", "model": "claude-opus-4-6"}'
```

**4. Conversation templates** — reusable presets for common configurations:

```bash
# Create a template (admin only)
curl -X POST http://localhost:3000/v1/admin/templates \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Legal Advisor", "systemPrompt": "You are a legal advisor.", "model": "claude-opus-4-6"}'

# Use the template when creating a conversation
curl -X POST http://localhost:3000/v1/conversations \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"templateId": "<template-id>"}'
```

The priority cascade is: **conversation → bot → instance default**. The `model` field follows the same cascade.

### Prompt Optimization

NexoraKit includes a built-in prompt optimizer that uses LLM reflection to improve prompts based on real execution data. It captures traces, scores them with diagnostic feedback, and rewrites underperforming prompts.

**Enable it** in `nexora.yaml`:

```yaml
optimization:
  enabled: true                    # Enable trace capture + optimization
  model: claude-sonnet-4-6        # LLM for the reflection step (optional)
```

When enabled, the system automatically captures execution traces for every agent run. These traces record the prompt used, tool calls made, reasoning, and the final answer.

**Prerequisites:** User feedback fuels the optimizer. The frontend provides thumbs up/down on every assistant response, which feeds into the `user_satisfaction` metric. Collect feedback for a while before running optimization.

#### Workflow

**1. Check readiness** — the optimizer needs at least 20 scored traces with 3+ negative signals:

```bash
nexora-kit optimize status
```

**2. Run optimization** — analyzes traces, reflects on failures, and produces a rewritten prompt:

```bash
# Optimize a skill prompt
nexora-kit optimize skill faq-answerer

# Optimize a tool description
nexora-kit optimize tool search-docs

# Optimize a bot's system prompt
nexora-kit optimize bot support-bot

# Override the minimum trace requirement
nexora-kit optimize skill faq-answerer --force
```

**3. Review candidates** — optimization produces a `candidate`, not an active prompt:

```bash
nexora-kit optimize list
```

This shows all candidates with their estimated score improvement, the model used, and current status.

**4. Approve or rollback**:

```bash
# Deploy the optimized prompt
nexora-kit optimize approve <id>

# Revert to the original prompt
nexora-kit optimize rollback <id>
```

Approval deactivates any previous active optimization for the same component. Rollback restores the original prompt.

#### What gets optimized

| Component | CLI command | Impact |
|-----------|------------|--------|
| Skill prompts | `optimize skill <name>` | Better task execution, fewer hallucinations |
| Tool descriptions | `optimize tool <name>` | Better tool selection by the agent loop |
| Bot system prompts | `optimize bot <slug>` | More accurate agent behavior |

#### API

All optimization operations are also available via the REST API. See [API Reference — Prompt Optimization](api-reference.md#prompt-optimization-requires-role-admin).

## Validate and Start

```bash
# Validate config before starting
nexora-kit config validate

# Start the server
nexora-kit serve
```

Or with Docker:

```bash
docker compose up
```

The server starts on `http://127.0.0.1:3000`.

```bash
# Check server status
nexora-kit status
```

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
nexora-kit plugin list
```

## Set Up Bots and Agents

After starting the server, create bots (capability profiles) and agents (deployment endpoints). See [Agents and Bots](agents-and-bots.md) for the full concept guide.

### Create a Bot

```bash
nexora-kit bot create \
  --name "My Bot" \
  --model claude-sonnet-4-6 \
  --system-prompt "You are a helpful assistant."

# ✓ Bot created: My Bot (b1a2b3c4...)
```

### Create an Agent

```bash
nexora-kit agent create \
  --slug my-agent \
  --name "My Agent" \
  --bot <bot-id-from-above> \
  --strategy single \
  --auth-mode anonymous

# ✓ Agent created: My Agent (slug: my-agent, id: a5e6f7g8...)
```

### Verify

```bash
nexora-kit bot list
nexora-kit agent list
nexora-kit agent get <agent-id>
```

### Chat as an End User

```bash
# Create a conversation
curl -X POST http://localhost:3000/v1/agents/my-agent/conversations \
  -H "X-End-User-Id: test-user" \
  -H "Content-Type: application/json"

# Send a message
curl -X POST http://localhost:3000/v1/agents/my-agent/conversations/<conv-id>/messages \
  -H "X-End-User-Id: test-user" \
  -H "Content-Type: application/json" \
  -d '{ "input": { "type": "text", "text": "Hello!" } }'
```

### Multi-Bot Orchestration

```bash
# Create specialized bots
nexora-kit bot create --name "FAQ Bot" --model claude-sonnet-4-6 --system-prompt "Answer FAQs" --plugins faq
nexora-kit bot create --name "Sales Bot" --model claude-sonnet-4-6 --system-prompt "Handle sales" --plugins sales

# Create orchestrating agent
nexora-kit agent create --slug support --name "Support" --strategy orchestrate

# Bind bots with keywords for routing
nexora-kit agent bind <agent-id> --bots <faq-bot-id>,<sales-bot-id> --keywords "help,faq:pricing,buy"
```

See the [full walkthrough](agents-and-bots.md#example-setting-up-a-multi-bot-agent).

## Add a Plugin

```bash
# Scaffold and install a new plugin
nexora-kit plugin init my-plugin
nexora-kit plugin add ./my-plugin

# Or install from GitHub
nexora-kit plugin add https://github.com/org/my-plugin

# Manage at runtime (server must be running)
nexora-kit plugin list
nexora-kit plugin enable my-plugin
nexora-kit plugin disable my-plugin
```

See [Plugin Authoring](plugin-authoring.md) for details.

## CLI Reference

### Instance

| Command                 | Description             |
| ----------------------- | ----------------------- |
| `nexora-kit init [dir]` | Scaffold a new instance |
| `nexora-kit serve`      | Start the server        |
| `nexora-kit status`     | Health, uptime, metrics |

### Plugins

| Command                            | Description                            |
| ---------------------------------- | -------------------------------------- |
| `nexora-kit plugin init <name>`    | Scaffold a new plugin                  |
| `nexora-kit plugin add <source>`   | Install from path, ZIP, or GitHub URL  |
| `nexora-kit plugin list`           | List installed plugins                 |
| `nexora-kit plugin enable <ns>`    | Enable a plugin at runtime             |
| `nexora-kit plugin disable <ns>`   | Disable a plugin at runtime            |
| `nexora-kit plugin remove <ns>`    | Uninstall a plugin                     |
| `nexora-kit plugin dev <dir>`      | Dev server with hot-reload             |
| `nexora-kit plugin test [dir]`     | Run plugin test suite                  |
| `nexora-kit plugin validate [dir]` | Validate manifest, schema, permissions |

### Bots

| Command                      | Description                                           |
| ---------------------------- | ----------------------------------------------------- |
| `nexora-kit bot create`      | Create a bot (`--name`, `--model`, `--system-prompt`) |
| `nexora-kit bot list`        | List all bots                                         |
| `nexora-kit bot get <id>`    | Show bot details                                      |
| `nexora-kit bot update <id>` | Update bot properties                                 |
| `nexora-kit bot delete <id>` | Delete a bot                                          |

### Agents

| Command                        | Description                                                 |
| ------------------------------ | ----------------------------------------------------------- |
| `nexora-kit agent create`      | Create an agent (`--slug`, `--name`, `--bot`, `--strategy`) |
| `nexora-kit agent list`        | List all agents                                             |
| `nexora-kit agent get <id>`    | Show agent details + bindings                               |
| `nexora-kit agent update <id>` | Update agent properties                                     |
| `nexora-kit agent delete <id>` | Delete an agent                                             |
| `nexora-kit agent bind <id>`   | Set bot bindings (`--bots`, `--keywords`)                   |

### Config

| Command                             | Description                           |
| ----------------------------------- | ------------------------------------- |
| `nexora-kit config get <key>`       | Read a config value (dot-notation)    |
| `nexora-kit config set <key> <val>` | Set a config value                    |
| `nexora-kit config validate`        | Validate config file                  |
| `nexora-kit config show`            | Show resolved config (secrets masked) |

### Admin

| Command                     | Description                                          |
| --------------------------- | ---------------------------------------------------- |
| `nexora-kit admin usage`    | Token usage analytics                                |
| `nexora-kit admin audit`    | Query audit log (`--actor`, `--action`, `--since`)   |
| `nexora-kit admin feedback` | Feedback summary (`--since`, `--model`)              |
| `nexora-kit admin cleanup`  | Purge old audit events (`--older-than`, `--dry-run`) |

### Prompt Optimization

| Command                               | Description                                           |
| ------------------------------------- | ----------------------------------------------------- |
| `nexora-kit optimize skill <name>`    | Optimize a skill prompt (`--bot`, `--force`)          |
| `nexora-kit optimize tool <name>`     | Optimize a tool description (`--force`)               |
| `nexora-kit optimize bot <slug>`      | Optimize a bot's system prompt (`--force`)            |
| `nexora-kit optimize list`            | List candidates (`--status`, `--type`, `--bot`)       |
| `nexora-kit optimize approve <id>`    | Approve and deploy an optimized prompt                |
| `nexora-kit optimize rollback <id>`   | Roll back to original prompt                          |
| `nexora-kit optimize status`          | Show optimization overview (active, pending, stale)   |

### Utility

| Command                              | Description                                  |
| ------------------------------------ | -------------------------------------------- |
| `nexora-kit completion --shell <sh>` | Generate shell completions (bash, zsh, fish) |
| `nexora-kit --help`                  | Show all commands                            |
| `nexora-kit --version`               | Show version                                 |
