/**
 * PostgreSQL DDL for NexoraKit storage.
 * Uses TIMESTAMPTZ, JSONB, and SERIAL for production-grade storage.
 */

export const PG_TABLES = [
  // --- Core tables ---

  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT,
    system_prompt TEXT,
    template_id TEXT,
    workspace_id TEXT,
    model TEXT,
    agent_id TEXT,
    plugin_namespaces JSONB NOT NULL DEFAULT '[]',
    message_count INTEGER NOT NULL DEFAULT 0,
    last_message_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
  )`,

  `CREATE TABLE IF NOT EXISTS messages (
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content JSONB NOT NULL,
    seq INTEGER NOT NULL,
    bot_ids JSONB NOT NULL DEFAULT '[]',
    bot_responses JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (conversation_id, seq)
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

  // --- Future-proof placeholder tables (F2-F11) ---

  `CREATE TABLE IF NOT EXISTS bots (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    system_prompt TEXT,
    plugin_namespaces JSONB NOT NULL DEFAULT '[]',
    model TEXT,
    config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    orchestration_strategy TEXT NOT NULL DEFAULT 'single',
    orchestrator_model TEXT,
    orchestrator_prompt TEXT,
    appearance JSONB NOT NULL DEFAULT '{}',
    auth_config JSONB NOT NULL DEFAULT '{}',
    rate_limit_config JSONB NOT NULL DEFAULT '{}',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS agent_bot_bindings (
    agent_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    config JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (agent_id, bot_id)
  )`,

  `CREATE TABLE IF NOT EXISTS end_users (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    external_id TEXT,
    display_name TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ
  )`,

  `CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    title TEXT NOT NULL,
    current_version INTEGER NOT NULL DEFAULT 1,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS artifact_versions (
    artifact_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (artifact_id, version)
  )`,

  `CREATE TABLE IF NOT EXISTS conversation_templates (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    name TEXT NOT NULL,
    system_prompt TEXT,
    plugin_namespaces JSONB NOT NULL DEFAULT '[]',
    model TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS context_documents (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS feedback (
    id SERIAL PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    message_seq INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    bot_id TEXT,
    rating INTEGER NOT NULL,
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS user_memory (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    namespace TEXT NOT NULL DEFAULT '',
    bot_id TEXT,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
];

export async function initPgSchema(pool: { query(sql: string): Promise<unknown> }): Promise<void> {
  for (const sql of PG_TABLES) {
    await pool.query(sql);
  }
}
