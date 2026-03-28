import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolDispatcher } from '@nexora-kit/core';
import { PermissionGate } from '@nexora-kit/sandbox';
import { ConfigResolver } from '@nexora-kit/config';
import type { PluginInstance, ToolDefinition } from '@nexora-kit/core';
import { SkillRegistry, SkillHandlerFactory } from '@nexora-kit/skills';
import type { SkillDefinition } from '@nexora-kit/skills';
import { CommandRegistry } from '@nexora-kit/commands';
import type { CommandDefinition } from '@nexora-kit/commands';
import type { LlmProvider } from '@nexora-kit/llm';
import { PluginLifecycleManager } from './lifecycle.js';

function makePlugin(
  ns: string,
  opts: {
    version?: string;
    permissions?: string[];
    deps?: Array<{ namespace: string; version: string }>;
    tools?: ToolDefinition[];
    config?: Record<string, { type: 'string' | 'number' | 'boolean'; description: string; default?: unknown }>;
  } = {},
): PluginInstance {
  return {
    manifest: {
      name: ns,
      version: opts.version ?? '1.0.0',
      namespace: ns,
      permissions: (opts.permissions ?? []) as PluginInstance['manifest']['permissions'],
      dependencies: opts.deps ?? [],
      sandbox: { tier: 'basic' },
      config: opts.config ? { schema: opts.config } : undefined,
    },
    state: 'installed',
    tools: opts.tools ?? [],
  };
}

function makeTool(name: string): ToolDefinition {
  return { name, description: `Tool ${name}`, parameters: { type: 'object', properties: {} } };
}

