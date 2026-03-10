import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  IOptimizedPromptStore,
  OptimizedPromptRecord,
  CreateOptimizedPromptInput,
  OptimizedPromptFilter,
  OptimizedPromptStatus,
  OptimizedPromptComponentType,
} from './interfaces.js';

export class SqliteOptimizedPromptStore implements IOptimizedPromptStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  insert(prompt: CreateOptimizedPromptInput): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO optimized_prompts (id, component_type, component_name, bot_id, original_prompt, optimized_prompt, score, score_improvement, pareto_rank, evolution_depth, parent_id, reflection_log, optimized_for_model)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        prompt.componentType,
        prompt.componentName,
        prompt.botId ?? null,
        prompt.originalPrompt,
        prompt.optimizedPrompt,
        prompt.score,
        prompt.scoreImprovement,
        prompt.paretoRank ?? 0,
        prompt.evolutionDepth ?? 0,
        prompt.parentId ?? null,
        prompt.reflectionLog,
        prompt.optimizedForModel,
      );
    return id;
  }

  get(id: string): OptimizedPromptRecord | undefined {
    const row = this.db
      .prepare(`SELECT * FROM optimized_prompts WHERE id = ?`)
      .get(id) as PromptRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  query(filter: OptimizedPromptFilter = {}): OptimizedPromptRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.componentType) {
      conditions.push('component_type = ?');
      params.push(filter.componentType);
    }
    if (filter.componentName) {
      conditions.push('component_name = ?');
      params.push(filter.componentName);
    }
    if (filter.botId) {
      conditions.push('bot_id = ?');
      params.push(filter.botId);
    }
    if (filter.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter.optimizedForModel) {
      conditions.push('optimized_for_model = ?');
      params.push(filter.optimizedForModel);
    }

    let sql = 'SELECT * FROM optimized_prompts';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY score DESC, created_at DESC';
    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as PromptRow[];
    return rows.map(mapRow);
  }

  updateStatus(id: string, status: OptimizedPromptStatus, approvedBy?: string): void {
    if (status === 'approved' || status === 'active') {
      this.db
        .prepare(
          `UPDATE optimized_prompts SET status = ?, approved_by = ?, approved_at = datetime('now') WHERE id = ?`,
        )
        .run(status, approvedBy ?? null, id);
    } else {
      this.db
        .prepare(`UPDATE optimized_prompts SET status = ? WHERE id = ?`)
        .run(status, id);
    }
  }

  updateRollingScore(id: string, score: number): void {
    this.db
      .prepare(`UPDATE optimized_prompts SET rolling_score = ? WHERE id = ?`)
      .run(score, id);
  }

  getActive(
    componentType: OptimizedPromptComponentType,
    componentName: string,
    botId?: string,
  ): OptimizedPromptRecord | undefined {
    const sql = botId
      ? `SELECT * FROM optimized_prompts WHERE component_type = ? AND component_name = ? AND bot_id = ? AND status = 'active' ORDER BY score DESC LIMIT 1`
      : `SELECT * FROM optimized_prompts WHERE component_type = ? AND component_name = ? AND bot_id IS NULL AND status = 'active' ORDER BY score DESC LIMIT 1`;

    const params = botId
      ? [componentType, componentName, botId]
      : [componentType, componentName];

    const row = this.db.prepare(sql).get(...params) as PromptRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  deleteOlderThan(days: number): number {
    if (days <= 0) {
      return this.db
        .prepare(`DELETE FROM optimized_prompts WHERE status NOT IN ('active', 'approved')`)
        .run().changes;
    }
    return this.db
      .prepare(`DELETE FROM optimized_prompts WHERE created_at < datetime('now', ?) AND status NOT IN ('active', 'approved')`)
      .run(`-${days} days`).changes;
  }
}

interface PromptRow {
  id: string;
  component_type: string;
  component_name: string;
  bot_id: string | null;
  original_prompt: string;
  optimized_prompt: string;
  score: number;
  score_improvement: number;
  pareto_rank: number;
  evolution_depth: number;
  parent_id: string | null;
  reflection_log: string;
  optimized_for_model: string;
  status: string;
  rolling_score: number | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
}

function mapRow(row: PromptRow): OptimizedPromptRecord {
  return {
    id: row.id,
    componentType: row.component_type as OptimizedPromptComponentType,
    componentName: row.component_name,
    botId: row.bot_id,
    originalPrompt: row.original_prompt,
    optimizedPrompt: row.optimized_prompt,
    score: row.score,
    scoreImprovement: row.score_improvement,
    paretoRank: row.pareto_rank,
    evolutionDepth: row.evolution_depth,
    parentId: row.parent_id,
    reflectionLog: row.reflection_log,
    optimizedForModel: row.optimized_for_model,
    status: row.status as OptimizedPromptStatus,
    rollingScore: row.rolling_score,
    createdAt: row.created_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
  };
}
