/**
 * Dashboard templates — pre-built layouts for common use cases.
 *
 * Templates are DashboardDefinition stubs with placeholder queries.
 * The LLM fills in actual data source IDs and SQL when instantiating.
 */

import type { DashboardDefinition } from '../widgets/dashboard-model.js';

export interface DashboardTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  definition: DashboardDefinition;
}

export const TEMPLATES: DashboardTemplate[] = [
  {
    id: 'sales-overview',
    name: 'Sales Overview',
    description: 'Revenue KPIs, sales by region bar chart, trend line, and recent orders table',
    category: 'sales',
    definition: {
      version: 1,
      title: 'Sales Overview',
      dataSources: [],
      widgets: [
        {
          id: 'kpi-revenue', type: 'kpi', title: 'Total Revenue',
          query: { dataSourceId: '', sql: 'SELECT SUM(revenue) AS value FROM orders' },
          valueField: 'value', format: 'currency',
          size: { col: 1, row: 1, width: 3, height: 1 },
        },
        {
          id: 'kpi-orders', type: 'kpi', title: 'Total Orders',
          query: { dataSourceId: '', sql: 'SELECT COUNT(*) AS value FROM orders' },
          valueField: 'value', format: 'number',
          size: { col: 4, row: 1, width: 3, height: 1 },
        },
        {
          id: 'kpi-avg', type: 'kpi', title: 'Avg Order Value',
          query: { dataSourceId: '', sql: 'SELECT AVG(revenue) AS value FROM orders' },
          valueField: 'value', format: 'currency',
          size: { col: 7, row: 1, width: 3, height: 1 },
        },
        {
          id: 'chart-by-region', type: 'chart', title: 'Revenue by Region',
          spec: {
            engine: 'vega-lite' as const,
            config: { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' }, color: { field: 'region', type: 'nominal' } } },
          },
          query: { dataSourceId: '', sql: 'SELECT region, SUM(revenue) AS revenue FROM orders GROUP BY region' },
          size: { col: 1, row: 2, width: 6, height: 3 },
        },
        {
          id: 'chart-trend', type: 'chart', title: 'Revenue Trend',
          spec: {
            engine: 'vega-lite' as const,
            config: { mark: 'line', encoding: { x: { field: 'month', type: 'temporal' }, y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' } } },
          },
          query: { dataSourceId: '', sql: 'SELECT date_trunc(\'month\', created_at) AS month, SUM(revenue) AS revenue FROM orders GROUP BY 1 ORDER BY 1' },
          size: { col: 7, row: 2, width: 6, height: 3 },
        },
        {
          id: 'table-recent', type: 'table', title: 'Recent Orders',
          query: { dataSourceId: '', sql: 'SELECT id, customer, revenue, created_at FROM orders ORDER BY created_at DESC LIMIT 20' },
          columns: [
            { key: 'id', label: 'Order ID' },
            { key: 'customer', label: 'Customer' },
            { key: 'revenue', label: 'Revenue', format: 'currency' },
            { key: 'created_at', label: 'Date' },
          ],
          pageSize: 10,
          size: { col: 1, row: 5, width: 12, height: 3 },
        },
      ],
      layout: { columns: 12, rowHeight: 80 },
    },
  },
  {
    id: 'ops-metrics',
    name: 'Operations Metrics',
    description: 'System health KPIs, error rate chart, latency heatmap, and alerts table',
    category: 'operations',
    definition: {
      version: 1,
      title: 'Operations Metrics',
      dataSources: [],
      widgets: [
        {
          id: 'kpi-uptime', type: 'kpi', title: 'Uptime',
          query: { dataSourceId: '', sql: 'SELECT uptime_percent AS value FROM system_health ORDER BY checked_at DESC LIMIT 1' },
          valueField: 'value', format: 'percent',
          size: { col: 1, row: 1, width: 3, height: 1 },
        },
        {
          id: 'kpi-errors', type: 'kpi', title: 'Error Rate (24h)',
          query: { dataSourceId: '', sql: 'SELECT error_rate AS value FROM system_health ORDER BY checked_at DESC LIMIT 1' },
          valueField: 'value', format: 'percent',
          size: { col: 4, row: 1, width: 3, height: 1 },
        },
        {
          id: 'kpi-latency', type: 'kpi', title: 'P95 Latency (ms)',
          query: { dataSourceId: '', sql: 'SELECT p95_latency_ms AS value FROM system_health ORDER BY checked_at DESC LIMIT 1' },
          valueField: 'value', format: 'number',
          size: { col: 7, row: 1, width: 3, height: 1 },
        },
        {
          id: 'chart-errors', type: 'chart', title: 'Error Rate Over Time',
          spec: {
            engine: 'vega-lite' as const,
            config: { mark: 'area', encoding: { x: { field: 'hour', type: 'temporal' }, y: { field: 'error_rate', type: 'quantitative' } } },
          },
          query: { dataSourceId: '', sql: 'SELECT date_trunc(\'hour\', ts) AS hour, AVG(error_rate) AS error_rate FROM system_health GROUP BY 1 ORDER BY 1' },
          size: { col: 1, row: 2, width: 6, height: 3 },
        },
        {
          id: 'chart-latency', type: 'chart', title: 'Latency Heatmap',
          spec: {
            engine: 'vega-lite' as const,
            config: { mark: 'rect', encoding: { x: { field: 'hour', type: 'ordinal' }, y: { field: 'endpoint', type: 'nominal' }, color: { field: 'p95_ms', type: 'quantitative' } } },
          },
          query: { dataSourceId: '', sql: 'SELECT extract(hour FROM ts) AS hour, endpoint, percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_ms FROM requests GROUP BY 1, 2' },
          size: { col: 7, row: 2, width: 6, height: 3 },
        },
      ],
      layout: { columns: 12, rowHeight: 80 },
    },
  },
  {
    id: 'user-analytics',
    name: 'User Analytics',
    description: 'Active users, signup trend, retention chart, and top users table',
    category: 'analytics',
    definition: {
      version: 1,
      title: 'User Analytics',
      dataSources: [],
      widgets: [
        {
          id: 'kpi-dau', type: 'kpi', title: 'Daily Active Users',
          query: { dataSourceId: '', sql: 'SELECT COUNT(DISTINCT user_id) AS value FROM events WHERE ts > NOW() - INTERVAL \'1 day\'' },
          valueField: 'value', format: 'number',
          size: { col: 1, row: 1, width: 4, height: 1 },
        },
        {
          id: 'kpi-signups', type: 'kpi', title: 'New Signups (7d)',
          query: { dataSourceId: '', sql: 'SELECT COUNT(*) AS value FROM users WHERE created_at > NOW() - INTERVAL \'7 days\'' },
          valueField: 'value', format: 'number',
          size: { col: 5, row: 1, width: 4, height: 1 },
        },
        {
          id: 'chart-signups', type: 'chart', title: 'Signup Trend',
          spec: {
            engine: 'vega-lite' as const,
            config: { mark: 'bar', encoding: { x: { field: 'day', type: 'temporal' }, y: { field: 'signups', type: 'quantitative' } } },
          },
          query: { dataSourceId: '', sql: 'SELECT date_trunc(\'day\', created_at) AS day, COUNT(*) AS signups FROM users GROUP BY 1 ORDER BY 1' },
          size: { col: 1, row: 2, width: 6, height: 3 },
        },
        {
          id: 'chart-retention', type: 'chart', title: 'Retention by Cohort',
          spec: {
            engine: 'vega-lite' as const,
            config: { mark: 'rect', encoding: { x: { field: 'week', type: 'ordinal' }, y: { field: 'cohort', type: 'ordinal' }, color: { field: 'retention', type: 'quantitative' } } },
          },
          query: { dataSourceId: '', sql: 'SELECT cohort_week AS cohort, week_number AS week, retention_rate AS retention FROM retention_matrix' },
          size: { col: 7, row: 2, width: 6, height: 3 },
        },
      ],
      layout: { columns: 12, rowHeight: 80 },
    },
  },
];

export function getTemplate(id: string): DashboardTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function listTemplates(): Pick<DashboardTemplate, 'id' | 'name' | 'description' | 'category'>[] {
  return TEMPLATES.map(({ id, name, description, category }) => ({ id, name, description, category }));
}
