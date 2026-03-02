# Plugin Authoring

Plugins are the primary extension mechanism in NexoraKit. A plugin bundles skills, commands, and MCP server connections under a single namespace.

## Plugin Structure

```
my-plugin/
  plugin.yaml        # Manifest (required)
  skills/            # Skill definitions
    greet.yaml       # YAML skill (prompt-based)
    summarize.md     # Markdown skill
    compute.ts       # TypeScript skill (code handler)
  commands/          # Command definitions
    search.yaml      # YAML command
  mcp/               # MCP server configs
    mcp.yaml         # Server connection definitions
  package.json       # Optional — for TS skills with dependencies
```

## Manifest (`plugin.yaml`)

```yaml
name: my-plugin
version: 1.0.0
namespace: myplug
description: A helpful plugin

permissions:
  - llm:invoke
  - storage:read
  - storage:write

config:
  schema:
    api_url:
      type: string
      description: External API endpoint
      default: https://api.example.com
    max_results:
      type: number
      description: Max results per query
      default: 10
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Plugin display name |
| `version` | string | Semver version |
| `namespace` | string | Unique namespace (used in tool/command routing) |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Human-readable description |
| `permissions` | string[] | Requested permissions |
| `config.schema` | object | Config schema (per-key type, description, default) |
| `dependencies` | string[] | Other plugin namespaces this plugin requires |

## Skills

Skills are capabilities the LLM can invoke. Three formats supported:

### YAML Skills (Prompt-Based)

```yaml
# skills/answer.yaml
name: answer-question
description: Answer a user question from the knowledge base
invocation: model       # "model" = LLM decides when to invoke
input_schema:
  type: object
  properties:
    question:
      type: string
      description: The question to answer
  required:
    - question
prompt: |
  Answer the following question concisely.
  Question: {{question}}
  Max results: {{config.max_results}}
```

Template variables: `{{variable}}` for input, `{{config.key}}` for plugin config. Conditional sections: `{{#variable}}shown if truthy{{/variable}}`.

### Markdown Skills

```markdown
<!-- skills/greet.md -->
---
name: greet
description: Greet the user
invocation: model
---

# Greeting Skill

Greet the user warmly and ask how you can help.
```

The markdown body becomes the prompt. Frontmatter defines metadata.

### TypeScript Skills (Code Handlers)

```typescript
// skills/compute.ts
import { defineSkill } from '@nexora-kit/skills';

export default defineSkill({
  name: 'compute',
  description: 'Run a calculation',
  invocation: 'model',
  inputSchema: {
    type: 'object',
    properties: {
      expression: { type: 'string' },
    },
    required: ['expression'],
  },
  async handler(input) {
    // Custom logic here
    return { result: eval(input.expression) };
  },
});
```

### Invocation Modes

| Mode | Description |
|------|-------------|
| `model` | LLM selects when to invoke (tool use) |
| `user` | User invokes explicitly (via command) |

## Commands

Commands are user-invoked operations triggered by `/namespace:command` syntax.

```yaml
# commands/search.yaml
name: search
description: Search the knowledge base
args:
  - name: query
    type: string
    required: true
    description: Search query
  - name: limit
    type: number
    required: false
    description: Max results
    default: 5
aliases:
  q: query
  l: limit
```

Usage: `/myplug:search "how to reset password" --limit 3`

Aliases allow shorthand: `/myplug:search -q "reset password" -l 3`

## MCP Server Connections

Connect to external MCP servers for additional tool access.

```yaml
# mcp/mcp.yaml
servers:
  - name: database
    transport: stdio
    command: npx
    args: ["@modelcontextprotocol/server-sqlite", "{{config.db_path}}"]
  - name: remote-api
    transport: sse
    url: "{{config.api_url}}/mcp"
```

Template variables (`{{config.key}}`) are resolved from plugin config at startup. Tools from MCP servers are registered as `@namespace/server.tool`.

### Transport Types

| Type | Description |
|------|-------------|
| `stdio` | Spawn a subprocess, communicate over stdin/stdout |
| `sse` | Connect to an SSE endpoint for streaming JSON-RPC |
| `http` | POST-based JSON-RPC (for Claude-compatible MCP servers) |

## Testing

### Validate Manifest

```bash
npx nexora-kit plugin validate ./my-plugin
```

### Run Plugin Tests

```bash
npx nexora-kit plugin test ./my-plugin
```

### E2E Testing with Test Harness

```typescript
import { createTestInstance, createTestPlugin, createMockLlm } from '@nexora-kit/testing';

const plugin = createTestPlugin({
  namespace: 'test',
  tools: [{ name: 'greet', handler: async () => ({ message: 'Hi!' }) }],
});

const instance = createTestInstance({
  llm: createMockLlm(['Hello from the bot!']),
  plugins: [plugin],
});

const events = await instance.chat('Hello');
```

## Hot Reload

During development, watch a plugin for changes:

```bash
npx nexora-kit plugin dev ./my-plugin
```

This watches the plugin directory and automatically reloads on file changes (300ms debounce). Skills, commands, and MCP configs are re-registered on reload.

## Claude Plugin Compatibility

NexoraKit can also load Claude-format plugins (`.claude-plugin/plugin.json`). Place them in the plugins directory and they will be auto-detected. The adapter converts Claude plugin structure to the NexoraKit format internally.
