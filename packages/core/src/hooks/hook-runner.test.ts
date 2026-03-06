import { describe, it, expect } from 'vitest';
import { runHook, runHooks } from './hook-runner.js';
import type { RegisteredHook } from './hook-registry.js';
import type { HookEventPayload } from './hook-events.js';

const payload: HookEventPayload = {
  sessionId: 'test-session',
  hookEventName: 'PreToolUse',
  toolName: 'Bash',
  toolInput: { command: 'echo hello' },
};

function makeHook(command: string, args?: string[]): RegisteredHook {
  return {
    namespace: 'test-plugin',
    event: 'PreToolUse',
    config: { command, args },
  };
}

describe('runHook', () => {
  it('returns allow on exit 0', async () => {
    const result = await runHook(makeHook('true'), payload);
    expect(result.verdict).toBe('allow');
  });

  it('returns block on exit 2', async () => {
    const hook = makeHook('bash', ['-c', 'echo "Blocked: dangerous" >&2; exit 2']);
    const result = await runHook(hook, payload);
    expect(result.verdict).toBe('block');
    expect(result.reason).toContain('Blocked: dangerous');
  });

  it('returns allow on non-zero, non-2 exit', async () => {
    const hook = makeHook('bash', ['-c', 'echo "warning" >&2; exit 1']);
    const result = await runHook(hook, payload);
    expect(result.verdict).toBe('allow');
    expect(result.reason).toContain('warning');
  });

  it('captures stdout as injectedContext on exit 0', async () => {
    const hook = makeHook('echo', ['injected context here']);
    const result = await runHook(hook, payload);
    expect(result.verdict).toBe('allow');
    expect(result.injectedContext).toBe('injected context here');
  });

  it('handles non-existent command gracefully', async () => {
    const hook = makeHook('/nonexistent/command/that/does/not/exist');
    const result = await runHook(hook, payload);
    expect(result.verdict).toBe('allow');
    expect(result.reason).toContain('Hook error');
  });
});

describe('runHooks', () => {
  it('returns allow when no hooks', async () => {
    const result = await runHooks([], payload);
    expect(result.verdict).toBe('allow');
  });

  it('blocks if any hook blocks', async () => {
    const hooks = [
      makeHook('true'),
      makeHook('bash', ['-c', 'echo "nope" >&2; exit 2']),
    ];
    const result = await runHooks(hooks, payload);
    expect(result.verdict).toBe('block');
  });

  it('aggregates injected context from multiple hooks', async () => {
    const hooks = [
      makeHook('echo', ['context-a']),
      makeHook('echo', ['context-b']),
    ];
    const result = await runHooks(hooks, payload);
    expect(result.verdict).toBe('allow');
    expect(result.injectedContext).toContain('context-a');
    expect(result.injectedContext).toContain('context-b');
  });
});
