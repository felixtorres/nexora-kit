import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  IConversationStore,
  ConversationRecord,
  CreateConversationInput,
  ConversationPatch,
  ListConversationsOptions,
  PaginatedResult,
} from './interfaces.js';

export class SqliteConversationStore implements IConversationStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(input: CreateConversationInput): ConversationRecord {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO conversations (id, team_id, user_id, title, system_prompt, template_id, workspace_id, model, agent_id, plugin_namespaces, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.teamId,
      input.userId,
      input.title ?? null,
      input.systemPrompt ?? null,
      input.templateId ?? null,
      input.workspaceId ?? null,
      input.model ?? null,
      input.agentId ?? null,
      JSON.stringify(input.pluginNamespaces ?? []),
      JSON.stringify(input.metadata ?? {}),
      now,
      now,
    );

    return {
      id,
      teamId: input.teamId,
      userId: input.userId,
      title: input.title ?? null,
      systemPrompt: input.systemPrompt ?? null,
      templateId: input.templateId ?? null,
      workspaceId: input.workspaceId ?? null,
      model: input.model ?? null,
      agentId: input.agentId ?? null,
      pluginNamespaces: input.pluginNamespaces ?? [],
      messageCount: 0,
      lastMessageAt: null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
  }

  get(id: string, userId: string): ConversationRecord | undefined {
    const row = this.db.prepare(
      'SELECT * FROM conversations WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
    ).get(id, userId) as any;

    return row ? this.mapRow(row) : undefined;
  }

  list(userId: string, opts?: ListConversationsOptions): PaginatedResult<ConversationRecord> {
    const limit = opts?.limit ?? 20;

    let sql: string;
    let params: any[];

    if (opts?.cursor) {
      const [cursorDate, cursorId] = decodeCursor(opts.cursor);
      sql = `SELECT * FROM conversations
        WHERE user_id = ? AND deleted_at IS NULL
        AND (updated_at < ? OR (updated_at = ? AND id < ?))
        ORDER BY updated_at DESC, id DESC
        LIMIT ?`;
      params = [userId, cursorDate, cursorDate, cursorId, limit + 1];
    } else {
      sql = `SELECT * FROM conversations
        WHERE user_id = ? AND deleted_at IS NULL
        ORDER BY updated_at DESC, id DESC
        LIMIT ?`;
      params = [userId, limit + 1];
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => this.mapRow(r));

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor(last.updatedAt, last.id);
    }

    return { items, nextCursor };
  }

  update(id: string, userId: string, patch: ConversationPatch): ConversationRecord | undefined {
    const existing = this.get(id, userId);
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const values: any[] = [now];

    if (patch.title !== undefined) {
      sets.push('title = ?');
      values.push(patch.title);
    }
    if (patch.metadata !== undefined) {
      sets.push('metadata = ?');
      values.push(JSON.stringify(patch.metadata));
    }

    values.push(id, userId);

    this.db.prepare(
      `UPDATE conversations SET ${sets.join(', ')} WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    ).run(...values);

    return this.get(id, userId);
  }

  softDelete(id: string, userId: string): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      'UPDATE conversations SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
    ).run(now, now, id, userId);

    return result.changes > 0;
  }

  updateMessageStats(id: string, count: number, lastMessageAt: string): void {
    this.db.prepare(
      'UPDATE conversations SET message_count = ?, last_message_at = ?, updated_at = ? WHERE id = ?',
    ).run(count, lastMessageAt, new Date().toISOString(), id);
  }

  private mapRow(row: any): ConversationRecord {
    return {
      id: row.id,
      teamId: row.team_id,
      userId: row.user_id,
      title: row.title ?? null,
      systemPrompt: row.system_prompt ?? null,
      templateId: row.template_id ?? null,
      workspaceId: row.workspace_id ?? null,
      model: row.model ?? null,
      agentId: row.agent_id ?? null,
      pluginNamespaces: JSON.parse(row.plugin_namespaces),
      messageCount: row.message_count,
      lastMessageAt: row.last_message_at ?? null,
      metadata: JSON.parse(row.metadata),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at ?? null,
    };
  }
}

function encodeCursor(updatedAt: string, id: string): string {
  return Buffer.from(`${updatedAt}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): [string, string] {
  const decoded = Buffer.from(cursor, 'base64url').toString();
  const idx = decoded.indexOf('|');
  if (idx === -1) throw new Error('Invalid cursor');
  return [decoded.slice(0, idx), decoded.slice(idx + 1)];
}
