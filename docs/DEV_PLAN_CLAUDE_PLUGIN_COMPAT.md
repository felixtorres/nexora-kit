# Dev Plan: Claude Plugin Compatibility

## Architecture Overview

The change touches nearly every package in the monorepo. The core insight is that Claude Code skills are **behavioral overlays** — they modify how the agent behaves — while NexoraKit skills are currently **prompt templates** that produce a single LLM response. Bridging this gap requires changes to the agent loop itself.

```
┌─────────────────────────────────────────────────────────┐
│                    Plugin Loader                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ plugin.yaml   │  │ plugin.json  │  │ Auto-discover │ │
│  │ (NexoraKit)   │  │ (Claude fmt) │  │ (fallback)    │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬────────┘ │
│         └─────────┬───────┘─────────────────┘           │
│                   ▼                                      │
│          Unified PluginManifest                          │
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│                  Skill System                            │
│                                                          │
│  ┌────────────┐  ┌────────────────┐  ┌───────────────┐ │
│  │ YAML skill  │  │ SKILL.md       │  │ Code skill    │ │
│  │ (template)  │  │ (behavioral)   │  │ (TypeScript)  │ │
│  └──────┬─────┘  └──────┬─────────┘  └──────┬────────┘ │
│         │               │                     │          │
│         ▼               ▼                     ▼          │
│  ┌──────────────────────────────────────────────────┐   │
│  │            SkillHandlerFactory v2                 │   │
│  │  ┌────────────┐ ┌─────────────┐ ┌─────────────┐ │   │
│  │  │ Prompt     │ │ Behavioral  │ │ Code        │ │   │
│  │  │ Handler    │ │ Handler     │ │ Handler     │ │   │
│  │  │ (existing) │ │ (NEW)       │ │ (existing)  │ │   │
│  │  └────────────┘ └─────────────┘ └─────────────┘ │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│                  Agent Loop (core)                        │
│                                                          │
│  Turn start                                              │
│    ├── Collect active skill overlays                     │
│    ├── Build system prompt + skill instructions          │
│    ├── Apply tool restrictions (allowed-tools)           │
│    ├── Send to LLM with tools                           │
│    ├── Process tool calls (with hook firing)             │
│    │     ├── PreToolUse hooks                            │
│    │     ├── Execute tool                                │
│    │     └── PostToolUse hooks                           │
│    └── Loop until done                                   │
│                                                          │
│  Skill activation:                                       │
│    ├── Inline: inject instructions into working memory   │
│    └── Fork: spawn subagent with skill as system prompt  │
└─────────────────────────────────────────────────────────┘
```

## Phases

### Phase 1: Dual-Format Plugin Loader

**Goal**: Load both `plugin.yaml` (NexoraKit) and `.claude-plugin/plugin.json` (Claude) into a unified manifest.

**Packages**: `plugins`

**Changes**:

1. **New: `claude-manifest-parser.ts`**
   - Parse `.claude-plugin/plugin.json` schema
   - Map Claude fields to NexoraKit `PluginManifest`
   - Resolve component paths (skills/, commands/, agents/, hooks/)
   - Support `${CLAUDE_PLUGIN_ROOT}` substitution

2. **Update: `loader.ts`**
   - Detection order: check for `.claude-plugin/plugin.json` first, fall back to `plugin.yaml`
   - When Claude format detected, use `claude-manifest-parser`
   - Discover skills as SKILL.md directories (not just .yaml/.md files)
   - Discover bundled resources (scripts/, references/, assets/) per skill

3. **New: `resource-discovery.ts`**
   - Scan skill directories for bundled resources
   - Build resource manifest: `{ scripts: string[], references: string[], assets: string[] }`
   - Attach to SkillDefinition as `resources` field

4. **Update: Plugin manifest types**
   - Add optional fields: `agents`, `hooks`, `lspServers`, `outputStyles`, `settings`
   - Add `format: 'nexora' | 'claude'` discriminator

**Tests**: Load a Claude-format plugin, verify all fields parsed correctly. Load existing NexoraKit plugins, verify no regression.

---

