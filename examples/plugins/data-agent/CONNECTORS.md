# Data Agent — MCP Tools Reference

Tools provided by the `dbinsight` MCP server (`db-insight-graph`).

## Schema Discovery

- **describe_table** — Get detailed table info: columns, types, constraints, sample rows
- **generate_context** — Build focused schema context for a question or topic
- **explore_graph** — Navigate the relationship graph: `relationships`, `related_tables`, `find_paths`
- **scan_database** — Scan/refresh the metadata graph (requires `confirmed: true`)
- **refresh_snapshot** — Refresh the cached schema snapshot

## Analysis

- **match_patterns** — Discover naming conventions, structural patterns across tables
- **verify_insights** — Validate insights against actual data with confidence scores
- **get_workload_stats** — Query execution statistics from pg_stat_statements

## Search

- **semantic_search** — Find tables/columns by meaning, not just name
- **query_history_search** — Search past query executions
- **glossary_lookup** — Look up business terms in the domain glossary

## Execution

- **sql_execute** — Run SQL queries with safety guardrails (read_only, max_rows, rate limits)
- **cache_control** — Manage the metadata cache: `stats`, `clear`, `refresh`

## Insights

- **get_schema_context** — Get schema summary, fingerprint hash, and analysis metadata
- **submit_insights** — Submit LLM-generated insights about database patterns
- **verification_history** — View past insight verification results
