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
    description TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL,
    plugin_namespaces JSONB NOT NULL DEFAULT '[]',
    model TEXT NOT NULL,
    temperature REAL,
    max_turns INTEGER,
    workspace_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
    appearance JSONB NOT NULL DEFAULT '{}',
    end_user_auth JSONB NOT NULL DEFAULT '{}',
    rate_limits JSONB NOT NULL DEFAULT '{}',
    features JSONB NOT NULL DEFAULT '{}',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(team_id, slug)
  )`,

  `CREATE TABLE IF NOT EXISTS agent_bot_bindings (
    agent_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    keywords JSONB NOT NULL DEFAULT '[]',
    PRIMARY KEY (agent_id, bot_id)
  )`,

  `CREATE TABLE IF NOT EXISTS end_users (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    external_id TEXT,
    display_name TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ
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
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_artifacts_conversation ON artifacts(conversation_id)`,

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
    description TEXT NOT NULL DEFAULT '',
    system_prompt TEXT,
    plugin_namespaces JSONB NOT NULL DEFAULT '[]',
    model TEXT,
    temperature REAL,
    max_turns INTEGER,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(team_id, name)
  )`,

  `CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    system_prompt TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS context_documents (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    token_count INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    message_seq INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    rating TEXT NOT NULL CHECK (rating IN ('positive', 'negative')),
    comment TEXT,
    tags JSONB NOT NULL DEFAULT '[]',
    plugin_namespace TEXT,
    model TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // --- GEPA Optimizer tables ---

  `CREATE TABLE IF NOT EXISTS execution_traces (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    skill_name TEXT,
    bot_id TEXT,
    model TEXT,
    prompt TEXT NOT NULL,
    tool_calls JSONB NOT NULL DEFAULT '[]',
    retrieved_docs JSONB NOT NULL DEFAULT '[]',
    agent_reasoning TEXT,
    final_answer TEXT NOT NULL,
    score REAL,
    score_feedback TEXT,
    user_feedback TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_execution_traces_conversation ON execution_traces(conversation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_execution_traces_skill ON execution_traces(skill_name)`,
  `CREATE INDEX IF NOT EXISTS idx_execution_traces_bot ON execution_traces(bot_id)`,
  `CREATE INDEX IF NOT EXISTS idx_execution_traces_score ON execution_traces(score)`,

  `CREATE TABLE IF NOT EXISTS optimized_prompts (
    id TEXT PRIMARY KEY,
    component_type TEXT NOT NULL CHECK (component_type IN ('skill', 'tool_description', 'system_prompt', 'compaction')),
    component_name TEXT NOT NULL,
    bot_id TEXT,
    original_prompt TEXT NOT NULL,
    optimized_prompt TEXT NOT NULL,
    score REAL NOT NULL,
    score_improvement REAL NOT NULL,
    pareto_rank INTEGER NOT NULL DEFAULT 0,
    evolution_depth INTEGER NOT NULL DEFAULT 0,
    parent_id TEXT,
    reflection_log TEXT NOT NULL,
    optimized_for_model TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'approved', 'active', 'unvalidated', 'rolled_back')),
    rolling_score REAL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_by TEXT,
    approved_at TIMESTAMPTZ
  )`,

  `CREATE INDEX IF NOT EXISTS idx_optimized_prompts_component ON optimized_prompts(component_type, component_name)`,
  `CREATE INDEX IF NOT EXISTS idx_optimized_prompts_status ON optimized_prompts(status)`,
  `CREATE INDEX IF NOT EXISTS idx_optimized_prompts_bot ON optimized_prompts(bot_id)`,
];

export async function initPgSchema(pool: { query(sql: string): Promise<unknown> }): Promise<void> {
  for (const sql of PG_TABLES) {
    await pool.query(sql);
  }
}
