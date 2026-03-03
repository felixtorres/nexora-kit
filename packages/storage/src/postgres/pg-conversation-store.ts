import { randomUUID } from 'node:crypto';
import type { PgPool } from './pg-pool.js';
import type {
  IConversationStore,
  ConversationRecord,
  CreateConversationInput,
  ConversationPatch,
  ListConversationsOptions,
  PaginatedResult,
} from '../interfaces.js';

export class PgConversationStore implements IConversationStore {
  constructor(private readonly pool: PgPool) {}

  async create(input: CreateConversationInput): Promise<ConversationRecord> {
    const id = randomUUID();
    const now = new Date().toISOString();

    await this.pool.query(
      `INSERT INTO conversations (id, team_id, user_id, title, system_prompt, template_id, workspace_id, model, agent_id, plugin_namespaces, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
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
      ],
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

  async get(id: string, userId: string): Promise<ConversationRecord | undefined> {
    const { rows } = await this.pool.query(
      'SELECT * FROM conversations WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, userId],
    );
    return rows[0] ? this.mapRow(rows[0]) : undefined;
  }

  async list(userId: string, opts?: ListConversationsOptions): Promise<PaginatedResult<ConversationRecord>> {
    const limit = opts?.limit ?? 20;

    let rows: any[];
    if (opts?.cursor) {
      const [cursorDate, cursorId] = decodeCursor(opts.cursor);
      const result = await this.pool.query(
        `SELECT * FROM conversations
         WHERE user_id = $1 AND deleted_at IS NULL
         AND (updated_at < $2 OR (updated_at = $2 AND id < $3))
         ORDER BY updated_at DESC, id DESC
         LIMIT $4`,
        [userId, cursorDate, cursorId, limit + 1],
      );
      rows = result.rows;
    } else {
      const result = await this.pool.query(
        `SELECT * FROM conversations
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY updated_at DESC, id DESC
         LIMIT $2`,
        [userId, limit + 1],
      );
      rows = result.rows;
    }

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => this.mapRow(r));

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor(last.updatedAt, last.id);
    }

    return { items, nextCursor };
  }

  async update(id: string, userId: string, patch: ConversationPatch): Promise<ConversationRecord | undefined> {
    const existing = await this.get(id, userId);
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = $1'];
    const values: any[] = [now];
    let idx = 2;

    if (patch.title !== undefined) {
      sets.push(`title = $${idx++}`);
      values.push(patch.title);
    }
    if (patch.metadata !== undefined) {
      sets.push(`metadata = $${idx++}`);
      values.push(JSON.stringify(patch.metadata));
    }

    values.push(id, userId);

    await this.pool.query(
      `UPDATE conversations SET ${sets.join(', ')} WHERE id = $${idx++} AND user_id = $${idx} AND deleted_at IS NULL`,
      values,
    );

    return this.get(id, userId);
  }

  async softDelete(id: string, userId: string): Promise<boolean> {
    const now = new Date().toISOString();
    const result = await this.pool.query(
      'UPDATE conversations SET deleted_at = $1, updated_at = $1 WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL',
      [now, id, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async updateMessageStats(id: string, count: number, lastMessageAt: string): Promise<void> {
    await this.pool.query(
      'UPDATE conversations SET message_count = $1, last_message_at = $2, updated_at = $3 WHERE id = $4',
      [count, lastMessageAt, new Date().toISOString(), id],
    );
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
      pluginNamespaces: typeof row.plugin_namespaces === 'string'
        ? JSON.parse(row.plugin_namespaces)
        : row.plugin_namespaces,
      messageCount: row.message_count,
      lastMessageAt: row.last_message_at?.toISOString?.() ?? row.last_message_at ?? null,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      createdAt: row.created_at?.toISOString?.() ?? row.created_at,
      updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
      deletedAt: row.deleted_at?.toISOString?.() ?? row.deleted_at ?? null,
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
