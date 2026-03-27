import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeAttr, escapeJsonForScript } from './escaper.js';

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than', () => {
    expect(escapeHtml('a < b')).toBe('a &lt; b');
  });

  it('escapes greater-than', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('escapes all 5 characters together', () => {
    expect(escapeHtml('<script>alert("x&y\'z")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&amp;y&#39;z&quot;)&lt;/script&gt;',
    );
  });

  it('passes through safe strings unchanged', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('escapeAttr', () => {
  it('escapes quotes and ampersands for attributes', () => {
    expect(escapeAttr('value="a&b"')).toBe('value=&quot;a&amp;b&quot;');
  });
});

describe('escapeJsonForScript', () => {
  it('serializes simple objects', () => {
    const result = escapeJsonForScript({ name: 'test', value: 42 });
    expect(result).toBe('{"name":"test","value":42}');
  });

  it('escapes closing script tags in string values', () => {
    const result = escapeJsonForScript({ html: '</script><script>alert(1)</script>' });
    expect(result).toContain('<\\/script>');
    expect(result).not.toContain('</script>');
  });

  it('escapes HTML comment injection', () => {
    const result = escapeJsonForScript({ comment: '<!-- injected -->' });
    expect(result).toContain('<\\!--');
    expect(result).not.toContain('<!--');
  });

  it('handles nested objects with dangerous strings', () => {
    const result = escapeJsonForScript({
      outer: { inner: '</script>' },
    });
    expect(result).not.toContain('</script>');
  });

  it('handles arrays', () => {
    const result = escapeJsonForScript([1, 'two', { three: 3 }]);
    expect(result).toBe('[1,"two",{"three":3}]');
  });

  it('handles null', () => {
    expect(escapeJsonForScript(null)).toBe('null');
  });

  it('handles numbers', () => {
    expect(escapeJsonForScript(42)).toBe('42');
  });

  it('handles boolean values', () => {
    expect(escapeJsonForScript(true)).toBe('true');
  });

  it('escapes forward slashes in all positions', () => {
    const result = escapeJsonForScript({ path: '</div></span>' });
    expect(result).not.toMatch(/<\//);
  });
});
