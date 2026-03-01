import { describe, it, expect } from 'vitest';
import { renderTemplate } from './template.js';

describe('renderTemplate', () => {
  it('replaces simple variables', () => {
    const result = renderTemplate('Hello {{name}}!', { name: 'Felix' });
    expect(result).toBe('Hello Felix!');
  });

  it('replaces multiple variables', () => {
    const result = renderTemplate('{{greeting}}, {{name}}!', {
      greeting: 'Hi',
      name: 'World',
    });
    expect(result).toBe('Hi, World!');
  });

  it('resolves dot-notation paths', () => {
    const result = renderTemplate('Setting: {{config.greeting}}', {
      config: { greeting: 'Hello!' },
    });
    expect(result).toBe('Setting: Hello!');
  });

  it('resolves deeply nested paths', () => {
    const result = renderTemplate('{{a.b.c}}', {
      a: { b: { c: 'deep' } },
    });
    expect(result).toBe('deep');
  });

  it('leaves unresolved variables as-is', () => {
    const result = renderTemplate('Hello {{missing}}!', {});
    expect(result).toBe('Hello {{missing}}!');
  });

  it('converts numbers to strings', () => {
    const result = renderTemplate('Count: {{count}}', { count: 42 });
    expect(result).toBe('Count: 42');
  });

  it('handles booleans', () => {
    const result = renderTemplate('Flag: {{enabled}}', { enabled: true });
    expect(result).toBe('Flag: true');
  });

  it('handles null values in path', () => {
    const result = renderTemplate('{{a.b}}', { a: null });
    expect(result).toBe('{{a.b}}');
  });

  it('handles empty template', () => {
    const result = renderTemplate('', { name: 'test' });
    expect(result).toBe('');
  });

  it('handles template without variables', () => {
    const result = renderTemplate('No variables here', { name: 'test' });
    expect(result).toBe('No variables here');
  });
});
