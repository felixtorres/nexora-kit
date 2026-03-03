import { randomUUID } from 'node:crypto';
import type {
  IFeedbackStore,
  FeedbackRecord,
  SubmitFeedbackInput,
  FeedbackQueryOptions,
  FeedbackSummaryOptions,
  FeedbackSummary,
  PaginatedResult,
} from '../interfaces.js';
import type { PgPool } from './pg-pool.js';

export class PgFeedbackStore implements IFeedbackStore {
  constructor(private readonly pool: PgPool) {}

  async submit(input: SubmitFeedbackInput): Promise<FeedbackRecord> {
    const id = randomUUID();
    const tags = JSON.stringify(input.tags ?? []);

    const { rows } = await this.pool.query(
      `INSERT INTO feedback (id, conversation_id, message_seq, user_id, rating, comment, tags, plugin_namespace, model)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT(conversation_id, message_seq, user_id)
       DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, tags = EXCLUDED.tags,
                     plugin_namespace = EXCLUDED.plugin_namespace, model = EXCLUDED.model
       RETURNING id, conversation_id, message_seq, user_id, rating, comment, tags, plugin_namespace, model, created_at`,
      [
        id,
        input.conversationId,
        input.messageSeq,
        input.userId,
        input.rating,
        input.comment ?? null,
        tags,
        input.pluginNamespace ?? null,
        input.model ?? null,
      ],
    );

    return mapRow(rows[0]);
  }

  async get(conversationId: string, messageSeq: number, userId: string): Promise<FeedbackRecord | undefined> {
    const { rows } = await this.pool.query(
      'SELECT id, conversation_id, message_seq, user_id, rating, comment, tags, plugin_namespace, model, created_at FROM feedback WHERE conversation_id = $1 AND message_seq = $2 AND user_id = $3',
      [conversationId, messageSeq, userId],
    );
    return rows.length > 0 ? mapRow(rows[0]) : undefined;
  }

  async query(opts: FeedbackQueryOptions = {}): Promise<PaginatedResult<FeedbackRecord>> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (opts.pluginNamespace) {
      conditions.push(`plugin_namespace = $${paramIdx++}`);
      params.push(opts.pluginNamespace);
    }
    if (opts.rating) {
      conditions.push(`rating = $${paramIdx++}`);
      params.push(opts.rating);
    }
    if (opts.from) {
      conditions.push(`created_at >= $${paramIdx++}`);
      params.push(opts.from);
    }
    if (opts.to) {
      conditions.push(`created_at <= $${paramIdx++}`);
      params.push(opts.to);
    }
    if (opts.cursor) {
      const [cursorTime, cursorId] = opts.cursor.split('|');
      conditions.push(`(created_at < $${paramIdx} OR (created_at = $${paramIdx} AND id < $${paramIdx + 1}))`);
      params.push(cursorTime, cursorId);
      paramIdx += 2;
    }

    let sql = 'SELECT id, conversation_id, message_seq, user_id, rating, comment, tags, plugin_namespace, model, created_at FROM feedback';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC, id DESC';

    const limit = opts.limit ?? 50;
    sql += ` LIMIT $${paramIdx++}`;
    params.push(limit + 1);

    const { rows } = await this.pool.query(sql, params);
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(mapRow);
    const lastItem = items[items.length - 1];
    const nextCursor = hasMore && lastItem ? `${lastItem.createdAt}|${lastItem.id}` : null;

    return { items, nextCursor };
  }

  async summary(opts: FeedbackSummaryOptions = {}): Promise<FeedbackSummary> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (opts.pluginNamespace) {
      conditions.push(`plugin_namespace = $${paramIdx++}`);
      params.push(opts.pluginNamespace);
    }
    if (opts.model) {
      conditions.push(`model = $${paramIdx++}`);
      params.push(opts.model);
    }
    if (opts.from) {
      conditions.push(`created_at >= $${paramIdx++}`);
      params.push(opts.from);
    }
    if (opts.to) {
      conditions.push(`created_at <= $${paramIdx++}`);
      params.push(opts.to);
    }

    const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
    const andWhere = conditions.length > 0 ? where + ' AND ' : ' WHERE ';

    // Total counts
    const { rows: totals } = await this.pool.query(
      `SELECT rating, COUNT(*) as cnt FROM feedback${where} GROUP BY rating`,
      params,
    );

    let positiveCount = 0;
    let negativeCount = 0;
    for (const r of totals) {
      if (r.rating === 'positive') positiveCount = Number(r.cnt);
      else if (r.rating === 'negative') negativeCount = Number(r.cnt);
    }
    const totalCount = positiveCount + negativeCount;
    const positiveRate = totalCount > 0 ? positiveCount / totalCount : 0;

    // By plugin
    const { rows: byPluginRows } = await this.pool.query(
      `SELECT plugin_namespace, rating, COUNT(*) as cnt FROM feedback${andWhere}plugin_namespace IS NOT NULL GROUP BY plugin_namespace, rating`,
      params,
    );

    const pluginMap = new Map<string, { positive: number; negative: number }>();
    for (const r of byPluginRows) {
      const entry = pluginMap.get(r.plugin_namespace) ?? { positive: 0, negative: 0 };
      if (r.rating === 'positive') entry.positive = Number(r.cnt);
      else entry.negative = Number(r.cnt);
      pluginMap.set(r.plugin_namespace, entry);
    }

    // By model
    const { rows: byModelRows } = await this.pool.query(
      `SELECT model, rating, COUNT(*) as cnt FROM feedback${andWhere}model IS NOT NULL GROUP BY model, rating`,
      params,
    );

    const modelMap = new Map<string, { positive: number; negative: number }>();
    for (const r of byModelRows) {
      const entry = modelMap.get(r.model) ?? { positive: 0, negative: 0 };
      if (r.rating === 'positive') entry.positive = Number(r.cnt);
      else entry.negative = Number(r.cnt);
      modelMap.set(r.model, entry);
    }

    // Top tags — fetch all tags and aggregate in-memory
    const { rows: tagRows } = await this.pool.query(
      `SELECT tags FROM feedback${where}`,
      params,
    );

    const tagCounts = new Map<string, number>();
    for (const r of tagRows) {
      const tags: string[] = typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags;
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }

    const topTags = Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalCount,
      positiveCount,
      negativeCount,
      positiveRate,
      byPlugin: Array.from(pluginMap.entries()).map(([pluginNamespace, v]) => ({ pluginNamespace, ...v })),
      byModel: Array.from(modelMap.entries()).map(([model, v]) => ({ model, ...v })),
      topTags,
    };
  }

  async deleteByConversation(conversationId: string): Promise<void> {
    await this.pool.query('DELETE FROM feedback WHERE conversation_id = $1', [conversationId]);
  }

  async deleteFromSeq(conversationId: string, fromSeq: number): Promise<void> {
    await this.pool.query('DELETE FROM feedback WHERE conversation_id = $1 AND message_seq >= $2', [conversationId, fromSeq]);
  }
}

function mapRow(row: Record<string, unknown>): FeedbackRecord {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    messageSeq: row.message_seq as number,
    userId: row.user_id as string,
    rating: row.rating as 'positive' | 'negative',
    comment: (row.comment as string | null) ?? null,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags as string[]),
    pluginNamespace: (row.plugin_namespace as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    createdAt: (row.created_at as Date)?.toISOString?.() ?? (row.created_at as string),
  };
}
