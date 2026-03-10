import { randomUUID } from 'node:crypto';
import type { IExecutionTraceStore, ExecutionTraceRecord, CreateExecutionTraceInput, ExecutionTraceFilter } from '../interfaces.js';
import type { PgPool } from './pg-pool.js';

export class PgExecutionTraceStore implements IExecutionTraceStore {
  constructor(private readonly pool: PgPool) {}

  async insert(trace: CreateExecutionTraceInput): Promise<string> {
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO execution_traces (id, conversation_id, trace_id, skill_name, bot_id, model, prompt, tool_calls, retrieved_docs, agent_reasoning, final_answer, score, score_feedback, user_feedback, input_tokens, output_tokens, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        id,
        trace.conversationId,
        trace.traceId,
        trace.skillName ?? null,
        trace.botId ?? null,
        trace.model ?? null,
        trace.prompt,
        JSON.stringify(trace.toolCalls ?? []),
        JSON.stringify(trace.retrievedDocs ?? []),
        trace.agentReasoning ?? null,
        trace.finalAnswer,
        trace.score ?? null,
        trace.scoreFeedback ?? null,
        trace.userFeedback ?? null,
        trace.inputTokens ?? 0,
        trace.outputTokens ?? 0,
        trace.durationMs ?? 0,
      ],
    );
    return id;
  }

  async get(id: string): Promise<ExecutionTraceRecord | undefined> {
    const { rows } = await this.pool.query(
      `SELECT * FROM execution_traces WHERE id = $1`,
      [id],
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  }

  async query(filter: ExecutionTraceFilter = {}): Promise<ExecutionTraceRecord[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filter.conversationId) {
      conditions.push(`conversation_id = $${idx++}`);
      params.push(filter.conversationId);
    }
    if (filter.skillName) {
      conditions.push(`skill_name = $${idx++}`);
      params.push(filter.skillName);
    }
    if (filter.botId) {
      conditions.push(`bot_id = $${idx++}`);
      params.push(filter.botId);
    }
    if (filter.model) {
      conditions.push(`model = $${idx++}`);
      params.push(filter.model);
    }
    if (filter.hasScore === true) {
      conditions.push('score IS NOT NULL');
    }
    if (filter.hasNegativeScore === true) {
      conditions.push('score IS NOT NULL AND score < 0.5');
    }
    if (filter.since) {
      conditions.push(`created_at >= $${idx++}`);
      params.push(filter.since);
    }

    let sql = 'SELECT * FROM execution_traces';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC';
    if (filter.limit) {
      sql += ` LIMIT $${idx++}`;
      params.push(filter.limit);
    }

    const { rows } = await this.pool.query(sql, params);
    return rows.map(mapRow);
  }

  async count(filter: ExecutionTraceFilter = {}): Promise<number> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filter.conversationId) {
      conditions.push(`conversation_id = $${idx++}`);
      params.push(filter.conversationId);
    }
    if (filter.skillName) {
      conditions.push(`skill_name = $${idx++}`);
      params.push(filter.skillName);
    }
    if (filter.botId) {
      conditions.push(`bot_id = $${idx++}`);
      params.push(filter.botId);
    }
    if (filter.hasScore === true) {
      conditions.push('score IS NOT NULL');
    }
    if (filter.hasNegativeScore === true) {
      conditions.push('score IS NOT NULL AND score < 0.5');
    }
    if (filter.since) {
      conditions.push(`created_at >= $${idx++}`);
      params.push(filter.since);
    }

    let sql = 'SELECT COUNT(*)::int as cnt FROM execution_traces';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const { rows } = await this.pool.query(sql, params);
    return rows[0].cnt;
  }

  async updateScore(id: string, score: number, feedback?: string): Promise<void> {
    await this.pool.query(
      `UPDATE execution_traces SET score = $1, score_feedback = $2 WHERE id = $3`,
      [score, feedback ?? null, id],
    );
  }

  async averageScore(componentName: string, botId: string | null, days: number): Promise<number | null> {
    const conditions = ['score IS NOT NULL', 'skill_name = $1'];
    const params: unknown[] = [componentName];
    let idx = 2;

    if (botId) {
      conditions.push(`bot_id = $${idx++}`);
      params.push(botId);
    } else {
      conditions.push('bot_id IS NULL');
    }

    if (days > 0) {
      conditions.push(`created_at >= NOW() - $${idx++}::interval`);
      params.push(`${days} days`);
    }

    const sql = `SELECT AVG(score) as avg_score FROM execution_traces WHERE ${conditions.join(' AND ')}`;
    const { rows } = await this.pool.query(sql, params);
    return rows[0]?.avg_score ?? null;
  }

  async deleteOlderThan(days: number): Promise<number> {
    if (days <= 0) {
      const { rowCount } = await this.pool.query('DELETE FROM execution_traces');
      return rowCount ?? 0;
    }
    const { rowCount } = await this.pool.query(
      `DELETE FROM execution_traces WHERE created_at < NOW() - $1::interval`,
      [`${days} days`],
    );
    return rowCount ?? 0;
  }
}

function mapRow(row: any): ExecutionTraceRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    traceId: row.trace_id,
    skillName: row.skill_name,
    botId: row.bot_id,
    model: row.model,
    prompt: row.prompt,
    toolCalls: typeof row.tool_calls === 'string' ? JSON.parse(row.tool_calls) : row.tool_calls,
    retrievedDocs: typeof row.retrieved_docs === 'string' ? JSON.parse(row.retrieved_docs) : row.retrieved_docs,
    agentReasoning: row.agent_reasoning,
    finalAnswer: row.final_answer,
    score: row.score,
    scoreFeedback: row.score_feedback,
    userFeedback: row.user_feedback,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    durationMs: row.duration_ms,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  };
}
