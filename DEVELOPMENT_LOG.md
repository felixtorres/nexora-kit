# Development Log

## 2026-03-06

### Completed
- Reviewed and fixed verbiage across all 10 example plugin skills (schema consistency, broken templates, contradictory wording, impossible instructions, naming)
- Audited NexoraKit plugin system vs Claude Code plugin system — identified major compatibility gaps
- Created PRD: `docs/PRD_CLAUDE_PLUGIN_COMPAT.md`
- Created Dev Plan: `docs/DEV_PLAN_CLAUDE_PLUGIN_COMPAT.md` — 6-phase plan covering dual-format loader, SKILL.md behavioral parser, behavioral execution, unified commands, hooks, and MCP config compat

### In Progress
- Claude Plugin Compatibility — Phase 1-5 COMPLETE, Phase 6 largely done (landed in Phase 1)

### Decisions Made
- **D1 Model tiers**: Provider-agnostic tiers (fast/balanced/powerful), map Claude names automatically
- **D2 Fork mode**: Map to existing SubAgentRunner, agent types become tool filters. Bots NOT replaced.
- **D3 Hooks**: Disabled by default, permission-gated when admin enables
- **D4 Registry merge**: Deferred. Keep SkillRegistry + CommandRegistry separate. Skills register in both when user-invocable.
- **D5 Templates**: Format determines syntax — YAML=Mustache, SKILL.md=$ARGUMENTS. No mixing.

### Phase 1 Deliverables
- `core/types.ts`: Added `SkillResources`, `PluginFormat`, extended `PluginManifest` with `format`, `author`, `homepage`, `repository`, `license`, `keywords`
- `skills/types.ts`: Added `resources?: SkillResources` to `SkillDefinition`
- New: `plugins/resource-discovery.ts` — discovers scripts/, references/, assets/ per skill directory
- `plugins/claude-compat.ts`: Expanded `ClaudePluginJson` with full schema, `${CLAUDE_PLUGIN_ROOT}` substitution, inline mcpServers from plugin.json, structured resource discovery (no longer appends references to prompt), smart permission inference, `format: 'claude'` tag
- `plugins/manifest.ts`: Added optional fields to Zod schema (author, homepage, repository, license, keywords, format)
- `plugins/loader.ts`: Sets `format: 'nexora'` on loaded plugins
- Tests: 17 new tests across resource-discovery.test.ts, claude-compat.test.ts, loader.test.ts — all 462 pass

### Blockers
- None

### Phase 2 Deliverables
- `skills/types.ts`: Added `SkillExecutionMode`, `SkillHookConfig`, `SkillHooks`, and 10 Claude-compatible fields to `SkillDefinition` (executionMode, body, argumentHint, disableModelInvocation, userInvocable, allowedTools, modelOverride, context, agentType, hooks)
- New: `skills/skill-md-parser.ts` — Full Claude SKILL.md frontmatter parser with Zod validation. Parses allowed-tools (comma-separated), maps invocation semantics (user-invocable/disable-model-invocation → NexoraKit invocation enum), supports hooks
- `skills/md-parser.ts` — Auto-detection: peeks at frontmatter for Claude-specific fields, routes to behavioral parser or prompt parser accordingly
- New: `llm/model-tiers.ts` — Provider-agnostic model tier system. Maps haiku→fast, sonnet→balanced, opus→powerful. Resolves via provider-specific defaults or custom config. Explicit model IDs pass through.
- Tests: 25 new tests (skill-md-parser.test.ts, model-tiers.test.ts), 557 total passing, full monorepo green

### Phase 3 Deliverables
- New: `core/skill-activation.ts` — `SkillActivationManager` tracks active behavioral skills per conversation. Supports activate/deactivate/deactivateAll, returns combined instructions for inline skills, computes tool restriction intersection across active skills.
- `core/system-prompt-builder.ts` — New `activeSkillInstructions` component injected after base prompt, before artifacts/skill index.
- `core/agent-loop.ts` — Accepts `skillActivationManager` option. Each turn: injects active skill instructions into system prompt. After tool selection: filters tools by `allowedTools` from active skills (internal `_`-prefixed tools always allowed).
- `skills/handler-factory.ts` — New `createBehavioralHandler()`: substitutes $ARGUMENTS, $N, ${CLAUDE_SKILL_DIR}, ${CLAUDE_SESSION_ID} in skill body, activates the skill via SkillActivationManager, returns acknowledgment. Routes to behavioral handler when `executionMode === 'behavioral'`.
- Tests: 13 new tests (skill-activation.test.ts), 569 total passing, full monorepo green (30/30)

### Phase 4 Deliverables
- `plugins/lifecycle.ts` — User-invocable behavioral skills auto-register as commands in CommandRegistry during `enable()`. Handler dispatches to skill tool with `_arguments` for $ARGUMENTS substitution. Skips non-behavioral skills and respects `userInvocable: false`. Does not override existing commands with same name. Cleanup handled by existing `unregisterNamespace()` on disable.
- Tests: 5 new tests covering registration, skip conditions, collision handling, and cleanup.

### Phase 5 Deliverables
- New: `core/hooks/hook-events.ts` — HookEventName types (PreToolUse, PostToolUse, SessionStart, SessionEnd), HookEventPayload, HookResult, HookVerdict
- New: `core/hooks/hook-registry.ts` — HookRegistry: stores hooks per namespace, disabled by default, admin enables per namespace, supports skill-scoped hooks, filters by event + active skills
- New: `core/hooks/hook-runner.ts` — Spawns hook command as child process, sends JSON payload on stdin. Exit 0 = allow (stdout = injected context), exit 2 = block (stderr = reason), other = allow + log. Handles EPIPE gracefully. `runHooks()` aggregates multiple hooks — any block = blocked.
- Tests: 17 new tests (hook-registry.test.ts, hook-runner.test.ts)

### Next Steps
- Phase 6 (MCP Config Compat) — already done: ${CLAUDE_PLUGIN_ROOT} substitution, .mcp.json parsing, inline mcpServers all landed in Phase 1
- Integration testing: end-to-end test with a real Claude-format plugin
- Documentation: update docs/ with new plugin compatibility guide
