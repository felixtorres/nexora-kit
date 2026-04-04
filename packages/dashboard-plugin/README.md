# @nexora-kit/dashboard-plugin

Interactive dashboards from chat — user asks a data question, the agent builds a dashboard.

## Modes

| Mode | Chart Engine | Output | Use Case |
|------|-------------|--------|----------|
| `classic` | Vega-Lite | JSON definition → frontend grid | Platform-rendered, cross-filtering |
| `app` | ECharts (20 types) | Self-contained HTML file | Standalone, shareable, zero dependencies |
| `both` (default) | Both | Both | Full flexibility |

## Quick Start

```typescript
import { createDashboardPlugin } from '@nexora-kit/dashboard-plugin';

const plugin = await createDashboardPlugin({
  mode: 'both',
  dataSources: [
    {
      id: 'prod_db',
      name: 'Production Database',
      type: 'sql',
      config: {
        dialect: 'postgresql',
        connectionString: process.env.DB_URL,
      },
      constraints: { maxRows: 10000, timeoutMs: 30000 },
    },
  ],
});

// plugin.toolHandlers — Map<string, ToolHandler> to register with the agent
// plugin.buildContext() — inject data source context into LLM prompt
// plugin.close() — cleanup connections
```

## Tools

### Shared (Both Modes)

| Tool | Description |
|------|-------------|
| `dashboard_list_sources` | Discover data sources — tables, columns, types, sample data |
| `dashboard_query` | Execute read-only SQL against a data source |
| `dashboard_list_standalone` | List promoted standalone dashboards |

### Classic Mode

| Tool | Description |
|------|-------------|
| `dashboard_create` | Create a dashboard from widget definitions (chart, kpi, table, filter) |
| `dashboard_update` | Add, update, or remove widgets |
| `dashboard_refresh` | Re-execute all widget queries with fresh data |
| `dashboard_apply_filter` | Apply filter constraints to widget queries |
| `dashboard_cross_filter` | Propagate filter selections across widgets |
| `dashboard_promote` | Save dashboard to persistent store |
| `dashboard_share` | Create a shareable token-based link |

### App Mode

| Tool | Description |
|------|-------------|
| `dashboard_app_create` | Generate a self-contained HTML/CSS/JS app with ECharts |
| `dashboard_app_refine` | Modify app — layout (r0), dashboard (r1), or widget (r2) refinement |
| `dashboard_app_promote` | Save HTML app to persistent store |
| `dashboard_app_share` | Create a shareable link for a standalone app |

## Data Sources

Four adapter types, all implementing `DataAdapter`:

### SQL (PostgreSQL)

```typescript
{
  id: 'my_db',
  type: 'sql',
  config: {
    dialect: 'postgresql',
    connectionString: 'postgresql://user:pass@host/db',
  },
  constraints: { maxRows: 10000, timeoutMs: 30000 },
}
```

Schema introspection via `information_schema`. Read-only transactions enforced. Column stats (distinct count, min/max) computed on demand.

### CSV

```typescript
{
  id: 'sales_csv',
  type: 'csv',
  config: {
    content: 'date,revenue,category\n2026-01-01,1234,widgets\n...',
    tableName: 'sales',
  },
  constraints: { maxRows: 100000, timeoutMs: 5000 },
}
```

Auto-detects column types from first 100 rows. In-memory storage.

### Tool-Backed

```typescript
{
  id: 'crm_data',
  type: 'tool',
  config: {
    queryTool: 'crm_query',
    schemaListTool: 'crm_list_tables',
    schemaTool: 'crm_describe_table',
    resultFormat: 'json',
  },
  constraints: { maxRows: 5000, timeoutMs: 15000 },
}
```

Delegates to other NexoraKit tools via `ToolDispatcher.invoke()`. Requires the `dispatcher` option.

### REST

