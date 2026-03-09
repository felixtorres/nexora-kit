# Generate Eval Configuration

Generate eval configuration (eval.yaml + scenario files) by inspecting a nexora-kit instance's installed plugins, skills, commands, and MCP connections.

## Arguments

- `$ARGUMENTS` — path to the instance directory (defaults to `my-bot/` if empty)

## Instructions

### 1. Discover the Instance

Read the instance directory at the given path (or `my-bot/` if no argument provided).

**Required files:**
- `nexora.yaml` — instance config (LLM provider, auth, plugins directory, storage)

**Determine:**
- The plugins directory from `nexora.yaml` → `plugins.directory` (default: `./plugins`)
- The LLM provider and model (affects latency thresholds)
- Auth configuration (needed for eval target)

### 2. Scan Installed Plugins

For each subdirectory in the plugins directory:

1. **Read `plugin.yaml`** — extract namespace, name, description, permissions, config schema
2. **Scan `skills/`** — read each `.yaml` and `.md` file to get:
   - Skill name, description, invocation mode (model/user/both)
   - Parameters (names, types, required flag, descriptions)
   - Execution mode (prompt/behavioral/code)
   - Template content (to understand what the skill does)
3. **Scan `commands/`** — read each `.yaml` file to get:
   - Command name, description, arguments (names, types, required, defaults)
   - Whether it has a prompt (LLM-backed) or is handler-only
4. **Scan `mcp/mcp.yaml`** (if present) — extract MCP server names and transport type
   - MCP-backed plugins need higher latency thresholds (external process overhead)

### 3. Generate Eval Scenarios

For **each plugin**, generate a scenario YAML file at `<instance>/evals/<namespace>.yaml`.

#### Scenario Structure

```yaml
id: <namespace>
name: <plugin name> Eval
tags: [<namespace>, smoke, ci]
cases:
  # ... generated cases
```

#### Case Generation Rules

**For each skill (invocation: model or both):**
- Generate a **smoke case** that asks the LLM to exercise the skill naturally
  - The user message should be a realistic request that would trigger the skill
  - Use the skill description and parameters to craft a natural prompt
  - If the skill has required parameters, reference them in the message
- Add validators:
  - `max_turns: 5` (simple skills) or `max_turns: 10` (multi-step / MCP-backed)
  - `max_latency_ms: 15000` (local) or `max_latency_ms: 45000` (MCP-backed)
  - `max_tokens: 10000` (default) or `max_tokens: 5000` (simple Q&A skills)
  - Content validators based on expected behavior:
    - If the skill prompt references specific output patterns, add `contains` or `regex`
    - If the skill description implies structured output, add `regex` for key terms

**For each command:**
- Generate a case that invokes the command with example arguments
  - Format: `/<namespace>:<command-name> <arg1> --flag value`
  - Use default values from argument definitions where available
  - For required args without defaults, use realistic placeholder values
- Add validators:
  - `max_turns: 3` (commands are direct, fewer turns expected)
  - `max_latency_ms: 10000` (no LLM if handler-only) or `max_latency_ms: 20000` (prompt-backed)
  - `contains` validators for expected output keywords based on the command description

**For multi-turn scenarios (plugins with 2+ related skills):**
- Generate one **workflow case** that chains 2-3 related skills in a realistic user flow
  - Use multiple `messages` entries to simulate a conversation
  - Each message should build on the previous response
- Add validators:
  - `max_turns: 12`
  - `max_latency_ms: 60000`
  - `regex` validators for expected domain terms

**For MCP-backed plugins:**
- Add a **connectivity case** — a simple message that should trigger at least one MCP tool call
- Use higher latency thresholds throughout (MCP adds process startup + IPC overhead)
- Add `regex` validators for domain-specific terms the MCP tools would return

#### Latency Threshold Guidelines

| Model pattern | Base latency | Skill latency | MCP latency |
|---|---|---|---|
| `haiku` | 10000 | 15000 | 30000 |
| `sonnet` | 15000 | 20000 | 45000 |
| `opus` | 20000 | 30000 | 60000 |
| `gpt-4o-mini` | 10000 | 15000 | 30000 |
| `gpt-4o` / `gpt-4` | 15000 | 25000 | 45000 |
| default | 15000 | 20000 | 45000 |

### 4. Generate eval.yaml

Create `<instance>/eval.yaml` with:

```yaml
target:
  type: config
  configPath: ./nexora.yaml

scenarios:
  # List all generated scenario files
  - ./evals/<namespace-1>.yaml
  - ./evals/<namespace-2>.yaml
  # ...

repeat: 1
concurrency: 1
baselineDir: ./eval-baselines

regression:
  maxTokenIncrease: 0.15
  maxLatencyIncrease: 0.25
  maxPassRateDecrease: 0.05

output: console
```

### 5. Create the evals directory

If `<instance>/evals/` doesn't exist, create it.
If `<instance>/eval-baselines/` doesn't exist, create it with a `.gitkeep`.

### 6. Output Summary

After generating, print a summary:

```
Generated eval configuration for <instance-name>:

  eval.yaml           — main config (target: config, <N> scenarios)
  evals/<ns>.yaml     — <plugin-name>: <X> cases (<Y> skills, <Z> commands)
  ...

Total: <N> scenarios, <M> test cases

Run with: npx nexora-eval --config <instance>/eval.yaml
```

### Important Notes

- **Do NOT overwrite existing scenario files** without asking. If a file already exists, show a diff of what would change and ask the user to confirm.
- **Do NOT hard-code plugin-specific knowledge.** Generate cases purely from what's declared in the plugin manifest, skills, and commands. The skill should work for any plugin.
- **Prefer realistic messages** over synthetic test strings. Use the skill/command descriptions to craft messages a real user would send.
- **Tag all scenarios** with their namespace + `smoke` + `ci` for filtering.
- If the instance has no plugins installed, say so and suggest installing example plugins.
