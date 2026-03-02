/**
 * PostgreSQL DDL for NexoraKit storage.
 * Uses TIMESTAMPTZ, JSONB, and SERIAL for production-grade storage.
 */

export const PG_TABLES = [
  `CREATE TABLE IF NOT EXISTS messages (
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content JSONB NOT NULL,
    seq INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (session_id, seq)
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    plugin_namespaces JSONB NOT NULL DEFAULT '[]',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS config_entries (
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    layer INTEGER NOT NULL,
    plugin_namespace TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL DEFAULT '',
    UNIQUE (key, layer, plugin_namespace, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS plugin_states (
    namespace TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    version TEXT NOT NULL,
    error TEXT,
    installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS token_usage (
    plugin_namespace TEXT PRIMARY KEY,
    used INTEGER NOT NULL DEFAULT 0,
    limit_val INTEGER NOT NULL,
    period_start TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS usage_events (
    id SERIAL PRIMARY KEY,
    plugin_name TEXT NOT NULL,
    user_id TEXT,
    model TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id SERIAL PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    result TEXT NOT NULL DEFAULT 'success',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
];

export async function initPgSchema(pool: { query(sql: string): Promise<unknown> }): Promise<void> {
  for (const sql of PG_TABLES) {
    await pool.query(sql);
  }
}
