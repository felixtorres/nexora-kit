# PRD: Claude Plugin Compatibility

## Problem

NexoraKit's plugin system and Claude Code's plugin system have diverged significantly. Plugins built for one cannot run on the other. For an enterprise chatbot platform, this is a critical gap — users should be able to:

1. Take a Claude Code skill/plugin and run it on NexoraKit with zero or minimal changes
2. Build skills in NexoraKit and export them to Claude Code
3. Share plugins across both ecosystems via a common format

The divergence exists across every layer: skill format, execution model, commands, tool exposure, MCP handling, resource bundling, and plugin manifest.

## Current State vs Claude Code

### Skills

| Capability | Claude Code | NexoraKit | Gap |
|------------|------------|-----------|-----|
| Format | SKILL.md (frontmatter + markdown body) | YAML or MD with prompt template | Different schema, different semantics |
| Execution | Behavioral injection — Claude reads instructions and orchestrates tools | Prompt template rendered → single LLM call → return result | Fundamentally different model |
| Progressive disclosure | 3-tier: metadata → body → bundled resources | 2-tier: metadata → prompt | No resource tier |
| Frontmatter fields | name, description, argument-hint, disable-model-invocation, user-invocable, allowed-tools, model, context, agent, hooks | name, description, invocation, parameters | Missing 8+ fields |
| String substitution | $ARGUMENTS, $N, ${CLAUDE_SKILL_DIR}, ${CLAUDE_SESSION_ID} | {{var}} Mustache templates with config.* | Incompatible systems |
| Subagent forking | `context: fork` spawns isolated subagent | Not supported | No forking |
| Tool restriction | `allowed-tools` whitelists tools | Not supported | No restriction |
| Hooks | Per-skill hooks in frontmatter | Not supported | No hooks |
| Composition | Claude can read references, run scripts, call tools | `invoke()` throws "not yet implemented" | No composition |

### Commands

| Capability | Claude Code | NexoraKit | Gap |
|------------|------------|-----------|-----|
| Format | .md files or SKILL.md with user-invocable | YAML with args schema | Different format |
| Invocation | `/command-name args` (free-form string) | `/namespace:command args` (parsed arguments) | Different parsing |
| Merging | Commands and skills unified under `/` namespace | Separate registries (SkillRegistry, CommandRegistry) | Split systems |

### Plugin Manifest

| Capability | Claude Code | NexoraKit | Gap |
|------------|------------|-----------|-----|
| Manifest | `.claude-plugin/plugin.json` | `plugin.yaml` at root | Different format & location |
| Discovery | Auto-discovers from standard directories | Hardcoded directory scan | Different conventions |
| Components | skills, commands, agents, hooks, mcpServers, lspServers, outputStyles, settings | skills, commands, mcp, permissions, config | Missing agents, hooks, LSP, output styles |
| MCP config | `.mcp.json` at plugin root | `mcp/mcp.yaml` | Different format |

### Resource Bundling

| Capability | Claude Code | NexoraKit | Gap |
|------------|------------|-----------|-----|
| scripts/ | Executable scripts Claude can run via Bash | Not supported | Missing |
| references/ | Docs loaded on-demand when Claude needs context | Not supported | Missing |
| assets/ | Static files (templates, icons, fonts) | Not supported | Missing |
| On-demand loading | Claude decides when to read supporting files | Everything loaded upfront or not at all | No lazy loading |

### Hooks

| Capability | Claude Code | NexoraKit | Gap |
|------------|------------|-----------|-----|
| Plugin hooks | hooks/hooks.json, fires at lifecycle events | Not supported | Missing entirely |
| Skill hooks | Per-skill hooks in frontmatter | Not supported | Missing |
| Events | PreToolUse, PostToolUse, PermissionRequest, SessionStart/End, etc. | Not supported | Missing |

## Solution

Make NexoraKit's plugin system a **superset** of Claude Code's plugin format. A Claude Code plugin should load and run on NexoraKit without modification. NexoraKit can extend the format with enterprise features (RBAC, audit logging, sandboxing) that Claude Code doesn't need.

### Design Principles

1. **Claude-first format**: Adopt Claude's SKILL.md, plugin.json, and .mcp.json as the primary formats. Keep YAML support as a NexoraKit extension.
2. **Behavioral skills**: Skills inject instructions into the agent loop context, not into a separate LLM call. The agent reads the skill and orchestrates tools — same as Claude Code.
3. **Progressive disclosure**: 3-tier loading — metadata always in context, body loaded on invoke, resources loaded on demand.
4. **Superset, not fork**: Every Claude Code plugin field is supported. NexoraKit adds fields Claude Code ignores (permissions, sandbox config, enterprise config).

## Acceptance Criteria

### P0 — Must Have

- [ ] SKILL.md format parsed with all Claude Code frontmatter fields (name, description, argument-hint, disable-model-invocation, user-invocable, allowed-tools, model, context, agent, hooks)
- [ ] Skills execute as behavioral injections into agent context, not as isolated LLM calls
- [ ] String substitution: $ARGUMENTS, $N, ${CLAUDE_SKILL_DIR}, ${CLAUDE_SESSION_ID} (mapped to NexoraKit equivalents)
- [ ] Bundled resources: scripts/, references/, assets/ discovered and available to agent
- [ ] `.claude-plugin/plugin.json` manifest format supported alongside existing plugin.yaml
- [ ] `.mcp.json` config format supported alongside existing mcp/mcp.yaml
- [ ] Commands defined as SKILL.md with `user-invocable: true` work via `/name` invocation
- [ ] Progressive disclosure: skill descriptions in context, full body loaded on invoke, resources loaded on demand
- [ ] Existing NexoraKit YAML skills continue to work (backward compatibility)

### P1 — Should Have

- [ ] `context: fork` spawns isolated subagent execution
- [ ] `allowed-tools` restricts tool access during skill execution
- [ ] Plugin hooks (PreToolUse, PostToolUse) fire at lifecycle events
- [ ] Skill-scoped hooks from frontmatter active during skill execution
- [ ] Skill composition: one skill can invoke another
- [ ] `${CLAUDE_PLUGIN_ROOT}` and env variable substitution in MCP configs

### P2 — Nice to Have

- [ ] LSP server configuration from plugins
- [ ] Output styles from plugins
- [ ] Plugin marketplace/registry compatibility
- [ ] Bi-directional export: NexoraKit YAML skills → SKILL.md format
- [ ] `model` field routes to specific provider/model in NexoraKit's LLM layer

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Agent loop changes break existing behavior | High | Feature-flag new execution model; run both paths during migration |
| Performance regression from behavioral injection | Medium | Skills that don't need agent loop fall back to prompt-template path |
| Claude Code format evolves | Medium | Pin to a compatibility version; abstract behind adapter layer |
| Hooks introduce security surface | Medium | Sandbox hook execution; require explicit permission grants |
| Backward compatibility with existing YAML plugins | High | Detect format automatically (SKILL.md vs .yaml); YAML path unchanged |

## Non-Goals

- Replicating Claude Code's IDE integrations (VS Code, JetBrains)
- Supporting Claude Code's `/help`, `/clear`, and other built-in CLI commands
- Matching Claude Code's exact UI rendering (terminal output styles)
- Real-time sync with Claude Code plugin marketplace (one-time import is fine)