### Phase 2: SKILL.md Behavioral Parser

**Goal**: Parse Claude's SKILL.md format into an extended SkillDefinition that supports behavioral execution.

**Packages**: `skills`

**Changes**:

1. **New: `skill-md-parser.ts`** (distinct from existing `md-parser.ts`)
   - Parse full Claude frontmatter: name, description, argument-hint, disable-model-invocation, user-invocable, allowed-tools, model, context, agent, hooks
   - Body is raw markdown instructions (NOT a prompt template)
   - String substitution: $ARGUMENTS, $N, ${CLAUDE_SKILL_DIR}, ${CLAUDE_SESSION_ID}

2. **Update: `types.ts`**
   ```typescript
   export type SkillExecutionMode = 'prompt' | 'behavioral' | 'code';

   export interface SkillDefinition {
     name: string;
     description: string;
     invocation: SkillInvocation;
     parameters: Record<string, SkillParameterDef>;
     prompt?: string;           // For prompt-mode skills (existing YAML)
     handler?: SkillCodeHandler; // For code-mode skills (existing TS)

     // New — Claude-compatible fields
     executionMode: SkillExecutionMode;
     body?: string;              // Raw markdown instructions (behavioral mode)
     argumentHint?: string;
     disableModelInvocation?: boolean;
     userInvocable?: boolean;    // Default true
     allowedTools?: string[];
     modelOverride?: string;
     context?: 'inline' | 'fork';
     agentType?: string;
     hooks?: SkillHooks;
     resources?: SkillResources;
   }

   export interface SkillResources {
     scripts: string[];    // Absolute paths
     references: string[]; // Absolute paths
     assets: string[];     // Absolute paths
     baseDir: string;      // Skill directory root
   }

   export interface SkillHooks {
     PreToolUse?: HookConfig[];
     PostToolUse?: HookConfig[];
   }
   ```

3. **Update: `md-parser.ts`**
   - Detect format: if frontmatter has Claude-specific fields (allowed-tools, context, etc.), route to `skill-md-parser`
   - Otherwise, use existing parser (backward compat)

4. **Auto-detection in loader**:
   - `SKILL.md` in a directory → Claude behavioral format
   - `*.yaml` / `*.yml` → NexoraKit prompt template format
   - `*.md` (not SKILL.md) → NexoraKit markdown prompt format

4. **New: Model tier mapping in `packages/llm/`**
   - Define `ModelTier` enum: `fast`, `balanced`, `powerful`
   - Add mapping: `haiku→fast`, `sonnet→balanced`, `opus→powerful`
   - `resolveModelTier(tier: string): string` returns the configured model ID for the active provider
   - Explicit model IDs (e.g., `gpt-4o`) pass through unchanged
   - Used by SkillHandlerFactory when `modelOverride` is set

**Tests**: Parse various SKILL.md files with all frontmatter combinations. Verify backward compat with existing MD skills. Verify model tier resolution across providers.

---

### Phase 3: Behavioral Skill Execution

**Goal**: Skills can inject instructions into the agent loop context instead of running as isolated LLM calls.

**Packages**: `core`, `skills`

This is the hardest phase. The agent loop must support "active skills" that modify its behavior.

**Changes**:

1. **New: `behavioral-handler.ts`** in `packages/skills/`
   - Does NOT call LLM directly
   - Returns a `BehavioralSkillActivation` object:
     ```typescript
     interface BehavioralSkillActivation {
       instructions: string;       // Rendered SKILL.md body
       allowedTools?: string[];    // Tool whitelist
       resources: SkillResources;  // Available files
       context: 'inline' | 'fork';
       agentType?: string;
       hooks?: SkillHooks;
       deactivate: () => void;     // Cleanup callback
     }
     ```

2. **Update: `SkillHandlerFactory`**
   - Three creation paths:
     - `executionMode === 'prompt'` → existing `createPromptHandler` (YAML skills)
     - `executionMode === 'code'` → existing `createCodeHandler` (TS skills)
     - `executionMode === 'behavioral'` → new `createBehavioralHandler`
   - Behavioral handler returns activation object instead of string result

