import { describe, it, expect } from 'vitest';
import { ToolDispatcher } from './dispatcher.js';

describe('ToolDispatcher.listToolsWithNamespace', () => {
  it('returns tools with their namespaces', () => {
    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'search', description: 'Search', parameters: { type: 'object', properties: {} } },
      async () => 'ok',
      { namespace: 'plugin-a' },
    );
    dispatcher.register(
      { name: 'create', description: 'Create', parameters: { type: 'object', properties: {} } },
      async () => 'ok',
      { namespace: 'plugin-b' },
    );

    const tools = dispatcher.listToolsWithNamespace();
    expect(tools).toHaveLength(2);

    const search = tools.find((t) => t.tool.name === 'search');
    expect(search?.namespace).toBe('plugin-a');

    const create = tools.find((t) => t.tool.name === 'create');
    expect(create?.namespace).toBe('plugin-b');
  });

  it('uses empty string for tools without namespace', () => {
    const dispatcher = new ToolDispatcher();
    dispatcher.register(
      { name: 'tool', description: 'Tool', parameters: { type: 'object', properties: {} } },
      async () => 'ok',
    );

    const tools = dispatcher.listToolsWithNamespace();
    expect(tools[0].namespace).toBe('');
  });
});
