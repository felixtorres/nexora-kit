import { describe, it, expect, vi } from 'vitest';
import { fmt, success, warn, error, info, table } from './output.js';

describe('output helpers', () => {
  it('fmt.bold wraps text', () => {
    const result = fmt.bold('test');
    expect(result).toContain('test');
  });

  it('success logs to stdout', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    success('done');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('done'));
    spy.mockRestore();
  });

  it('error logs to stderr', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    error('fail');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('fail'));
    spy.mockRestore();
  });

  it('warn logs to stdout', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warn('caution');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('caution'));
    spy.mockRestore();
  });

  it('info logs to stdout', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    info('note');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('note'));
    spy.mockRestore();
  });

  it('table prints headers and rows', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    table(['Name', 'Value'], [['foo', 'bar'], ['baz', 'qux']]);
    expect(spy).toHaveBeenCalledTimes(4); // header + separator + 2 rows
    spy.mockRestore();
  });
});
