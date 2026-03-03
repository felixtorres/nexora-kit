import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  IFeedbackStore,
  FeedbackRecord,
  SubmitFeedbackInput,
  FeedbackQueryOptions,
  FeedbackSummaryOptions,
  FeedbackSummary,
  PaginatedResult,
} from './interfaces.js';

export class SqliteFeedbackStore implements IFeedbackStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  submit(input: SubmitFeedbackInput): FeedbackRecord {
    const id = randomUUID();
    const tags = JSON.stringify(input.tags ?? []);

    // Upsert: insert or replace on unique(conversation_id, message_seq, user_id)
    this.db
      .prepare(
        `INSERT INTO feedback (id, conversation_id, message_seq, user_id, rating, comment, tags, plugin_namespace, model)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(conversation_id, message_seq, user_id)
         DO UPDATE SET rating = excluded.rating, comment = excluded.comment, tags = excluded.tags,
                       plugin_namespace = excluded.plugin_namespace, model = excluded.model`,
      )
      .run(
        id,
        input.conversationId,
        input.messageSeq,
        input.userId,
        input.rating,
        input.comment ?? null,
        tags,
        input.pluginNamespace ?? null,
        input.model ?? null,
      );

    // Return the stored record (may have existing id if upserted)
    return this.get(input.conversationId, input.messageSeq, input.userId)!;
  }

  get(conversationId: string, messageSeq: number, userId: string): FeedbackRecord | undefined {
    const row = this.db
      .prepare(
        'SELECT id, conversation_id, message_seq, user_id, rating, comment, tags, plugin_namespace, model, created_at FROM feedback WHERE conversation_id = ? AND message_seq = ? AND user_id = ?',
      )
      .get(conversationId, messageSeq, userId) as FeedbackRow | undefined;

    return row ? mapRow(row) : undefined;
  }

  query(opts: FeedbackQueryOptions = {}): PaginatedResult<FeedbackRecord> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.pluginNamespace) {
      conditions.push('plugin_namespace = ?');
      params.push(opts.pluginNamespace);
    }
    if (opts.rating) {
      conditions.push('rating = ?');
      params.push(opts.rating);
    }
    if (opts.from) {
      conditions.push('created_at >= ?');
      params.push(opts.from);
    }
    if (opts.to) {
      conditions.push('created_at <= ?');
      params.push(opts.to);
    }
    if (opts.cursor) {
      // Cursor format: "created_at|id" for stable pagination
      const [cursorTime, cursorId] = opts.cursor.split('|');
      conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
      params.push(cursorTime, cursorTime, cursorId);
    }

    let sql = 'SELECT id, conversation_id, message_seq, user_id, rating, comment, tags, plugin_namespace, model, created_at FROM feedback';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC, id DESC';

    const limit = opts.limit ?? 50;
    sql += ' LIMIT ?';
    params.push(limit + 1);

    const rows = this.db.prepare(sql).all(...params) as FeedbackRow[];
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(mapRow);
    const lastItem = items[items.length - 1];
    const nextCursor = hasMore && lastItem ? `${lastItem.createdAt}|${lastItem.id}` : null;

    return { items, nextCursor };
  }

  summary(opts: FeedbackSummaryOptions = {}): FeedbackSummary {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.pluginNamespace) {
      conditions.push('plugin_namespace = ?');
      params.push(opts.pluginNamespace);
    }
    if (opts.model) {
      conditions.push('model = ?');
      params.push(opts.model);
    }
    if (opts.from) {
      conditions.push('created_at >= ?');
      params.push(opts.from);
    }
    if (opts.to) {
      conditions.push('created_at <= ?');
      params.push(opts.to);
    }

    const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
    const andWhere = conditions.length > 0 ? where + ' AND ' : ' WHERE ';

    // Total counts
    const totals = this.db
      .prepare(`SELECT rating, COUNT(*) as cnt FROM feedback${where} GROUP BY rating`)
      .all(...params) as { rating: string; cnt: number }[];

    let positiveCount = 0;
    let negativeCount = 0;
    for (const r of totals) {
      if (r.rating === 'positive') positiveCount = r.cnt;
      else if (r.rating === 'negative') negativeCount = r.cnt;
    }
    const totalCount = positiveCount + negativeCount;
    const positiveRate = totalCount > 0 ? positiveCount / totalCount : 0;

    // By plugin
    const byPluginRows = this.db
      .prepare(
        `SELECT plugin_namespace, rating, COUNT(*) as cnt FROM feedback${andWhere}plugin_namespace IS NOT NULL GROUP BY plugin_namespace, rating`,
      )
      .all(...params) as { plugin_namespace: string; rating: string; cnt: number }[];

    const pluginMap = new Map<string, { positive: number; negative: number }>();
    for (const r of byPluginRows) {
      const entry = pluginMap.get(r.plugin_namespace) ?? { positive: 0, negative: 0 };
      if (r.rating === 'positive') entry.positive = r.cnt;
      else entry.negative = r.cnt;
      pluginMap.set(r.plugin_namespace, entry);
    }

    // By model
    const byModelRows = this.db
      .prepare(
        `SELECT model, rating, COUNT(*) as cnt FROM feedback${andWhere}model IS NOT NULL GROUP BY model, rating`,
      )
      .all(...params) as { model: string; rating: string; cnt: number }[];

    const modelMap = new Map<string, { positive: number; negative: number }>();
    for (const r of byModelRows) {
      const entry = modelMap.get(r.model) ?? { positive: 0, negative: 0 };
      if (r.rating === 'positive') entry.positive = r.cnt;
      else entry.negative = r.cnt;
      modelMap.set(r.model, entry);
    }

    // Top tags
    const allRows = this.db
      .prepare(`SELECT tags FROM feedback${where}`)
      .all(...params) as { tags: string }[];

    const tagCounts = new Map<string, number>();
    for (const r of allRows) {
      const tags: string[] = JSON.parse(r.tags);
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

  deleteByConversation(conversationId: string): void {
    this.db.prepare('DELETE FROM feedback WHERE conversation_id = ?').run(conversationId);
  }

  deleteFromSeq(conversationId: string, fromSeq: number): void {
    this.db.prepare('DELETE FROM feedback WHERE conversation_id = ? AND message_seq >= ?').run(conversationId, fromSeq);
  }
}

interface FeedbackRow {
  id: string;
  conversation_id: string;
  message_seq: number;
  user_id: string;
  rating: string;
  comment: string | null;
  tags: string;
  plugin_namespace: string | null;
  model: string | null;
  created_at: string;
}

function mapRow(row: FeedbackRow): FeedbackRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageSeq: row.message_seq,
    userId: row.user_id,
    rating: row.rating as 'positive' | 'negative',
    comment: row.comment,
    tags: JSON.parse(row.tags),
    pluginNamespace: row.plugin_namespace,
    model: row.model,
    createdAt: row.created_at,
  };
}
