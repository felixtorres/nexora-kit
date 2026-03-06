# Data Agent — MCP Tools Reference

Tools provided by the `dbinsight` MCP server (`db-insight-graph`).

## Tool Selection Guide

**Always start with these tools** — they work reliably without any setup:

1. **generate_context** — Your primary tool. Pass the user's question as `focus` and it returns relevant tables, columns, relationships, and context. Use this first for any schema or data question.
2. **describe_table** — When you know the table name (or `generate_context` returned one), use this to get full column details, types, constraints, and sample rows.
3. **explore_graph** — For relationship questions, use operations: `relationships`, `related_tables`, `find_paths`.

**Do NOT default to `semantic_search`** — it requires pre-generated embeddings (`dbinsight embed`) which may not exist. Use `generate_context` instead — it searches by schema metadata and always works. Only fall back to `semantic_search` if `generate_context` returns insufficient results and you suspect the user is searching by business meaning rather than technical names.

## Schema Discovery

- **generate_context** — Build focused schema context for a question or topic (preferred starting point)
- **describe_table** — Get detailed table info: columns, types, constraints, sample rows
- **explore_graph** — Navigate the relationship graph: `relationships`, `related_tables`, `find_paths`
- **scan_database** — Scan/refresh the metadata graph (requires `confirmed: true`)
- **refresh_snapshot** — Refresh the cached schema snapshot

## Analysis

- **match_patterns** — Discover naming conventions, structural patterns across tables
- **verify_insights** — Validate insights against actual data with confidence scores
- **get_workload_stats** — Query execution statistics from pg_stat_statements

## Search

- **semantic_search** — Find tables/columns by meaning, not just name (requires embeddings — run `dbinsight embed` first)
- **query_history_search** — Search past query executions
- **glossary_lookup** — Look up business terms in the domain glossary

## Execution

- **sql_execute** — Run SQL queries with safety guardrails (read_only, max_rows, rate limits)
- **cache_control** — Manage the metadata cache: `stats`, `clear`, `refresh`

## Insights

- **get_schema_context** — Get schema summary, fingerprint hash, and analysis metadata
- **submit_insights** — Submit LLM-generated insights about database patterns
- **verification_history** — View past insight verification results
