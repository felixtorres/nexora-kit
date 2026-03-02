import type { Message } from '@nexora-kit/core';
import type { ConfigResolver, ConfigEntry } from '@nexora-kit/config';
import type { PluginStateRecord } from './plugin-state-store.js';
import type { TokenUsageRecord } from './token-usage-store.js';
import type { UsageEvent, UsageEventFilter } from './usage-event-store.js';
import type { AuditEvent, AuditEventFilter } from './audit-event-store.js';

export interface IMemoryStore {
  get(sessionId: string): Promise<Message[]>;
  append(sessionId: string, messages: Message[]): Promise<void>;
  clear(sessionId: string): Promise<void>;
}

export interface IConfigStore {
  loadInto(resolver: ConfigResolver): void | Promise<void>;
  persist(entry: ConfigEntry): void | Promise<void>;
  persistAll(entries: ConfigEntry[]): void | Promise<void>;
  getAll(): ConfigEntry[] | Promise<ConfigEntry[]>;
}

export interface IPluginStateStore {
  save(record: PluginStateRecord): void | Promise<void>;
  get(namespace: string): PluginStateRecord | undefined | Promise<PluginStateRecord | undefined>;
  getAll(): PluginStateRecord[] | Promise<PluginStateRecord[]>;
  remove(namespace: string): boolean | Promise<boolean>;
}

export interface ITokenUsageStore {
  save(record: TokenUsageRecord): void | Promise<void>;
  get(pluginNamespace: string): TokenUsageRecord | undefined | Promise<TokenUsageRecord | undefined>;
  getAll(): TokenUsageRecord[] | Promise<TokenUsageRecord[]>;
  reset(pluginNamespace: string): boolean | Promise<boolean>;
}

export interface IUsageEventStore {
  insert(event: UsageEvent): number | Promise<number>;
  query(filter?: UsageEventFilter): UsageEvent[] | Promise<UsageEvent[]>;
}

export interface IAuditEventStore {
  insert(event: AuditEvent): number | Promise<number>;
  query(filter?: AuditEventFilter): AuditEvent[] | Promise<AuditEvent[]>;
  deleteOlderThan(days: number): number | Promise<number>;
  count(): number | Promise<number>;
}
