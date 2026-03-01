import { describe, it, expect } from 'vitest';
import type { PluginInstance } from '@nexora-kit/core';
import { resolveDependencies } from './dependency.js';

function makePlugin(ns: string, version: string, deps: Array<{ namespace: string; version: string }> = []): PluginInstance {
  return {
    manifest: {
      name: ns,
      version,
      namespace: ns,
      permissions: [],
      dependencies: deps,
      sandbox: { tier: 'basic' },
    },
    state: 'installed',
    tools: [],
  };
}

describe('resolveDependencies', () => {
  it('resolves empty map', () => {
    const result = resolveDependencies(new Map());
    expect(result.order).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.cycles).toEqual([]);
  });

  it('resolves independent plugins', () => {
    const plugins = new Map([
      ['a', makePlugin('a', '1.0.0')],
      ['b', makePlugin('b', '1.0.0')],
    ]);
    const result = resolveDependencies(plugins);
    expect(result.order).toHaveLength(2);
    expect(result.order).toContain('a');
    expect(result.order).toContain('b');
  });

  it('resolves linear dependency chain', () => {
    const plugins = new Map([
      ['a', makePlugin('a', '1.0.0')],
      ['b', makePlugin('b', '1.0.0', [{ namespace: 'a', version: '>=1.0.0' }])],
      ['c', makePlugin('c', '1.0.0', [{ namespace: 'b', version: '>=1.0.0' }])],
    ]);
    const result = resolveDependencies(plugins);
    expect(result.order.indexOf('a')).toBeLessThan(result.order.indexOf('b'));
    expect(result.order.indexOf('b')).toBeLessThan(result.order.indexOf('c'));
  });

  it('detects missing dependencies', () => {
    const plugins = new Map([
      ['a', makePlugin('a', '1.0.0', [{ namespace: 'missing', version: '>=1.0.0' }])],
    ]);
    const result = resolveDependencies(plugins);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toEqual({ from: 'a', requires: 'missing', version: '>=1.0.0' });
  });

  it('detects version mismatch as missing', () => {
    const plugins = new Map([
      ['a', makePlugin('a', '1.0.0')],
      ['b', makePlugin('b', '1.0.0', [{ namespace: 'a', version: '>=2.0.0' }])],
    ]);
    const result = resolveDependencies(plugins);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].from).toBe('b');
  });

  it('detects circular dependencies', () => {
    const plugins = new Map([
      ['a', makePlugin('a', '1.0.0', [{ namespace: 'b', version: '>=1.0.0' }])],
      ['b', makePlugin('b', '1.0.0', [{ namespace: 'a', version: '>=1.0.0' }])],
    ]);
    const result = resolveDependencies(plugins);
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]).toContain('a');
    expect(result.cycles[0]).toContain('b');
  });

  it('resolves diamond dependencies', () => {
    const plugins = new Map([
      ['base', makePlugin('base', '1.0.0')],
      ['left', makePlugin('left', '1.0.0', [{ namespace: 'base', version: '>=1.0.0' }])],
      ['right', makePlugin('right', '1.0.0', [{ namespace: 'base', version: '>=1.0.0' }])],
      ['top', makePlugin('top', '1.0.0', [{ namespace: 'left', version: '>=1.0.0' }, { namespace: 'right', version: '>=1.0.0' }])],
    ]);
    const result = resolveDependencies(plugins);
    expect(result.order.indexOf('base')).toBeLessThan(result.order.indexOf('left'));
    expect(result.order.indexOf('base')).toBeLessThan(result.order.indexOf('right'));
    expect(result.order.indexOf('left')).toBeLessThan(result.order.indexOf('top'));
    expect(result.order.indexOf('right')).toBeLessThan(result.order.indexOf('top'));
  });

  it('handles semver ranges correctly', () => {
    const plugins = new Map([
      ['a', makePlugin('a', '1.5.3')],
      ['b', makePlugin('b', '1.0.0', [{ namespace: 'a', version: '^1.0.0' }])],
    ]);
    const result = resolveDependencies(plugins);
    expect(result.missing).toHaveLength(0);
    expect(result.order).toEqual(['a', 'b']);
  });
});