```typescript
{
  id: 'analytics_api',
  type: 'rest',
  config: {
    baseUrl: 'https://api.example.com/v1',
    auth: { type: 'bearer', token: '${API_TOKEN}' },
    endpoints: [
      { name: 'users', path: '/users', resultPath: 'data.items' },
      { name: 'events', path: '/events/{{startDate}}/{{endDate}}' },
    ],
  },
  constraints: { maxRows: 10000, timeoutMs: 10000 },
}
```

Supports Bearer and API-key auth. URL parameter substitution via `{{param}}`.

## Query Validation

All queries pass through `QueryValidator` before execution:

- **Blocked:** INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE, GRANT, REVOKE, EXECUTE, CALL, COPY
- **Blocked constructs:** Multi-statement (`;`), `pg_sleep`, `dblink`, `LO_IMPORT/EXPORT`
- **Enforced:** Must be SELECT/WITH/VALUES. Row limits and timeouts per data source.
- **Optional:** `allowedTables` whitelist, `blockedColumns` blacklist

## App Generation

App mode produces zero-dependency HTML files (typically 100–500KB):

1. **Validate** — ECharts configs checked for valid chart types, no JS functions (security)
2. **Query** — All widget queries executed in parallel via `DataSourceRegistry`
3. **Generate** — Widget + control templates assembled with embedded data
4. **Bundle** — Single HTML file: responsive 12-column grid, dark/light themes, embedded ECharts

### Widget Types

| Type | Engine | Description |
|------|--------|-------------|
| `chart` | ECharts | Bar, line, area, pie, scatter, heatmap, treemap, gauge, etc. (20 types) |
| `kpi` | Custom | Single metric with optional comparison delta |
| `table` | Custom | Searchable, sortable, paginated data table |
| `stat` | Custom | Metric with trend arrow |
| `gauge` | ECharts | Radial progress indicator |
| `metric-card` | Custom | Card layout with mini sparkline |
| `text` | Custom | Markdown/HTML content block |

### Controls

Theme toggle, date range picker, dropdown filter, PNG/CSV export, fullscreen toggle.

### Refinement Levels

| Level | Name | What Changes | Re-queries |
|-------|------|-------------|-----------|
| r0 | Layout | Title, theme only | No |
| r1 | Dashboard | Add/remove widgets, full update | Yes (all) |
| r2 | Widget | Single widget modification | Yes (one) |

## Architecture

```
src/
├── app/                    # App mode generator + templates
│   ├── generator.ts        # AppDefinition + data → HTML
│   ├── escaper.ts          # XSS prevention
│   ├── types.ts            # AppDefinition, AppWidget, GeneratedApp
│   └── templates/          # Widget + control HTML/JS templates
├── chart/                  # Chart validation
│   ├── validator.ts        # Vega-Lite validation + normalization
│   └── echarts-validator.ts # ECharts validation (20 chart types)
├── context/                # LLM context injection
│   └── provider.ts         # buildDashboardContext() — schema + examples
├── data-sources/           # Data adapters
│   ├── registry.ts         # DataSourceRegistry (adapter lifecycle)
│   ├── sql-adapter.ts      # PostgreSQL (pg)
│   ├── csv-adapter.ts      # In-memory CSV
│   ├── tool-adapter.ts     # Tool-backed via ToolDispatcher
│   ├── rest-adapter.ts     # REST APIs
│   └── types.ts            # DataAdapter interface
├── query/                  # Query validation
│   └── validator.ts        # SQL safety checks
├── store/                  # Standalone dashboard persistence
│   ├── dashboard-store.ts  # InMemoryDashboardStore
│   └── refresh-scheduler.ts
├── tools/                  # Tool handlers (registered with agent)
│   ├── list-sources.ts, query.ts          # Shared
│   ├── create-dashboard.ts, update-*.ts   # Classic mode
│   └── app-create.ts, app-refine.ts       # App mode
└── widgets/                # Widget execution (classic mode)
    ├── kpi-handler.ts, table-handler.ts
    └── dashboard-model.ts
```
