import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { ConfigResolver, ConfigLayer } from './resolver.js';

describe('ConfigResolver', () => {
  let resolver: ConfigResolver;

  beforeEach(() => {
    resolver = new ConfigResolver();
  });

  describe('set and get', () => {
    it('stores and retrieves an instance default', () => {
      resolver.set('greeting', 'Hello!', ConfigLayer.InstanceDefaults);
      expect(resolver.get('greeting', {})).toBe('Hello!');
    });

    it('returns undefined for missing keys', () => {
      expect(resolver.get('missing', {})).toBeUndefined();
    });

    it('getRequired throws for missing keys', () => {
      expect(() => resolver.getRequired('missing', {})).toThrow('Required config key');
    });
  });

  describe('3-layer resolution', () => {
    it('higher layer overrides lower layer', () => {
      resolver.set('greeting', 'instance default', ConfigLayer.InstanceDefaults);
      resolver.set('greeting', 'plugin default', ConfigLayer.PluginDefaults, {
        pluginNamespace: 'support',
      });

      expect(resolver.get('greeting', { pluginNamespace: 'support' })).toBe('plugin default');
    });

    it('plugin defaults resolve for matching plugin only', () => {
      resolver.set('maxRetries', 3, ConfigLayer.PluginDefaults, { pluginNamespace: 'support' });

      expect(resolver.get('maxRetries', { pluginNamespace: 'support' })).toBe(3);
      expect(resolver.get('maxRetries', { pluginNamespace: 'other' })).toBeUndefined();
    });

    it('user preferences are highest priority', () => {
      resolver.set('theme', 'light', ConfigLayer.InstanceDefaults);
      resolver.set('theme', 'dark', ConfigLayer.UserPreferences, { userId: 'alice' });

      expect(resolver.get('theme', { userId: 'alice' })).toBe('dark');
      expect(resolver.get('theme', { userId: 'bob' })).toBe('light');
    });

    it('full 3-layer cascade resolves correctly', () => {
      resolver.set('timeout', 30, ConfigLayer.InstanceDefaults);
      resolver.set('timeout', 15, ConfigLayer.PluginDefaults, { pluginNamespace: 'support' });
      resolver.set('timeout', 5, ConfigLayer.UserPreferences, { userId: 'alice' });

      expect(resolver.get('timeout', { pluginNamespace: 'support', userId: 'alice' })).toBe(5);
    });

    it('instance defaults apply when no plugin or user match', () => {
      resolver.set('timeout', 30, ConfigLayer.InstanceDefaults);
      resolver.set('timeout', 15, ConfigLayer.PluginDefaults, { pluginNamespace: 'support' });

      expect(resolver.get('timeout', { pluginNamespace: 'other' })).toBe(30);
    });

    it('plugin defaults fall through to instance defaults', () => {
      resolver.set('greeting', 'hi', ConfigLayer.InstanceDefaults);

      expect(resolver.get('greeting', { pluginNamespace: 'support' })).toBe('hi');
    });
  });

  describe('schema validation', () => {
    it('validates against registered schema', () => {
      resolver.registerSchema('port', z.number().int().min(1).max(65535));

      resolver.set('port', 8080, ConfigLayer.InstanceDefaults);
      expect(resolver.get('port', {})).toBe(8080);
    });

    it('rejects invalid values', () => {
      resolver.registerSchema('port', z.number().int().min(1).max(65535));

      expect(() => resolver.set('port', 'not-a-number', ConfigLayer.InstanceDefaults)).toThrow(
        'Config validation failed',
      );
    });

    it('rejects out-of-range values', () => {
      resolver.registerSchema('port', z.number().int().min(1).max(65535));

      expect(() => resolver.set('port', 99999, ConfigLayer.InstanceDefaults)).toThrow(
        'Config validation failed',
      );
    });
  });

  describe('getAll', () => {
    it('returns all resolved config for a context', () => {
      resolver.set('greeting', 'Hello', ConfigLayer.InstanceDefaults);
      resolver.set('maxTurns', 10, ConfigLayer.InstanceDefaults);
      resolver.set('greeting', 'Hi plugin!', ConfigLayer.PluginDefaults, {
        pluginNamespace: 'support',
      });

      const all = resolver.getAll({ pluginNamespace: 'support' });
      expect(all).toEqual({ greeting: 'Hi plugin!', maxTurns: 10 });
    });
  });
});
