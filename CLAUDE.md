# NexoraKit — Project Instructions

Enterprise chatbot platform — plugin-based, provider-agnostic, self-hosted.

## Project Structure

Turborepo monorepo with npm workspaces. **Package manager: npm** (do not use pnpm or yarn).

```
packages/
  core/          # Agent loop, context manager, memory, tool dispatcher
  llm/           # Provider abstraction, routing, fallback, token budgets
  plugins/       # Plugin loader, lifecycle, namespace isolation
  config/        # Hierarchical config resolution (zod)
  sandbox/       # Isolated execution, permission boundaries
  tool-registry/ # Dynamic tool discovery, semantic search
  skills/        # Skill framework: TS, YAML, MD handlers
  commands/      # Command parser, help generation
  mcp/           # MCP server manager, health monitoring
  api/           # REST + WebSocket gateway
  admin/         # Plugin registry, RBAC, audit logging
  cli/           # Developer CLI tooling
  testing/       # Test utilities, mock providers
examples/plugins/
  hello-world/   # Example plugin demonstrating skills and commands
```

### Dependency layers

Foundation (no internal deps): `sandbox`, `config`, `llm`
Core layer: `core` depends on llm, config, sandbox
Plugin layer: `plugins` depends on core, sandbox, config
Discovery: `tool-registry` depends on core
Independent: skills, commands, mcp, api, admin, cli, testing

## Commands

```bash
npm run build       # turbo build (respects dependency graph)
npm run dev         # turbo dev (watch mode, persistent)
npm run test        # turbo test (runs after build)
npm run lint        # turbo lint
npm run typecheck   # turbo typecheck (runs after deps build)
npm run clean       # turbo clean
npx vitest          # run tests directly
```

## Conventions

- All packages use ES modules (`"type": "module"`)
- TypeScript strict mode, target ES2022, module Node16
- Source in `src/`, output in `dist/`
- Scoped under `@nexora-kit/`
- Vitest for testing, ESLint + Prettier for linting/formatting
- Node.js >= 20.0.0

## Feature Planning

For non-trivial features, create planning docs in the ClawdNotes vault (`2-Projects/nexora-kit/`) before writing code — PRDs and dev plans live there, not in this repo. This repo contains only external-facing documentation.

Skip planning docs for small bug fixes or single-file changes — use your judgment.

## Frontend Lessons

### Radix ScrollArea breaks flex truncation
Radix UI's `ScrollArea` injects an inner content wrapper with inline `style="min-width:100%;display:table"`. The `display:table` makes the wrapper grow to fit content, breaking `truncate` and `min-w-0` flex patterns — flex children expand past the viewport and get clipped invisibly.
**Fix:** Override the inline style on the ScrollArea's content div:
```tsx
<ScrollArea className="[&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!min-w-0">
```

### Tailwind `group-hover` conflicts with shadcn sidebar
The shadcn sidebar uses `group` on wrapper elements. If a child component also uses `group` for hover states, `group-hover:` matches the wrong ancestor. **Fix:** Use named groups: `group/name` and `group-hover/name:`.

### UI debugging
Use Playwright for headless screenshots when debugging layout issues:
```bash
cd /tmp && npm init -y && npm install playwright && npx playwright install chromium
```
Then write a `.mjs` script to set localStorage auth, navigate, hover, and screenshot. Dump computed styles/widths to understand layout chain.

## Agent Loop & Prompt Gotchas

### Custom bot prompts bypass `DEFAULT_SYSTEM_PROMPT`
`BotRunner` overrides `systemPrompt` on the request, so changes to `default-prompt.ts` have no effect for bots with custom prompts. To inject guidance that **always applies**, add it to `SystemPromptBuilder.buildTurnReminders()` — its output is appended via the working memory section regardless of the base prompt.

### Keyword tool selector misses semantic intent
`ToolIndex.search()` uses keyword scoring on tool `name + description`. User queries like "show properties with work orders" won't keyword-match tools named `kyvos_execute_query`. For MCP tools with domain-specific names, configure them as `essentialTools` in `AdaptiveToolSelectorOptions`, or rely on `_search_tools` discovery (only available in search mode, >40 tools).

### LLMs prefer text answers over tool calls
Even with tools available, LLMs generate raw SQL/code as text unless the prompt explicitly forbids it. The turn-1 reminder in `system-prompt-builder.ts` handles this. When debugging "LLM didn't use tools," check: (1) are the tools in the tool set sent to the LLM? (2) is the prompt instructing tool use? Don't just edit `default-prompt.ts` — check if a custom prompt overrides it.

### Multi-step tool chaining requires prompt guidance
The agent loop already supports looping (tool call → result → next LLM turn), but LLMs stop after intermediate results (e.g. showing generated SQL) unless the prompt says to complete workflows end-to-end. This is a prompt issue, not an agent loop issue.