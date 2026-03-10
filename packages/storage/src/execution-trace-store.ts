import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { IExecutionTraceStore, ExecutionTraceRecord, CreateExecutionTraceInput, ExecutionTraceFilter } from './interfaces.js';

export class SqliteExecutionTraceStore implements IExecutionTraceStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  insert(trace: CreateExecutionTraceInput): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO execution_traces (id, conversation_id, trace_id, skill_name, bot_id, model, prompt, tool_calls, retrieved_docs, agent_reasoning, final_answer, score, score_feedback, user_feedback, input_tokens, output_tokens, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
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
      );
    return id;
  }

  get(id: string): ExecutionTraceRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, conversation_id, trace_id, skill_name, bot_id, model, prompt, tool_calls, retrieved_docs, agent_reasoning, final_answer, score, score_feedback, user_feedback, input_tokens, output_tokens, duration_ms, created_at
         FROM execution_traces WHERE id = ?`,
      )
      .get(id) as TraceRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  query(filter: ExecutionTraceFilter = {}): ExecutionTraceRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.conversationId) {
      conditions.push('conversation_id = ?');
      params.push(filter.conversationId);
    }
    if (filter.skillName) {
      conditions.push('skill_name = ?');
      params.push(filter.skillName);
    }
    if (filter.botId) {
      conditions.push('bot_id = ?');
      params.push(filter.botId);
    }
    if (filter.model) {
      conditions.push('model = ?');
      params.push(filter.model);
    }
    if (filter.hasScore === true) {
      conditions.push('score IS NOT NULL');
    }
    if (filter.hasNegativeScore === true) {
      conditions.push('score IS NOT NULL AND score < 0.5');
    }
    if (filter.since) {
      conditions.push('created_at >= ?');
      params.push(filter.since);
    }

    let sql = `SELECT id, conversation_id, trace_id, skill_name, bot_id, model, prompt, tool_calls, retrieved_docs, agent_reasoning, final_answer, score, score_feedback, user_feedback, input_tokens, output_tokens, duration_ms, created_at FROM execution_traces`;
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC';
    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as TraceRow[];
    return rows.map(mapRow);
  }

  count(filter: ExecutionTraceFilter = {}): number {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.conversationId) {
      conditions.push('conversation_id = ?');
      params.push(filter.conversationId);
    }
    if (filter.skillName) {
      conditions.push('skill_name = ?');
      params.push(filter.skillName);
    }
    if (filter.botId) {
      conditions.push('bot_id = ?');
      params.push(filter.botId);
    }
    if (filter.hasScore === true) {
      conditions.push('score IS NOT NULL');
    }
    if (filter.hasNegativeScore === true) {
      conditions.push('score IS NOT NULL AND score < 0.5');
    }
    if (filter.since) {
      conditions.push('created_at >= ?');
      params.push(filter.since);
    }

    let sql = 'SELECT COUNT(*) as cnt FROM execution_traces';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const row = this.db.prepare(sql).get(...params) as { cnt: number };
    return row.cnt;
  }

  updateScore(id: string, score: number, feedback?: string): void {
    this.db
      .prepare(
        `UPDATE execution_traces SET score = ?, score_feedback = ? WHERE id = ?`,
      )
      .run(score, feedback ?? null, id);
  }

  averageScore(componentName: string, botId: string | null, days: number): number | null {
    const conditions = ['score IS NOT NULL', 'skill_name = ?'];
    const params: unknown[] = [componentName];

    if (botId) {
      conditions.push('bot_id = ?');
      params.push(botId);
    } else {
      conditions.push('bot_id IS NULL');
    }

    if (days > 0) {
      conditions.push(`created_at >= datetime('now', ?)`);
      params.push(`-${days} days`);
    }

    const sql = `SELECT AVG(score) as avg_score FROM execution_traces WHERE ${conditions.join(' AND ')}`;
    const row = this.db.prepare(sql).get(...params) as { avg_score: number | null };
    return row.avg_score;
  }

  deleteOlderThan(days: number): number {
    if (days <= 0) {
      return this.db.prepare('DELETE FROM execution_traces').run().changes;
    }
    return this.db
      .prepare(`DELETE FROM execution_traces WHERE created_at < datetime('now', ?)`)
      .run(`-${days} days`).changes;
  }
}

interface TraceRow {
  id: string;
  conversation_id: string;
  trace_id: string;
  skill_name: string | null;
  bot_id: string | null;
  model: string | null;
  prompt: string;
  tool_calls: string;
  retrieved_docs: string;
  agent_reasoning: string | null;
  final_answer: string;
  score: number | null;
  score_feedback: string | null;
  user_feedback: string | null;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  created_at: string;
}

function mapRow(row: TraceRow): ExecutionTraceRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    traceId: row.trace_id,
    skillName: row.skill_name,
    botId: row.bot_id,
    model: row.model,
    prompt: row.prompt,
    toolCalls: JSON.parse(row.tool_calls),
    retrievedDocs: JSON.parse(row.retrieved_docs),
    agentReasoning: row.agent_reasoning,
    finalAnswer: row.final_answer,
    score: row.score,
    scoreFeedback: row.score_feedback,
    userFeedback: row.user_feedback,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}
