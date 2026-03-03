import type Database from 'better-sqlite3';

const TABLES = [
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
    plugin_namespaces TEXT NOT NULL DEFAULT '[]',
    message_count INTEGER NOT NULL DEFAULT 0,
    last_message_at TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS messages (
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    seq INTEGER NOT NULL,
    bot_ids TEXT NOT NULL DEFAULT '[]',
    bot_responses TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (conversation_id, seq)
  )`,

  `CREATE TABLE IF NOT EXISTS config_entries (
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    layer INTEGER NOT NULL,
    plugin_namespace TEXT,
    user_id TEXT,
    UNIQUE (key, layer, plugin_namespace, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS plugin_states (
    namespace TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    version TEXT NOT NULL,
    error TEXT,
    installed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS token_usage (
    plugin_namespace TEXT PRIMARY KEY,
    used INTEGER NOT NULL DEFAULT 0,
    limit_val INTEGER NOT NULL,
    period_start TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plugin_name TEXT NOT NULL,
    user_id TEXT,
    model TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '{}',
    result TEXT NOT NULL DEFAULT 'success',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // --- Future-proof placeholder tables (F2-F11) ---

  `CREATE TABLE IF NOT EXISTS bots (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL,
    plugin_namespaces TEXT NOT NULL DEFAULT '[]',
    model TEXT NOT NULL,
    temperature REAL,
    max_turns INTEGER,
    workspace_id TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(team_id, name)
  )`,

  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    orchestration_strategy TEXT NOT NULL DEFAULT 'single',
    orchestrator_model TEXT,
    orchestrator_prompt TEXT,
    bot_id TEXT,
    fallback_bot_id TEXT,
    appearance TEXT NOT NULL DEFAULT '{}',
    end_user_auth TEXT NOT NULL DEFAULT '{}',
    rate_limits TEXT NOT NULL DEFAULT '{}',
    features TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(team_id, slug)
  )`,

  `CREATE TABLE IF NOT EXISTS agent_bot_bindings (
    agent_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    keywords TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (agent_id, bot_id)
  )`,

  `CREATE TABLE IF NOT EXISTS end_users (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    external_id TEXT,
    display_name TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT
  )`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_end_users_agent_external
    ON end_users(agent_id, external_id) WHERE external_id IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'document',
    language TEXT,
    current_version INTEGER NOT NULL DEFAULT 1,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_artifacts_conversation ON artifacts(conversation_id)`,

  `CREATE TABLE IF NOT EXISTS artifact_versions (
    artifact_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (artifact_id, version)
  )`,

  `CREATE TABLE IF NOT EXISTS conversation_templates (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    system_prompt TEXT,
    plugin_namespaces TEXT NOT NULL DEFAULT '[]',
    model TEXT,
    temperature REAL,
    max_turns INTEGER,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(team_id, name)
  )`,

  `CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    system_prompt TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS context_documents (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    token_count INTEGER NOT NULL DEFAULT 0,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    message_seq INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    rating TEXT NOT NULL CHECK (rating IN ('positive', 'negative')),
    comment TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    plugin_namespace TEXT,
    model TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(conversation_id, message_seq, user_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_feedback_conversation ON feedback(conversation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_plugin ON feedback(plugin_namespace)`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_rating ON feedback(rating, created_at)`,

  `CREATE TABLE IF NOT EXISTS user_memory (
    user_id TEXT NOT NULL,
    agent_id TEXT NOT NULL DEFAULT '',
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    namespace TEXT NOT NULL DEFAULT 'global',
    source TEXT NOT NULL DEFAULT 'plugin',
    plugin_namespace TEXT,
    confidence REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, agent_id, key)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_user_memory_user ON user_memory(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_user_memory_agent ON user_memory(agent_id)`,

  `CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

export function initSchema(db: Database.Database): void {
  const transaction = db.transaction(() => {
    for (const sql of TABLES) {
      db.exec(sql);
    }
  });
  transaction();
}
