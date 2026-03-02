/**
 * Minimal pg.Pool interface for compile-time safety without requiring the pg package.
 * At runtime, the actual pg.Pool from 'pg' is used.
 */
export interface PgPool {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number }>;
  end(): Promise<void>;
}
