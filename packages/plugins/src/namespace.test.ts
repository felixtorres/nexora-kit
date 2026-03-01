import { describe, it, expect } from 'vitest';
import { qualifyName, parseQualifiedName, isQualified, validateNamespace } from './namespace.js';

describe('qualifyName', () => {
  it('joins namespace and tool name', () => {
    expect(qualifyName('my-plugin', 'search')).toBe('my-plugin:search');
  });

  it('handles nested namespaces', () => {
    expect(qualifyName('org-tools', 'deep-search')).toBe('org-tools:deep-search');
  });
});

describe('parseQualifiedName', () => {
  it('splits qualified name into namespace and tool', () => {
    const result = parseQualifiedName('my-plugin:search');
    expect(result).toEqual({ namespace: 'my-plugin', toolName: 'search' });
  });

  it('throws on missing separator', () => {
    expect(() => parseQualifiedName('noseparator')).toThrow('missing namespace separator');
  });

  it('throws on empty namespace', () => {
    expect(() => parseQualifiedName(':toolname')).toThrow('empty namespace or tool name');
  });

  it('throws on empty tool name', () => {
    expect(() => parseQualifiedName('namespace:')).toThrow('empty namespace or tool name');
  });
});

describe('isQualified', () => {
  it('returns true for qualified names', () => {
    expect(isQualified('ns:tool')).toBe(true);
  });

  it('returns false for unqualified names', () => {
    expect(isQualified('tool')).toBe(false);
  });
});

describe('validateNamespace', () => {
  it('accepts valid namespaces', () => {
    expect(() => validateNamespace('my-plugin')).not.toThrow();
    expect(() => validateNamespace('a')).not.toThrow();
    expect(() => validateNamespace('plugin123')).not.toThrow();
  });

  it('rejects namespaces starting with digit', () => {
    expect(() => validateNamespace('1plugin')).toThrow();
  });

  it('rejects uppercase', () => {
    expect(() => validateNamespace('MyPlugin')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => validateNamespace('')).toThrow();
  });
});
