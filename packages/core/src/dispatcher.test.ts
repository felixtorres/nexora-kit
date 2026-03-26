import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolDispatcher, type PermissionChecker, type ToolExecutionContext } from './dispatcher.js';
import type { Permission } from './types.js';

describe('ToolDispatcher', () => {
  let dispatcher: ToolDispatcher;

  beforeEach(() => {
    dispatcher = new ToolDispatcher();
  });

  it('registers and dispatches a tool', async () => {
    dispatcher.register(
      { name: 'add', description: 'Add numbers', parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } } },
      async (input) => String(Number(input.a) + Number(input.b)),
    );

    const result = await dispatcher.dispatch({ id: '1', name: 'add', input: { a: 2, b: 3 } });
    expect(result.content).toBe('5');
    expect(result.isError).toBeUndefined();
  });

  it('returns error for unknown tool', async () => {
    const result = await dispatcher.dispatch({ id: '1', name: 'unknown', input: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not found');
  });

  it('catches handler errors', async () => {
    dispatcher.register(
      { name: 'fail', description: 'Fails', parameters: { type: 'object', properties: {} } },
      async () => { throw new Error('handler error'); },
    );

    const result = await dispatcher.dispatch({ id: '1', name: 'fail', input: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('handler error');
  });

  it('lists registered tools', () => {
    dispatcher.register(
      { name: 'tool-a', description: 'A', parameters: { type: 'object', properties: {} } },
      async () => 'a',
    );
    dispatcher.register(
      { name: 'tool-b', description: 'B', parameters: { type: 'object', properties: {} } },
      async () => 'b',
    );
    expect(dispatcher.listTools()).toHaveLength(2);
  });

  it('unregisters tools', () => {
    dispatcher.register(
      { name: 'tool-a', description: 'A', parameters: { type: 'object', properties: {} } },
      async () => 'a',
    );
    dispatcher.unregister('tool-a');
    expect(dispatcher.listTools()).toHaveLength(0);
    expect(dispatcher.hasHandler('tool-a')).toBe(false);
  });

  it('preserves toolUseId in result', async () => {
    dispatcher.register(
      { name: 'echo', description: 'Echo', parameters: { type: 'object', properties: {} } },
      async () => 'ok',
    );
    const result = await dispatcher.dispatch({ id: 'call-123', name: 'echo', input: {} });
    expect(result.toolUseId).toBe('call-123');
  });
});

describe('ToolDispatcher permission checks', () => {
  let dispatcher: ToolDispatcher;
  const grantedPermissions = new Map<string, Set<Permission>>();

  const checker: PermissionChecker = {
    check(ns: string, perm: Permission) {
      return grantedPermissions.get(ns)?.has(perm) ?? false;
    },
  };

  beforeEach(() => {
    dispatcher = new ToolDispatcher();
    dispatcher.setPermissionChecker(checker);
    grantedPermissions.clear();
  });

  it('blocks dispatch when plugin lacks required permission', async () => {
    dispatcher.register(
      { name: 'run-code', description: 'Run code', parameters: { type: 'object', properties: {} } },
      async () => 'executed',
      { namespace: 'my-plugin', requiredPermissions: ['code:execute'] },
    );

    const result = await dispatcher.dispatch({ id: '1', name: 'run-code', input: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Permission denied');
    expect(result.content).toContain('code:execute');
  });

  it('allows dispatch when plugin has required permission', async () => {
    grantedPermissions.set('my-plugin', new Set(['code:execute']));

    dispatcher.register(
      { name: 'run-code', description: 'Run code', parameters: { type: 'object', properties: {} } },
      async () => 'executed',
      { namespace: 'my-plugin', requiredPermissions: ['code:execute'] },
    );

    const result = await dispatcher.dispatch({ id: '1', name: 'run-code', input: {} });
    expect(result.content).toBe('executed');
    expect(result.isError).toBeUndefined();
  });

  it('checks all required permissions', async () => {
    grantedPermissions.set('my-plugin', new Set(['fs:read']));

    dispatcher.register(
      { name: 'read-write', description: 'RW', parameters: { type: 'object', properties: {} } },
      async () => 'done',
      { namespace: 'my-plugin', requiredPermissions: ['fs:read', 'fs:write'] },
    );

    const result = await dispatcher.dispatch({ id: '1', name: 'read-write', input: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('fs:write');
  });

  it('uses callerNamespace override when provided', async () => {
    grantedPermissions.set('caller-ns', new Set(['llm:invoke']));

    dispatcher.register(
      { name: 'ask-llm', description: 'Ask', parameters: { type: 'object', properties: {} } },
      async () => 'response',
      { namespace: 'owner-ns', requiredPermissions: ['llm:invoke'] },
    );

    const result = await dispatcher.dispatch({ id: '1', name: 'ask-llm', input: {} }, 'caller-ns');
    expect(result.content).toBe('response');
    expect(result.isError).toBeUndefined();
  });

  it('allows dispatch when no permissions required (even with checker)', async () => {
    dispatcher.register(
      { name: 'safe-tool', description: 'Safe', parameters: { type: 'object', properties: {} } },
      async () => 'ok',
      { namespace: 'my-plugin', requiredPermissions: [] },
    );

    const result = await dispatcher.dispatch({ id: '1', name: 'safe-tool', input: {} });
    expect(result.content).toBe('ok');
    expect(result.isError).toBeUndefined();
  });

  it('allows dispatch when no checker set (backward compatibility)', async () => {
    const noCheckerDispatcher = new ToolDispatcher();
    noCheckerDispatcher.register(
      { name: 'tool', description: 'T', parameters: { type: 'object', properties: {} } },
      async () => 'ok',
      { namespace: 'ns', requiredPermissions: ['code:execute'] },
    );

    const result = await noCheckerDispatcher.dispatch({ id: '1', name: 'tool', input: {} });
    expect(result.content).toBe('ok');
    expect(result.isError).toBeUndefined();
  });
});

describe('ToolDispatcher structured responses', () => {
  let dispatcher: ToolDispatcher;

  beforeEach(() => {
    dispatcher = new ToolDispatcher();
  });

  it('passes through blocks from ToolHandlerResponse', async () => {
    dispatcher.register(
      { name: 'card-tool', description: 'Returns card', parameters: { type: 'object', properties: {} } },
      async () => ({
        content: 'Here is a card',
        blocks: [{ type: 'card' as const, title: 'Order #1' }],
      }),
    );

    const result = await dispatcher.dispatch({ id: '1', name: 'card-tool', input: {} });
    expect(result.content).toBe('Here is a card');
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks![0].type).toBe('card');
  });

  it('handles string return (backward compat)', async () => {
    dispatcher.register(
      { name: 'text-tool', description: 'Returns string', parameters: { type: 'object', properties: {} } },
      async () => 'plain text',
    );

    const result = await dispatcher.dispatch({ id: '1', name: 'text-tool', input: {} });
    expect(result.content).toBe('plain text');
    expect(result.blocks).toBeUndefined();
  });

  it('returns ToolHandlerResponse without blocks', async () => {
    dispatcher.register(
      { name: 'no-blocks', description: 'Structured but no blocks', parameters: { type: 'object', properties: {} } },
      async () => ({ content: 'just content' }),
    );

    const result = await dispatcher.dispatch({ id: '1', name: 'no-blocks', input: {} });
    expect(result.content).toBe('just content');
    expect(result.blocks).toBeUndefined();
  });

  it('catches errors from structured handler', async () => {
    dispatcher.register(
      { name: 'fail', description: 'Fails', parameters: { type: 'object', properties: {} } },
      async () => { throw new Error('structured fail'); },
    );

    const result = await dispatcher.dispatch({ id: '1', name: 'fail', input: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('structured fail');
  });

  it('passes multiple blocks', async () => {
    dispatcher.register(
      { name: 'multi', description: 'Multi block', parameters: { type: 'object', properties: {} } },
      async () => ({
        content: '',
        blocks: [
          { type: 'text' as const, content: 'First' },
          { type: 'text' as const, content: 'Second' },
          { type: 'progress' as const, label: 'Loading' },
        ],
      }),
    );

    const result = await dispatcher.dispatch({ id: '1', name: 'multi', input: {} });
    expect(result.blocks).toHaveLength(3);
  });
});

describe('ToolDispatcher execution context', () => {
  let dispatcher: ToolDispatcher;

  beforeEach(() => {
    dispatcher = new ToolDispatcher();
  });

  it('forwards context to handler', async () => {
    const handler = vi.fn().mockResolvedValue('ok');
    dispatcher.register(
      { name: 'ctx-tool', description: 'Ctx', parameters: { type: 'object', properties: {} } },
      handler,
    );

    const ctx: ToolExecutionContext = { conversationId: 'conv-1', workspaceId: 'ws-1', userId: 'u1', teamId: 't1' };
    await dispatcher.dispatch({ id: '1', name: 'ctx-tool', input: { x: 1 } }, undefined, ctx);

    expect(handler).toHaveBeenCalledWith({ x: 1 }, ctx);
  });

  it('works without context (backward compat)', async () => {
    const handler = vi.fn().mockResolvedValue('ok');
    dispatcher.register(
      { name: 'no-ctx', description: 'No ctx', parameters: { type: 'object', properties: {} } },
      handler,
    );

    await dispatcher.dispatch({ id: '1', name: 'no-ctx', input: {} });
    expect(handler).toHaveBeenCalledWith({}, undefined);
  });

  it('string handler works with context', async () => {
    dispatcher.register(
      { name: 'str', description: 'Str', parameters: { type: 'object', properties: {} } },
      async () => 'plain',
    );

    const ctx: ToolExecutionContext = { conversationId: 'c' };
    const result = await dispatcher.dispatch({ id: '1', name: 'str', input: {} }, undefined, ctx);
    expect(result.content).toBe('plain');
  });

  it('object handler works with context', async () => {
    dispatcher.register(
      { name: 'obj', description: 'Obj', parameters: { type: 'object', properties: {} } },
      async () => ({ content: 'structured' }),
    );

    const ctx: ToolExecutionContext = { conversationId: 'c' };
    const result = await dispatcher.dispatch({ id: '1', name: 'obj', input: {} }, undefined, ctx);
    expect(result.content).toBe('structured');
  });
});

describe('ToolDispatcher.invoke()', () => {
  let dispatcher: ToolDispatcher;
  const grantedPermissions = new Map<string, Set<Permission>>();

  const checker: PermissionChecker = {
    check(ns: string, perm: Permission) {
      return grantedPermissions.get(ns)?.has(perm) ?? false;
    },
  };

  beforeEach(() => {
    dispatcher = new ToolDispatcher();
    dispatcher.setPermissionChecker(checker);
    grantedPermissions.clear();
  });

  it('invokes a tool programmatically and returns string result', async () => {
    grantedPermissions.set('caller', new Set(['tool:invoke']));
    dispatcher.register(
      { name: 'greet', description: 'Greet', parameters: { type: 'object', properties: {} } },
      async (input) => `Hello ${input.name}`,
      { namespace: 'target' },
    );

    const result = await dispatcher.invoke('greet', { name: 'World' }, 'caller');
    expect(result).toBe('Hello World');
  });

  it('invokes a tool and returns structured response', async () => {
    grantedPermissions.set('caller', new Set(['tool:invoke']));
    dispatcher.register(
      { name: 'data', description: 'Data', parameters: { type: 'object', properties: {} } },
      async () => ({ content: 'ok', blocks: [{ type: 'text' as const, content: 'hi' }] }),
      { namespace: 'target' },
    );

    const result = await dispatcher.invoke('data', {}, 'caller');
    expect(typeof result).toBe('object');
    expect((result as { content: string }).content).toBe('ok');
    expect((result as { blocks: unknown[] }).blocks).toHaveLength(1);
  });

  it('throws when caller lacks tool:invoke permission', async () => {
    // No permissions granted for 'caller'
    dispatcher.register(
      { name: 'tool', description: 'T', parameters: { type: 'object', properties: {} } },
      async () => 'ok',
      { namespace: 'target' },
    );

    await expect(dispatcher.invoke('tool', {}, 'caller')).rejects.toThrow('tool:invoke');
  });

  it('throws when tool not found', async () => {
    grantedPermissions.set('caller', new Set(['tool:invoke']));
    await expect(dispatcher.invoke('nonexistent', {}, 'caller')).rejects.toThrow('not found');
  });

  it('throws on handler errors (not caught like dispatch)', async () => {
    grantedPermissions.set('caller', new Set(['tool:invoke']));
    dispatcher.register(
      { name: 'fail', description: 'Fails', parameters: { type: 'object', properties: {} } },
      async () => { throw new Error('boom'); },
      { namespace: 'target' },
    );

    await expect(dispatcher.invoke('fail', {}, 'caller')).rejects.toThrow('boom');
  });

  it('enforces max invoke depth to prevent cycles', async () => {
    grantedPermissions.set('a', new Set(['tool:invoke']));

    // Register a tool that recursively invokes itself
    dispatcher.register(
      { name: 'recursive', description: 'Recursive', parameters: { type: 'object', properties: {} } },
      async () => dispatcher.invoke('recursive', {}, 'a'),
      { namespace: 'a' },
    );

    await expect(dispatcher.invoke('recursive', {}, 'a')).rejects.toThrow('depth limit');
  });

  it('resets depth after successful invocation', async () => {
    grantedPermissions.set('caller', new Set(['tool:invoke']));
    dispatcher.register(
      { name: 'simple', description: 'Simple', parameters: { type: 'object', properties: {} } },
      async () => 'ok',
      { namespace: 'target' },
    );

    // Multiple sequential invocations should all succeed
    const r1 = await dispatcher.invoke('simple', {}, 'caller');
    const r2 = await dispatcher.invoke('simple', {}, 'caller');
    const r3 = await dispatcher.invoke('simple', {}, 'caller');
    expect(r1).toBe('ok');
    expect(r2).toBe('ok');
    expect(r3).toBe('ok');
  });

  it('allows invoke without permission checker (no checker set)', async () => {
    const noCheckerDispatcher = new ToolDispatcher();
    noCheckerDispatcher.register(
      { name: 'tool', description: 'T', parameters: { type: 'object', properties: {} } },
      async () => 'result',
      { namespace: 'ns' },
    );

    const result = await noCheckerDispatcher.invoke('tool', {}, 'caller');
    expect(result).toBe('result');
  });

  it('existing dispatch() is unaffected by invoke changes', async () => {
    dispatcher.register(
      { name: 'tool', description: 'T', parameters: { type: 'object', properties: {} } },
      async () => 'dispatched',
    );

    const result = await dispatcher.dispatch({ id: '1', name: 'tool', input: {} });
    expect(result.content).toBe('dispatched');
    expect(result.isError).toBeUndefined();
  });
});
