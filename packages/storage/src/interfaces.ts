import type { Message } from '@nexora-kit/core';
import type { ConfigResolver, ConfigEntry } from '@nexora-kit/config';
import type { PluginStateRecord } from './plugin-state-store.js';
import type { TokenUsageRecord } from './token-usage-store.js';
import type { UsageEvent, UsageEventFilter } from './usage-event-store.js';
import type { AuditEvent, AuditEventFilter } from './audit-event-store.js';

export interface IMessageStore {
  get(conversationId: string): Promise<Message[]>;
  append(conversationId: string, messages: Message[]): Promise<void>;
  clear(conversationId: string): Promise<void>;
  truncateFrom(conversationId: string, fromSeq: number): Promise<void>;
}

// --- Conversation Store ---

export interface ConversationRecord {
  id: string;
  teamId: string;
  userId: string;
  title: string | null;
  systemPrompt?: string | null;
  templateId?: string | null;
  workspaceId?: string | null;
  model?: string | null;
  agentId?: string | null;
  pluginNamespaces: string[];
  messageCount: number;
  lastMessageAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface CreateConversationInput {
  teamId: string;
  userId: string;
  title?: string;
  systemPrompt?: string;
  templateId?: string;
  workspaceId?: string;
  model?: string;
  agentId?: string;
  pluginNamespaces?: string[];
  metadata?: Record<string, unknown>;
}

export interface ConversationPatch {
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface ListConversationsOptions {
  limit?: number;
  cursor?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
}

export interface IConversationStore {
  create(input: CreateConversationInput): ConversationRecord | Promise<ConversationRecord>;
  get(id: string, userId: string): ConversationRecord | undefined | Promise<ConversationRecord | undefined>;
  list(userId: string, opts?: ListConversationsOptions): PaginatedResult<ConversationRecord> | Promise<PaginatedResult<ConversationRecord>>;
  update(id: string, userId: string, patch: ConversationPatch): ConversationRecord | undefined | Promise<ConversationRecord | undefined>;
  softDelete(id: string, userId: string): boolean | Promise<boolean>;
  updateMessageStats(id: string, count: number, lastMessageAt: string): void | Promise<void>;
}

// --- Other Stores ---

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
