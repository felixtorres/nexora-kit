/**
 * Structured logger interface for NexoraKit.
 * Outputs JSON-formatted log lines to stdout/stderr.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  msg: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export class JsonLogger implements Logger {
  private readonly context: Record<string, unknown>;
  private readonly minLevel: LogLevel;

  constructor(options: { level?: LogLevel; context?: Record<string, unknown> } = {}) {
    this.minLevel = options.level ?? 'info';
    this.context = options.context ?? {};
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.log('debug', msg, data);
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this.log('info', msg, data);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this.log('warn', msg, data);
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.log('error', msg, data);
  }

  child(context: Record<string, unknown>): Logger {
    return new JsonLogger({
      level: this.minLevel,
      context: { ...this.context, ...context },
    });
  }

  private log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const entry: LogEntry = {
      level,
      msg,
      timestamp: new Date().toISOString(),
      ...this.context,
      ...data,
    };

    const output = JSON.stringify(entry);
    if (level === 'error' || level === 'warn') {
      process.stderr.write(output + '\n');
    } else {
      process.stdout.write(output + '\n');
    }
  }
}

export class NoopLogger implements Logger {
  debug(_msg: string, _data?: Record<string, unknown>): void {}
  info(_msg: string, _data?: Record<string, unknown>): void {}
  warn(_msg: string, _data?: Record<string, unknown>): void {}
  error(_msg: string, _data?: Record<string, unknown>): void {}
  child(_context: Record<string, unknown>): Logger {
    return this;
  }
}