describe('PluginLifecycleManager', () => {
  let manager: PluginLifecycleManager;
  let gate: PermissionGate;
  let config: ConfigResolver;
  let dispatcher: ToolDispatcher;

  beforeEach(() => {
    gate = new PermissionGate();
    config = new ConfigResolver();
    dispatcher = new ToolDispatcher();
    manager = new PluginLifecycleManager({
      permissionGate: gate,
      configResolver: config,
      toolDispatcher: dispatcher,
    });
  });

  describe('install', () => {
    it('installs a plugin', () => {
      const plugin = makePlugin('test');
      manager.install(plugin);
      expect(manager.getPlugin('test')?.state).toBe('installed');
    });

    it('throws on duplicate install', () => {
      manager.install(makePlugin('test'));
      expect(() => manager.install(makePlugin('test'))).toThrow('already installed');
    });

    it('lists installed plugins', () => {
      manager.install(makePlugin('a'));
      manager.install(makePlugin('b'));
      expect(manager.listPlugins()).toHaveLength(2);
    });
  });

  describe('enable', () => {
    it('enables an installed plugin', () => {
      manager.install(makePlugin('test'));
      manager.enable('test');
      expect(manager.getPlugin('test')?.state).toBe('enabled');
    });

    it('throws for unknown plugin', async () => {
      await expect(manager.enable('unknown')).rejects.toThrow('not installed');
    });

    it('is idempotent for already enabled', () => {
      manager.install(makePlugin('test'));
      manager.enable('test');
      manager.enable('test'); // should not throw
      expect(manager.getPlugin('test')?.state).toBe('enabled');
    });

    it('grants declared permissions', () => {
      const plugin = makePlugin('test', { permissions: ['llm:invoke', 'fs:read'] });
      manager.install(plugin);
      manager.enable('test');

      expect(gate.listPermissions('test')).toContain('llm:invoke');
      expect(gate.listPermissions('test')).toContain('fs:read');
    });

    it('sets config defaults', () => {
      const plugin = makePlugin('test', {
        config: {
          greeting: { type: 'string', description: 'Greeting', default: 'Hello' },
          maxRetries: { type: 'number', description: 'Max retries', default: 3 },
        },
      });
      manager.install(plugin);
      manager.enable('test');

      expect(config.get('test.greeting', { pluginNamespace: 'test' })).toBe('Hello');
      expect(config.get('test.maxRetries', { pluginNamespace: 'test' })).toBe(3);
    });

    it('registers tools on the dispatcher', () => {
      const tools = [makeTool('test:greet'), makeTool('test:farewell')];
      const plugin = makePlugin('test', { tools });
      manager.install(plugin);
      manager.enable('test');

      expect(dispatcher.listTools()).toHaveLength(2);
      expect(dispatcher.hasHandler('test:greet')).toBe(true);
    });

    it('wraps tool handlers with error boundary', async () => {
      const tools = [makeTool('test:tool')];
      const plugin = makePlugin('test', { tools });
      const handler = vi.fn().mockResolvedValue('ok');

      manager.registerToolHandler('test:tool', handler);
      manager.install(plugin);
      manager.enable('test');

      const result = await dispatcher.dispatch({ id: '1', name: 'test:tool', input: {} });
      expect(result.content).toBe('ok');
    });

    it('throws when dependencies are missing', async () => {
      const plugin = makePlugin('test', {
        deps: [{ namespace: 'missing', version: '>=1.0.0' }],
      });
      manager.install(plugin);
      await expect(manager.enable('test')).rejects.toThrow('missing dependencies');
    });

    it('enables with satisfied dependencies', () => {
      manager.install(makePlugin('base', { version: '2.0.0' }));
      manager.install(makePlugin('dependent', {
        deps: [{ namespace: 'base', version: '>=1.0.0' }],
      }));
      manager.enable('base');
      manager.enable('dependent');
      expect(manager.getPlugin('dependent')?.state).toBe('enabled');
    });
  });

  describe('disable', () => {
    it('disables an enabled plugin', () => {
      manager.install(makePlugin('test'));
      manager.enable('test');
      manager.disable('test');
      expect(manager.getPlugin('test')?.state).toBe('disabled');
    });

    it('unregisters tools', () => {
      const tools = [makeTool('test:greet')];
      manager.install(makePlugin('test', { tools }));
      manager.enable('test');
      expect(dispatcher.listTools()).toHaveLength(1);

      manager.disable('test');
      expect(dispatcher.listTools()).toHaveLength(0);
    });

    it('revokes permissions', () => {
      manager.install(makePlugin('test', { permissions: ['llm:invoke'] }));
      manager.enable('test');
      expect(gate.listPermissions('test')).toHaveLength(1);

      manager.disable('test');
      expect(gate.listPermissions('test')).toHaveLength(0);
    });

    it('is idempotent for already disabled', () => {
      manager.install(makePlugin('test'));
      manager.disable('test'); // installed → no-op
      expect(manager.getPlugin('test')?.state).toBe('installed');
    });

    it('throws for unknown plugin', () => {
      expect(() => manager.disable('unknown')).toThrow('not installed');
    });
  });

  describe('uninstall', () => {
    it('uninstalls a plugin', () => {
      manager.install(makePlugin('test'));
      manager.uninstall('test');
      expect(manager.getPlugin('test')).toBeUndefined();
    });

    it('disables before uninstalling if enabled', () => {
      const tools = [makeTool('test:greet')];
      manager.install(makePlugin('test', { tools, permissions: ['llm:invoke'] }));
      manager.enable('test');
      manager.uninstall('test');

      expect(manager.getPlugin('test')).toBeUndefined();
      expect(dispatcher.listTools()).toHaveLength(0);
      expect(gate.listPermissions('test')).toHaveLength(0);
    });

    it('throws for unknown plugin', () => {
      expect(() => manager.uninstall('unknown')).toThrow('not installed');
    });
  });

  describe('skill integration', () => {
    function createMockLlm(responseText: string): LlmProvider {
      return {
        name: 'mock',
        models: [{ id: 'mock-1', name: 'Mock', provider: 'mock', contextWindow: 4096, maxOutputTokens: 1024 }],
        async *chat() {
          yield { type: 'text' as const, content: responseText };
          yield { type: 'done' as const };
        },
        async countTokens() { return 10; },
      };
    }

    it('auto-generates handlers for YAML skills via factory', async () => {
      const llm = createMockLlm('Hello Felix!');
      const skillRegistry = new SkillRegistry();
      const factory = new SkillHandlerFactory({ llmProvider: llm, configResolver: config });

      const skillManager = new PluginLifecycleManager({
        permissionGate: gate,
        configResolver: config,
        toolDispatcher: dispatcher,
        skillHandlerFactory: factory,
        skillRegistry,
      });

      const tools = [makeTool('hello:greet')];
      const plugin = makePlugin('hello', { tools, permissions: ['llm:invoke'] });
      skillManager.install(plugin);

      const skillDef: SkillDefinition = {
        name: 'greet',
        description: 'Greet user',
        invocation: 'model',
        parameters: { userName: { type: 'string' } },
        prompt: 'Say hi to {{userName}}',
      };
      skillManager.setSkillDefinitions('hello', new Map([['hello:greet', skillDef]]));
      skillManager.enable('hello');

      // Handler was auto-generated and registered
      expect(dispatcher.hasHandler('hello:greet')).toBe(true);
      expect(skillRegistry.has('hello:greet')).toBe(true);

      // Execute the handler
      const result = await dispatcher.dispatch({ id: '1', name: 'hello:greet', input: { userName: 'Felix' } });
      expect(result.content).toBe('Hello Felix!');
    });

    it('registers get_skill_context tool when plugin has skills', () => {
      const llm = createMockLlm('response');
      const skillRegistry = new SkillRegistry();
      const factory = new SkillHandlerFactory({ llmProvider: llm, configResolver: config });

      const skillManager = new PluginLifecycleManager({
        permissionGate: gate,
        configResolver: config,
        toolDispatcher: dispatcher,
        skillHandlerFactory: factory,
        skillRegistry,
      });

      const tools = [makeTool('hello:greet')];
      const plugin = makePlugin('hello', { tools });
      skillManager.install(plugin);

      const skillDef: SkillDefinition = {
        name: 'greet',
        description: 'Greet user',
        invocation: 'model',
        parameters: {},
        prompt: 'Say hello to the user warmly.',
      };
      skillManager.setSkillDefinitions('hello', new Map([['hello:greet', skillDef]]));
      skillManager.enable('hello');

      expect(dispatcher.hasHandler('get_skill_context')).toBe(true);
    });

    it('get_skill_context returns skill prompt', async () => {
      const llm = createMockLlm('response');
      const skillRegistry = new SkillRegistry();
      const factory = new SkillHandlerFactory({ llmProvider: llm, configResolver: config });

      const skillManager = new PluginLifecycleManager({
        permissionGate: gate,
        configResolver: config,
        toolDispatcher: dispatcher,
        skillHandlerFactory: factory,
        skillRegistry,
      });

      const tools = [makeTool('hello:greet')];
      const plugin = makePlugin('hello', { tools });
      skillManager.install(plugin);

      const skillDef: SkillDefinition = {
        name: 'greet',
        description: 'Greet user',
        invocation: 'model',
        parameters: {},
        prompt: 'Say hello to the user warmly.',
      };
      skillManager.setSkillDefinitions('hello', new Map([['hello:greet', skillDef]]));
      skillManager.enable('hello');

      const result = await dispatcher.dispatch({ id: '1', name: 'get_skill_context', input: { namespace: 'hello', name: 'greet' } });
      expect(result.content).toBe('Say hello to the user warmly.');
    });

    it('get_skill_context returns description when no prompt', async () => {
      const llm = createMockLlm('response');
      const skillRegistry = new SkillRegistry();
      const factory = new SkillHandlerFactory({ llmProvider: llm, configResolver: config });

      const skillManager = new PluginLifecycleManager({
        permissionGate: gate,
        configResolver: config,
        toolDispatcher: dispatcher,
        skillHandlerFactory: factory,
        skillRegistry,
      });

      const tools = [makeTool('hello:greet')];
      const plugin = makePlugin('hello', { tools });
      skillManager.install(plugin);

      const skillDef: SkillDefinition = {
        name: 'greet',
        description: 'Greet user',
        invocation: 'model',
        parameters: {},
      };
      skillManager.setSkillDefinitions('hello', new Map([['hello:greet', skillDef]]));
      skillManager.enable('hello');

      const result = await dispatcher.dispatch({ id: '1', name: 'get_skill_context', input: { namespace: 'hello', name: 'greet' } });
      expect(result.content).toBe('Greet user');
    });

    it('get_skill_context returns error for unknown skill', async () => {
      const llm = createMockLlm('response');
      const skillRegistry = new SkillRegistry();
      const factory = new SkillHandlerFactory({ llmProvider: llm, configResolver: config });

      const skillManager = new PluginLifecycleManager({
        permissionGate: gate,
        configResolver: config,
        toolDispatcher: dispatcher,
        skillHandlerFactory: factory,
        skillRegistry,
      });

      const tools = [makeTool('hello:greet')];
      const plugin = makePlugin('hello', { tools });
      skillManager.install(plugin);

      const skillDef: SkillDefinition = {
        name: 'greet',
        description: 'Greet user',
        invocation: 'model',
        parameters: {},
        prompt: 'Say hello',
      };
      skillManager.setSkillDefinitions('hello', new Map([['hello:greet', skillDef]]));
      skillManager.enable('hello');

      const result = await dispatcher.dispatch({ id: '1', name: 'get_skill_context', input: { namespace: 'hello', name: 'unknown' } });
      expect(result.content).toContain("not found");
      expect(result.content).toContain('greet');
    });

    it('get_skill_context tool is cleaned up on disable', () => {
      const llm = createMockLlm('response');
      const skillRegistry = new SkillRegistry();
      const factory = new SkillHandlerFactory({ llmProvider: llm, configResolver: config });

      const skillManager = new PluginLifecycleManager({
        permissionGate: gate,
        configResolver: config,
        toolDispatcher: dispatcher,
        skillHandlerFactory: factory,
        skillRegistry,
      });

      const tools = [makeTool('hello:greet')];
      const plugin = makePlugin('hello', { tools });
      skillManager.install(plugin);

      const skillDef: SkillDefinition = {
        name: 'greet',
        description: 'Greet user',
        invocation: 'model',
        parameters: {},
        prompt: 'Say hello',
      };
      skillManager.setSkillDefinitions('hello', new Map([['hello:greet', skillDef]]));
      skillManager.enable('hello');
      expect(dispatcher.hasHandler('get_skill_context')).toBe(true);

      skillManager.disable('hello');
      expect(dispatcher.hasHandler('get_skill_context')).toBe(false);
    });

    it('unregisters skills from registry on disable', () => {
      const llm = createMockLlm('response');
      const skillRegistry = new SkillRegistry();
      const factory = new SkillHandlerFactory({ llmProvider: llm, configResolver: config });

      const skillManager = new PluginLifecycleManager({
        permissionGate: gate,
        configResolver: config,
        toolDispatcher: dispatcher,
        skillHandlerFactory: factory,
        skillRegistry,
      });

      const tools = [makeTool('hello:greet')];
      const plugin = makePlugin('hello', { tools });
      skillManager.install(plugin);

      const skillDef: SkillDefinition = {
        name: 'greet',
        description: 'Greet',
        invocation: 'model',
        parameters: {},
        prompt: 'Hello',
      };
      skillManager.setSkillDefinitions('hello', new Map([['hello:greet', skillDef]]));
      skillManager.enable('hello');
      expect(skillRegistry.has('hello:greet')).toBe(true);

      skillManager.disable('hello');
      expect(skillRegistry.has('hello:greet')).toBe(false);
    });
  });

  describe('command integration', () => {
    it('registers commands into registry during enable', () => {
      const commandRegistry = new CommandRegistry();
      const cmdManager = new PluginLifecycleManager({
        permissionGate: gate,
        configResolver: config,
        toolDispatcher: dispatcher,
        commandRegistry,
      });

      const plugin = makePlugin('hello');
      cmdManager.install(plugin);

      const cmdDef: CommandDefinition = {
        name: 'greet',
        description: 'Say hello',
        args: [{ name: 'name', type: 'string', required: false, default: 'World' }],
        handler: async (ctx) => ({ content: `Hi ${ctx.args['name']}` }),
      };
      cmdManager.setCommandDefinitions('hello', new Map([['greet', cmdDef]]));
      cmdManager.enable('hello');

      expect(commandRegistry.has('hello:greet')).toBe(true);
      expect(commandRegistry.get('hello:greet')?.handler).toBeDefined();
    });

    it('unregisters commands during disable', () => {
      const commandRegistry = new CommandRegistry();
      const cmdManager = new PluginLifecycleManager({
        permissionGate: gate,
        configResolver: config,
        toolDispatcher: dispatcher,
        commandRegistry,
      });

      const plugin = makePlugin('hello');
      cmdManager.install(plugin);

      const cmdDef: CommandDefinition = {
        name: 'greet',
        description: 'Say hello',
        args: [],
        handler: async () => ({ content: 'Hi' }),
      };
      cmdManager.setCommandDefinitions('hello', new Map([['greet', cmdDef]]));
      cmdManager.enable('hello');
      expect(commandRegistry.has('hello:greet')).toBe(true);

      cmdManager.disable('hello');
      expect(commandRegistry.has('hello:greet')).toBe(false);
    });

    it('generates handler from prompt template', async () => {
      const commandRegistry = new CommandRegistry();
      const cmdManager = new PluginLifecycleManager({
        permissionGate: gate,
        configResolver: config,
        toolDispatcher: dispatcher,
        commandRegistry,
      });

      const plugin = makePlugin('hello');
      cmdManager.install(plugin);

      const cmdDef: CommandDefinition = {
        name: 'greet',
        description: 'Say hello',
        args: [{ name: 'name', type: 'string', required: false, default: 'World' }],
        prompt: 'Hello, {{name}}! Welcome to NexoraKit.',
      };
      cmdManager.setCommandDefinitions('hello', new Map([['greet', cmdDef]]));
      cmdManager.enable('hello');

      const handler = commandRegistry.get('hello:greet')?.handler;
      expect(handler).toBeDefined();

      const result = await handler!({ args: { name: 'Felix' }, raw: '/hello:greet Felix' });
      expect(result.content).toBe('Hello, Felix! Welcome to NexoraKit.');
    });

    it('preserves unreferenced placeholders in prompt template', async () => {
      const commandRegistry = new CommandRegistry();
      const cmdManager = new PluginLifecycleManager({
        permissionGate: gate,
        configResolver: config,
        toolDispatcher: dispatcher,
        commandRegistry,
      });

      const plugin = makePlugin('hello');
      cmdManager.install(plugin);

      const cmdDef: CommandDefinition = {
        name: 'greet',
        description: 'Say hello',
        args: [],
        prompt: 'Hello, {{name}}!',
      };
      cmdManager.setCommandDefinitions('hello', new Map([['greet', cmdDef]]));
      cmdManager.enable('hello');

      const handler = commandRegistry.get('hello:greet')?.handler;
      const result = await handler!({ args: {}, raw: '/hello:greet' });
      expect(result.content).toBe('Hello, {{name}}!');
    });

    it('re-registers commands after reload', () => {
      const commandRegistry = new CommandRegistry();
      const cmdManager = new PluginLifecycleManager({
        permissionGate: gate,
        configResolver: config,
        toolDispatcher: dispatcher,
        commandRegistry,
      });

      const plugin = makePlugin('hello');
      cmdManager.install(plugin);

      const cmdDef: CommandDefinition = {
        name: 'greet',
        description: 'Say hello',
        args: [],
        prompt: 'Hello!',
      };
      cmdManager.setCommandDefinitions('hello', new Map([['greet', cmdDef]]));
      cmdManager.enable('hello');
      expect(commandRegistry.has('hello:greet')).toBe(true);

      // Simulate disable + uninstall (reload does this internally)
      cmdManager.disable('hello');
      expect(commandRegistry.has('hello:greet')).toBe(false);
    });
  });

  describe('behavioral skill → command registration', () => {
    it('registers user-invocable behavioral skills as commands', () => {
      const commandRegistry = new CommandRegistry();
      const skillRegistry = new SkillRegistry();
      const stubLlm: LlmProvider = {
        name: 'stub',
        models: [{ id: 'stub-model', name: 'Stub', provider: 'stub', contextWindow: 8000, maxOutputTokens: 2000 }],
        chat: vi.fn(),
        countTokens: vi.fn().mockResolvedValue(0),
      };
      const handlerFactory = new SkillHandlerFactory({
        llmProvider: stubLlm,
        configResolver: config,
      });

      const behavioralManager = new PluginLifecycleManager({
        permissionGate: gate,
        configResolver: config,
        toolDispatcher: dispatcher,
        commandRegistry,
        skillRegistry,
        skillHandlerFactory: handlerFactory,
      });

      const plugin = makePlugin('claude-plugin', {
        tools: [makeTool('claude-plugin:research')],
      });
      behavioralManager.install(plugin);

      const skillDef: SkillDefinition = {
        name: 'research',
        description: 'Research a topic thoroughly',
        invocation: 'both',
        parameters: {},
        executionMode: 'behavioral',
        body: 'Research $ARGUMENTS in depth.',
        userInvocable: true,
        argumentHint: '[topic]',
      };
      behavioralManager.setSkillDefinitions(
        'claude-plugin',
        new Map([['claude-plugin:research', skillDef]]),
      );
      behavioralManager.enable('claude-plugin');

      // Should be registered as a command
      expect(commandRegistry.has('claude-plugin:research')).toBe(true);
      const cmd = commandRegistry.get('claude-plugin:research')!;
      expect(cmd.definition.description).toContain('Research a topic');
      expect(cmd.definition.description).toContain('[topic]');
      expect(cmd.handler).toBeDefined();
    });

    it('does not register skills with userInvocable: false as commands', () => {
      const commandRegistry = new CommandRegistry();
      const behavioralManager = new PluginLifecycleManager({
        permissionGate: gate,
        configResolver: config,
        toolDispatcher: dispatcher,
        commandRegistry,
      });

      const plugin = makePlugin('bg-plugin', {
        tools: [makeTool('bg-plugin:background')],
      });
      behavioralManager.install(plugin);

      const skillDef: SkillDefinition = {
        name: 'background',
        description: 'Background knowledge',
        invocation: 'model',
        parameters: {},
        executionMode: 'behavioral',
        body: 'Internal instructions.',
        userInvocable: false,
      };
      behavioralManager.setSkillDefinitions(
        'bg-plugin',
        new Map([['bg-plugin:background', skillDef]]),
      );
      behavioralManager.enable('bg-plugin');

      expect(commandRegistry.has('bg-plugin:background')).toBe(false);
    });

    it('does not register prompt-mode skills as commands', () => {
      const commandRegistry = new CommandRegistry();
      const behavioralManager = new PluginLifecycleManager({
        permissionGate: gate,
        configResolver: config,
        toolDispatcher: dispatcher,
        commandRegistry,
      });

      const plugin = makePlugin('yaml-plugin', {
        tools: [makeTool('yaml-plugin:greet')],
      });
      behavioralManager.install(plugin);

      const skillDef: SkillDefinition = {
        name: 'greet',
        description: 'Greet user',
        invocation: 'model',
        parameters: {},
        executionMode: 'prompt',
        prompt: 'Hello {{name}}',
      };
      behavioralManager.setSkillDefinitions(
        'yaml-plugin',
        new Map([['yaml-plugin:greet', skillDef]]),
      );
      behavioralManager.enable('yaml-plugin');

      expect(commandRegistry.has('yaml-plugin:greet')).toBe(false);
    });

    it('does not override existing commands with same name', () => {
      const commandRegistry = new CommandRegistry();
      const behavioralManager = new PluginLifecycleManager({
        permissionGate: gate,
        configResolver: config,
        toolDispatcher: dispatcher,
        commandRegistry,
      });

      const plugin = makePlugin('dual-plugin', {
        tools: [makeTool('dual-plugin:search')],
      });
      behavioralManager.install(plugin);

      // Register a command with the same name
      const cmdDef: CommandDefinition = {
        name: 'search',
        description: 'Custom search command',
        args: [],
        prompt: 'Search for {{query}}',
      };
      behavioralManager.setCommandDefinitions(
        'dual-plugin',
        new Map([['dual-plugin:search', cmdDef]]),
      );

      const skillDef: SkillDefinition = {
        name: 'search',
        description: 'Search skill',
        invocation: 'both',
        parameters: {},
        executionMode: 'behavioral',
        body: 'Search instructions.',
      };
      behavioralManager.setSkillDefinitions(
        'dual-plugin',
        new Map([['dual-plugin:search', skillDef]]),
      );
      behavioralManager.enable('dual-plugin');

      // Command should be the explicitly defined one, not the skill
      const cmd = commandRegistry.get('dual-plugin:search')!;
      expect(cmd.definition.description).toBe('Custom search command');
    });

    it('cleans up behavioral skill commands on disable', () => {
      const commandRegistry = new CommandRegistry();
      const behavioralManager = new PluginLifecycleManager({
        permissionGate: gate,
        configResolver: config,
        toolDispatcher: dispatcher,
        commandRegistry,
      });

      const plugin = makePlugin('cleanup-plugin', {
        tools: [makeTool('cleanup-plugin:analyze')],
      });
      behavioralManager.install(plugin);

      const skillDef: SkillDefinition = {
        name: 'analyze',
        description: 'Analyze data',
        invocation: 'both',
        parameters: {},
        executionMode: 'behavioral',
        body: 'Analyze instructions.',
      };
      behavioralManager.setSkillDefinitions(
        'cleanup-plugin',
        new Map([['cleanup-plugin:analyze', skillDef]]),
      );
      behavioralManager.enable('cleanup-plugin');
      expect(commandRegistry.has('cleanup-plugin:analyze')).toBe(true);

      behavioralManager.disable('cleanup-plugin');
      expect(commandRegistry.has('cleanup-plugin:analyze')).toBe(false);
    });
  });
});
