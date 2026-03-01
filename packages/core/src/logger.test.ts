import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JsonLogger, NoopLogger, type LogEntry } from './logger.js';

describe('JsonLogger', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  });

  it('writes info logs to stdout as JSON', () => {
    const logger = new JsonLogger({ level: 'info' });
    logger.info('server started', { port: 3000 });

    expect(stdoutWrite).toHaveBeenCalledTimes(1);
    const output = (stdoutWrite.mock.calls[0][0] as string).trim();
    const entry: LogEntry = JSON.parse(output);
    expect(entry.level).toBe('info');
    expect(entry.msg).toBe('server started');
    expect(entry.port).toBe(3000);
    expect(entry.timestamp).toBeDefined();
  });

  it('writes error logs to stderr', () => {
    const logger = new JsonLogger({ level: 'info' });
    logger.error('connection failed', { code: 'ECONNREFUSED' });

    expect(stderrWrite).toHaveBeenCalledTimes(1);
    const output = (stderrWrite.mock.calls[0][0] as string).trim();
    const entry: LogEntry = JSON.parse(output);
    expect(entry.level).toBe('error');
    expect(entry.code).toBe('ECONNREFUSED');
  });

  it('writes warn logs to stderr', () => {
    const logger = new JsonLogger({ level: 'info' });
    logger.warn('slow query');

    expect(stderrWrite).toHaveBeenCalledTimes(1);
  });

  it('respects minimum log level', () => {
    const logger = new JsonLogger({ level: 'warn' });
    logger.debug('too verbose');
    logger.info('not important');
    logger.warn('pay attention');

    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(stderrWrite).toHaveBeenCalledTimes(1);
  });

  it('creates child loggers with inherited context', () => {
    const parent = new JsonLogger({ level: 'info', context: { service: 'api' } });
    const child = parent.child({ requestId: 'abc-123' });

    child.info('handling request');

    const output = (stdoutWrite.mock.calls[0][0] as string).trim();
    const entry: LogEntry = JSON.parse(output);
    expect(entry.service).toBe('api');
    expect(entry.requestId).toBe('abc-123');
  });

  it('merges additional data into log entries', () => {
    const logger = new JsonLogger({ level: 'debug' });
    logger.debug('trace', { traceId: 'xyz', durationMs: 42 });

    const output = (stdoutWrite.mock.calls[0][0] as string).trim();
    const entry: LogEntry = JSON.parse(output);
    expect(entry.traceId).toBe('xyz');
    expect(entry.durationMs).toBe(42);
  });
});

describe('NoopLogger', () => {
  it('does not write anything', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const logger = new NoopLogger();
    logger.debug('noop');
    logger.info('noop');
    logger.warn('noop');
    logger.error('noop');
    logger.child({}).info('noop');

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
