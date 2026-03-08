import * as fs from 'node:fs';
import { extname } from 'node:path';
import type { ToolExtensionLoader } from './tool-extension-loader.js';

export interface ToolExtensionWatcherOptions {
  debounceMs?: number;
  signal?: AbortSignal;
  onReload?: (filePath: string) => void;
  onError?: (filePath: string, error: string) => void;
}

export class ToolExtensionWatcher {
  private readonly loader: ToolExtensionLoader;
  private readonly debounceMs: number;
  private readonly onReload?: (filePath: string) => void;
  private readonly onError?: (filePath: string, error: string) => void;
  private watcher: fs.FSWatcher | null = null;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(loader: ToolExtensionLoader, options: ToolExtensionWatcherOptions = {}) {
    this.loader = loader;
    this.debounceMs = options.debounceMs ?? 300;
    this.onReload = options.onReload;
    this.onError = options.onError;

    if (options.signal) {
      options.signal.addEventListener('abort', () => this.stop(), { once: true });
    }
  }

  watch(dir: string): void {
    if (this.watcher) {
      throw new Error('Already watching');
    }

    this.watcher = fs.watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const ext = extname(filename);
      if (ext !== '.ts' && ext !== '.js' && ext !== '.mjs') return;

      const filePath = `${dir}/${filename}`;
      this.scheduleReload(filePath);
    });
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private scheduleReload(filePath: string): void {
    const existing = this.timers.get(filePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      this.timers.delete(filePath);
      try {
        await this.loader.reloadFile(filePath);
        this.onReload?.(filePath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.onError?.(filePath, msg);
      }
    }, this.debounceMs);

    this.timers.set(filePath, timer);
  }
}
