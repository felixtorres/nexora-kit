import * as fs from 'node:fs';
import type { PluginLifecycleManager } from './lifecycle.js';
import type { LoadResult } from './loader.js';

export interface DevWatcherOptions {
  debounceMs?: number;
  onReload?: (namespace: string, result: LoadResult) => void;
  signal?: AbortSignal;
}

export class PluginDevWatcher {
  private readonly lifecycle: PluginLifecycleManager;
  private readonly debounceMs: number;
  private readonly onReload?: (namespace: string, result: LoadResult) => void;
  private readonly signal?: AbortSignal;
  private watchers = new Map<string, fs.FSWatcher>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(lifecycle: PluginLifecycleManager, options: DevWatcherOptions = {}) {
    this.lifecycle = lifecycle;
    this.debounceMs = options.debounceMs ?? 300;
    this.onReload = options.onReload;
    this.signal = options.signal;

    if (this.signal) {
      this.signal.addEventListener('abort', () => this.stop(), { once: true });
    }
  }

  watch(namespace: string, dir: string): void {
    if (this.watchers.has(namespace)) {
      throw new Error(`Already watching '${namespace}'`);
    }

    this.lifecycle.registerPluginDir(namespace, dir);

    const watcher = fs.watch(dir, { recursive: true }, () => {
      this.scheduleReload(namespace);
    });

    this.watchers.set(namespace, watcher);
  }

  unwatch(namespace: string): void {
    const watcher = this.watchers.get(namespace);
    if (watcher) {
      watcher.close();
      this.watchers.delete(namespace);
    }
    const timer = this.timers.get(namespace);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(namespace);
    }
  }

  stop(): void {
    for (const namespace of [...this.watchers.keys()]) {
      this.unwatch(namespace);
    }
  }

  get watchedNamespaces(): string[] {
    return [...this.watchers.keys()];
  }

  private scheduleReload(namespace: string): void {
    const existing = this.timers.get(namespace);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.timers.delete(namespace);
      try {
        const result = this.lifecycle.reload(namespace);
        this.onReload?.(namespace, result);
      } catch {
        // Reload errors are non-fatal in dev mode
      }
    }, this.debounceMs);

    this.timers.set(namespace, timer);
  }
}
