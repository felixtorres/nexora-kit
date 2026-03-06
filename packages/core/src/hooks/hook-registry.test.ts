import { describe, it, expect } from 'vitest';
import { HookRegistry } from './hook-registry.js';

describe('HookRegistry', () => {
  it('registers and retrieves hooks for an event', () => {
    const registry = new HookRegistry();
    registry.register('my-plugin', 'PreToolUse', { command: '/usr/bin/validate' });
    registry.enableHooksForNamespace('my-plugin');

    const hooks = registry.getHooksForEvent('PreToolUse');
    expect(hooks).toHaveLength(1);
    expect(hooks[0].config.command).toBe('/usr/bin/validate');
  });

  it('does not return hooks from disabled namespaces', () => {
    const registry = new HookRegistry();
    registry.register('disabled-plugin', 'PreToolUse', { command: '/bin/check' });

    const hooks = registry.getHooksForEvent('PreToolUse');
    expect(hooks).toHaveLength(0);
  });

  it('enables and disables namespaces', () => {
    const registry = new HookRegistry();
    registry.register('my-plugin', 'PreToolUse', { command: '/bin/check' });

    registry.enableHooksForNamespace('my-plugin');
    expect(registry.getHooksForEvent('PreToolUse')).toHaveLength(1);

    registry.disableHooksForNamespace('my-plugin');
    expect(registry.getHooksForEvent('PreToolUse')).toHaveLength(0);
  });

  it('filters by event name', () => {
    const registry = new HookRegistry();
    registry.register('my-plugin', 'PreToolUse', { command: '/bin/pre' });
    registry.register('my-plugin', 'PostToolUse', { command: '/bin/post' });
    registry.enableHooksForNamespace('my-plugin');

    expect(registry.getHooksForEvent('PreToolUse')).toHaveLength(1);
    expect(registry.getHooksForEvent('PostToolUse')).toHaveLength(1);
    expect(registry.getHooksForEvent('SessionStart')).toHaveLength(0);
  });

  it('handles skill-scoped hooks', () => {
    const registry = new HookRegistry();
    registry.register('my-plugin', 'PreToolUse', { command: '/bin/skill-hook' }, 'my-skill');
    registry.enableHooksForNamespace('my-plugin');

    // Without active skills — hook should not fire
    expect(registry.getHooksForEvent('PreToolUse')).toHaveLength(0);
    expect(registry.getHooksForEvent('PreToolUse', [])).toHaveLength(0);

    // With the skill active — hook should fire
    expect(registry.getHooksForEvent('PreToolUse', ['my-skill'])).toHaveLength(1);
    expect(registry.getHooksForEvent('PreToolUse', ['other-skill'])).toHaveLength(0);
  });

  it('unregisters all hooks for a namespace', () => {
    const registry = new HookRegistry();
    registry.register('plugin-a', 'PreToolUse', { command: '/bin/a' });
    registry.register('plugin-b', 'PreToolUse', { command: '/bin/b' });
    registry.enableHooksForNamespace('plugin-a');
    registry.enableHooksForNamespace('plugin-b');

    registry.unregisterNamespace('plugin-a');

    expect(registry.getHooksForEvent('PreToolUse')).toHaveLength(1);
    expect(registry.getHooksForEvent('PreToolUse')[0].namespace).toBe('plugin-b');
  });

  it('unregisters skill-scoped hooks', () => {
    const registry = new HookRegistry();
    registry.register('my-plugin', 'PreToolUse', { command: '/bin/global' });
    registry.register('my-plugin', 'PreToolUse', { command: '/bin/skill' }, 'research');
    registry.enableHooksForNamespace('my-plugin');

    registry.unregisterSkillHooks('my-plugin', 'research');

    const hooks = registry.getHooksForEvent('PreToolUse', ['research']);
    expect(hooks).toHaveLength(1);
    expect(hooks[0].config.command).toBe('/bin/global');
  });

  it('listAll returns all hooks regardless of enabled state', () => {
    const registry = new HookRegistry();
    registry.register('enabled', 'PreToolUse', { command: '/bin/e' });
    registry.register('disabled', 'PreToolUse', { command: '/bin/d' });
    registry.enableHooksForNamespace('enabled');

    expect(registry.listAll()).toHaveLength(2);
  });

  it('isEnabled returns correct state', () => {
    const registry = new HookRegistry();

    expect(registry.isEnabled('my-plugin')).toBe(false);
    registry.enableHooksForNamespace('my-plugin');
    expect(registry.isEnabled('my-plugin')).toBe(true);
  });
});
