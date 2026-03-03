import { describe, it, expect, beforeEach } from 'vitest';
import { ToolDispatcher, type PermissionChecker } from './dispatcher.js';
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
