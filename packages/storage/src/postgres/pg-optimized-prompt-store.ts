import { randomUUID } from 'node:crypto';
import type {
  IOptimizedPromptStore,
  OptimizedPromptRecord,
  CreateOptimizedPromptInput,
  OptimizedPromptFilter,
  OptimizedPromptStatus,
  OptimizedPromptComponentType,
} from '../interfaces.js';
import type { PgPool } from './pg-pool.js';

export class PgOptimizedPromptStore implements IOptimizedPromptStore {
  constructor(private readonly pool: PgPool) {}

  async insert(prompt: CreateOptimizedPromptInput): Promise<string> {
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO optimized_prompts (id, component_type, component_name, bot_id, original_prompt, optimized_prompt, score, score_improvement, pareto_rank, evolution_depth, parent_id, reflection_log, optimized_for_model)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
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
      ],
    );
    return id;
  }

  async get(id: string): Promise<OptimizedPromptRecord | undefined> {
    const { rows } = await this.pool.query(
      `SELECT * FROM optimized_prompts WHERE id = $1`,
      [id],
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  }

  async query(filter: OptimizedPromptFilter = {}): Promise<OptimizedPromptRecord[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filter.componentType) {
      conditions.push(`component_type = $${idx++}`);
      params.push(filter.componentType);
    }
    if (filter.componentName) {
      conditions.push(`component_name = $${idx++}`);
      params.push(filter.componentName);
    }
    if (filter.botId) {
      conditions.push(`bot_id = $${idx++}`);
      params.push(filter.botId);
    }
    if (filter.status) {
      conditions.push(`status = $${idx++}`);
      params.push(filter.status);
    }
    if (filter.optimizedForModel) {
      conditions.push(`optimized_for_model = $${idx++}`);
      params.push(filter.optimizedForModel);
    }

    let sql = 'SELECT * FROM optimized_prompts';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY score DESC, created_at DESC';
    if (filter.limit) {
      sql += ` LIMIT $${idx++}`;
      params.push(filter.limit);
    }

    const { rows } = await this.pool.query(sql, params);
    return rows.map(mapRow);
  }

  async updateStatus(id: string, status: OptimizedPromptStatus, approvedBy?: string): Promise<void> {
    if (status === 'approved' || status === 'active') {
      await this.pool.query(
        `UPDATE optimized_prompts SET status = $1, approved_by = $2, approved_at = NOW() WHERE id = $3`,
        [status, approvedBy ?? null, id],
      );
    } else {
      await this.pool.query(
        `UPDATE optimized_prompts SET status = $1 WHERE id = $2`,
        [status, id],
      );
    }
  }

  async updateRollingScore(id: string, score: number): Promise<void> {
    await this.pool.query(
      `UPDATE optimized_prompts SET rolling_score = $1 WHERE id = $2`,
      [score, id],
    );
  }

  async getActive(
    componentType: OptimizedPromptComponentType,
    componentName: string,
    botId?: string,
  ): Promise<OptimizedPromptRecord | undefined> {
    const sql = botId
      ? `SELECT * FROM optimized_prompts WHERE component_type = $1 AND component_name = $2 AND bot_id = $3 AND status = 'active' ORDER BY score DESC LIMIT 1`
      : `SELECT * FROM optimized_prompts WHERE component_type = $1 AND component_name = $2 AND bot_id IS NULL AND status = 'active' ORDER BY score DESC LIMIT 1`;

    const params = botId
      ? [componentType, componentName, botId]
      : [componentType, componentName];

    const { rows } = await this.pool.query(sql, params);
    return rows[0] ? mapRow(rows[0]) : undefined;
  }

  async deleteOlderThan(days: number): Promise<number> {
    if (days <= 0) {
      const { rowCount } = await this.pool.query(
        `DELETE FROM optimized_prompts WHERE status NOT IN ('active', 'approved')`,
      );
      return rowCount ?? 0;
    }
    const { rowCount } = await this.pool.query(
      `DELETE FROM optimized_prompts WHERE created_at < NOW() - $1::interval AND status NOT IN ('active', 'approved')`,
      [`${days} days`],
    );
    return rowCount ?? 0;
  }
}

function mapRow(row: any): OptimizedPromptRecord {
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
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at?.toISOString?.() ?? row.approved_at,
  };
}