3. **Update: Agent loop in `core`**
   - `SystemPromptBuilder` accepts active skill overlays
   - When a behavioral skill activates (inline mode):
     - Append skill instructions to working memory / turn reminders
     - Apply tool restrictions for the duration
     - Fire skill hooks alongside global hooks
   - When a behavioral skill activates (fork mode):
     - Spawn via existing `SubAgentRunner` with skill body as task prompt
     - Map agent type to tool filter: `Explore`/`Plan` → read-only tools, `general-purpose` → all tools
     - `allowedTools` from skill frontmatter applied as additional tool filter
     - Subagent has access to skill resources via standard Read/Bash tools
     - Return subagent result to main conversation

4. **New: `skill-context-manager.ts`** in `core`
   - Tracks active skills per conversation
   - Manages activation/deactivation lifecycle
   - Handles `$ARGUMENTS` substitution at activation time
   - Provides `${CLAUDE_SKILL_DIR}` resolution

5. **Resource access during execution**
   - Agent can read files from `resources.references` and `resources.assets` via standard Read tool
   - Agent can execute files from `resources.scripts` via sandboxed Bash
   - Paths are resolved relative to skill directory

**Tests**: Activate a behavioral skill, verify instructions appear in agent context. Verify tool restrictions apply. Test fork mode spawns subagent. Test resource access.

---

### Phase 4: Claude-Format Skill Invocation

**Goal**: SKILL.md skills with `user-invocable: true` are accessible via `/name` invocation. Registries stay separate.

**Packages**: `commands`, `skills`, `plugins`

**Changes**:

1. **Update: Skill lifecycle registration**
   - SKILL.md with `user-invocable: true` (default) registers in BOTH `SkillRegistry` and `CommandRegistry`
   - SKILL.md with `user-invocable: false` registers in `SkillRegistry` only (model-only)
   - Existing YAML commands stay in `CommandRegistry` only — no change
   - Collision resolution: if a skill and command share a name, skill takes precedence (with warning log)

2. **Update: Command parser**
   - Accept free-form arguments (not just parsed args) for behavioral skills
   - Pass raw argument string as `$ARGUMENTS` to skill activation
   - YAML commands with structured args still parse as before

3. **Update: Command autocomplete**
   - Query both `CommandRegistry` and `SkillRegistry.listForUser()` for autocomplete
   - Include `argumentHint` from SKILL.md frontmatter

**Tests**: Invoke a SKILL.md via `/name args`, verify activation. Verify YAML commands still work. Test collision handling.

---

### Phase 5: Hook System

**Goal**: Fire hooks at lifecycle events, supporting both plugin-level and skill-level hooks.

**Packages**: `core`, `plugins`, `sandbox`

**Changes**:

1. **New: `packages/core/src/hooks/`**
   - `hook-runner.ts`: Execute hook scripts (JSON stdin, exit code protocol)
   - `hook-registry.ts`: Register hooks from plugins, skills, project config
   - `hook-events.ts`: Event type definitions (PreToolUse, PostToolUse, SessionStart, etc.)

2. **Hook execution model**
   - Hooks are shell commands or scripts
   - Input: JSON on stdin (session_id, event_name, tool_name, tool_input)
   - Output: exit 0 (allow), exit 2 (block + stderr reason), other (allow + log)
   - Hooks run in sandbox with plugin's permission set

3. **Integration points**
   - Tool dispatcher: fire PreToolUse before, PostToolUse after
   - Session manager: fire SessionStart/End
   - Skill activation: register/deregister skill-scoped hooks

**Tests**: Hook blocks a tool call. Hook allows with injected context. Skill-scoped hook only fires during skill execution.

---

### Phase 6: MCP Config Compatibility

**Goal**: Support `.mcp.json` format alongside existing `mcp/mcp.yaml`.

**Packages**: `mcp`, `plugins`

**Changes**:

1. **New: `mcp-json-parser.ts`**
   - Parse `.mcp.json` (Claude Code format)
   - Map to existing `McpServerConfig` type
   - Support `${CLAUDE_PLUGIN_ROOT}` path substitution

