import { describe, it, expect } from 'vitest';
import { parseManifest, validateManifest } from './manifest.js';

const validYaml = `
name: Hello World
version: "1.0.0"
namespace: hello-world
description: A test plugin
permissions:
  - llm:invoke
  - fs:read
dependencies: []
sandbox:
  tier: basic
  limits:
    memoryMb: 128
    timeoutMs: 5000
tools:
  pinned:
    - greet
config:
  schema:
    greeting:
      type: string
      description: Default greeting
      default: Hello
`;

describe('parseManifest', () => {
  it('parses valid YAML into PluginManifest', () => {
    const manifest = parseManifest(validYaml);
    expect(manifest.name).toBe('Hello World');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.namespace).toBe('hello-world');
    expect(manifest.permissions).toEqual(['llm:invoke', 'fs:read']);
    expect(manifest.sandbox.tier).toBe('basic');
    expect(manifest.sandbox.limits?.memoryMb).toBe(128);
    expect(manifest.tools?.pinned).toEqual(['greet']);
    expect(manifest.config?.schema.greeting.default).toBe('Hello');
  });

  it('applies defaults for optional fields', () => {
    const minimal = `
name: Minimal
version: "0.1.0"
namespace: minimal
`;
    const manifest = parseManifest(minimal);
    expect(manifest.permissions).toEqual([]);
    expect(manifest.dependencies).toEqual([]);
    expect(manifest.sandbox.tier).toBe('basic');
    expect(manifest.tools).toBeUndefined();
    expect(manifest.config).toBeUndefined();
  });

  it('throws on missing name', () => {
    expect(() => parseManifest('version: "1.0.0"\nnamespace: test')).toThrow();
  });

  it('throws on invalid version format', () => {
    expect(() => parseManifest('name: X\nversion: bad\nnamespace: test')).toThrow();
  });

  it('throws on invalid namespace', () => {
    expect(() => parseManifest('name: X\nversion: "1.0.0"\nnamespace: Bad-Name')).toThrow();
  });

  it('throws on invalid permission', () => {
    const yaml = `
name: X
version: "1.0.0"
namespace: test
permissions:
  - invalid:perm
`;
    expect(() => parseManifest(yaml)).toThrow();
  });

  it('parses dependencies', () => {
    const yaml = `
name: X
version: "1.0.0"
namespace: test
dependencies:
  - namespace: other-plugin
    version: "^1.0.0"
`;
    const manifest = parseManifest(yaml);
    expect(manifest.dependencies).toEqual([{ namespace: 'other-plugin', version: '^1.0.0' }]);
  });

  it('parses skillIndex: false flag', () => {
    const yaml = `
name: X
version: "1.0.0"
namespace: test
skillIndex: false
`;
    const manifest = parseManifest(yaml);
    expect(manifest.skillIndex).toBe(false);
  });

  it('defaults skillIndex to undefined when not set', () => {
    const yaml = `
name: X
version: "1.0.0"
namespace: test
`;
    const manifest = parseManifest(yaml);
    expect(manifest.skillIndex).toBeUndefined();
  });

  it('handles strict sandbox tier', () => {
    const yaml = `
name: X
version: "1.0.0"
namespace: test
sandbox:
  tier: strict
  allowedModules:
    - crypto
    - path
`;
    const manifest = parseManifest(yaml);
    expect(manifest.sandbox.tier).toBe('strict');
    expect(manifest.sandbox.allowedModules).toEqual(['crypto', 'path']);
  });
});

describe('validateManifest', () => {
  it('returns success for valid manifest', () => {
    const result = validateManifest({
      name: 'Test',
      version: '1.0.0',
      namespace: 'test',
      permissions: [],
      dependencies: [],
      sandbox: { tier: 'none' },
    });
    expect(result.success).toBe(true);
    expect(result.data?.name).toBe('Test');
  });

  it('returns errors for invalid manifest', () => {
    const result = validateManifest({ name: '' });
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('returns specific field errors', () => {
    const result = validateManifest({
      name: 'X',
      version: 'bad',
      namespace: 'UPPER',
    });
    expect(result.success).toBe(false);
    expect(result.errors!.some((e) => e.includes('version'))).toBe(true);
    expect(result.errors!.some((e) => e.includes('namespace'))).toBe(true);
  });

  it('validates config schema fields', () => {
    const result = validateManifest({
      name: 'X',
      version: '1.0.0',
      namespace: 'test',
      config: {
        schema: {
          key: { type: 'invalid', description: 'bad type' },
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it('validates sandbox limits are positive', () => {
    const result = validateManifest({
      name: 'X',
      version: '1.0.0',
      namespace: 'test',
      sandbox: { tier: 'basic', limits: { memoryMb: -1 } },
    });
    expect(result.success).toBe(false);
  });
});