2. **Update: Plugin loader**
   - Check for `.mcp.json` at plugin root
   - Fall back to `mcp/mcp.yaml`
   - Merge inline `mcpServers` from plugin.json manifest

3. **Update: MCP manager**
   - Support `type` field on server config (stdio, http, sse) — verify existing support
   - Add `headers` support for HTTP/SSE transport auth

**Tests**: Load MCP config from .mcp.json. Verify env variable substitution. Test HTTP transport with headers.

---

## Phase Dependencies

```
Phase 1 (Dual-Format Loader)
    │
    ├── Phase 2 (SKILL.md Parser)
    │       │
    │       └── Phase 3 (Behavioral Execution)  ← hardest, most risk
    │               │
    │               └── Phase 4 (Unified Commands)
    │                       │
    │                       └── Phase 5 (Hooks)
    │
    └── Phase 6 (MCP Config) ← independent, can parallel with 2-5
```

## Testing Strategy

### Unit Tests
- Each parser has its own test suite with Claude-format fixtures
- Behavioral handler tested in isolation with mock agent context
- Hook runner tested with mock scripts

### Integration Tests
- **End-to-end plugin load**: Claude-format plugin → loader → skill registration → activation → agent execution
- **Cross-format**: Same plugin behavior from YAML and SKILL.md definitions
- **Backward compat**: All existing example plugins pass without changes

### Fixtures
Create `tests/fixtures/claude-plugins/` with:
- Minimal Claude plugin (single skill, no MCP)
- Full Claude plugin (skills, commands, hooks, MCP, resources)
- Edge cases (no manifest, auto-discovery)

## Migration Path

### For Existing NexoraKit Plugins
No changes required. YAML format continues to work. The loader auto-detects format.

### For Claude Code Plugin Authors
Drop the plugin directory into NexoraKit's plugin path. The loader detects `.claude-plugin/plugin.json` or `SKILL.md` files and uses Claude-format parsing.

### For NexoraKit Plugin Authors Wanting Claude Compat
Optional: restructure plugin to use SKILL.md format and plugin.json manifest. Provide a migration guide and CLI tool (`nexora plugin convert`).

## Decisions (Resolved 2026-03-06)

### D1: Skill Model Override — Provider-Agnostic Tiers
Define 3 tiers in the LLM package: `fast`, `balanced`, `powerful`. Map Claude names automatically (`haiku→fast`, `sonnet→balanced`, `opus→powerful`). This is the one required adaptation when porting a Claude-native plugin. If someone writes an explicit model ID (e.g., `gpt-4o`), pass through to the provider.

### D2: Fork Mode — Map to SubAgentRunner, Design Toward Bot Later
`context: fork` maps to existing `SubAgentRunner`. The skill body becomes the task prompt, `allowedTools` becomes the tool filter. Agent type mapping:
- `Explore` → read-only tools
- `Plan` → read-only tools
- `general-purpose` → all tools

Bots are NOT replaced. They serve a different purpose — persistent, configured, user-facing identities with workspace bindings and orchestration strategies. Claude fork-mode skills are ephemeral task workers at a different layer. Future work may allow Bots to be expressible as SKILL.md bundles (portable bot definitions), but that's a separate feature.

### D3: Hook Security — Disabled by Default, Permission-Gated
Hooks are disabled by default. When an admin enables them for a plugin, they review the declared permissions. Hooks run with only those permissions enforced by the sandbox's `PermissionGate`. Nothing executes without explicit approval.

### D4: Registry Merge — Defer
Keep `SkillRegistry` and `CommandRegistry` separate. No unified invocation registry for now. If an adapter layer adds clear value later, revisit. Claude-format skills register in `SkillRegistry` for behavioral execution; user-invocable skills also register in `CommandRegistry` for `/name` invocation.

### D5: Template Syntax — Format Determines Syntax
No mixing. YAML files use Mustache (`{{var}}`). SKILL.md files use `$ARGUMENTS` / `${CLAUDE_SKILL_DIR}`. The formats map to different execution models (prompt template vs behavioral injection), so different substitution is natural.
