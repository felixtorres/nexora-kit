/**
 * Built-in app templates for common dashboard use cases.
 *
 * Templates provide pre-built AppDefinition skeletons with placeholder queries.
 * The LLM fills in actual data source IDs and adapts SQL to the schema.
 */

import type { AppDefinition } from './types.js';
import { DEFAULT_APP_LAYOUT } from './types.js';

export interface AppTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  definition: AppDefinition;
}

export const APP_TEMPLATES: AppTemplate[] = [
  {
    id: 'sales-overview',
    name: 'Sales Overview',
    description: 'Revenue KPIs, trend charts, regional breakdown, and transaction table',
    category: 'business',
    definition: {
      title: 'Sales Overview',
      theme: 'light',
      layout: DEFAULT_APP_LAYOUT,
      controls: [
        { type: 'theme-toggle' },
        { type: 'date-range', field: 'date' },
        { type: 'export', formats: ['png', 'csv'] },
      ],
      widgets: [
        {
          id: 'kpi-revenue', type: 'kpi', title: 'Total Revenue',
          valueField: 'revenue', format: 'currency',
          query: { dataSourceId: '', sql: 'SELECT SUM(amount) AS revenue FROM orders' },
          size: { col: 1, row: 1, width: 3, height: 2 },
        },
        {
          id: 'kpi-orders', type: 'kpi', title: 'Total Orders',
          valueField: 'order_count', format: 'number',
          query: { dataSourceId: '', sql: 'SELECT COUNT(*) AS order_count FROM orders' },
          size: { col: 4, row: 1, width: 3, height: 2 },
        },
        {
          id: 'kpi-aov', type: 'kpi', title: 'Avg Order Value',
          valueField: 'aov', format: 'currency',
          query: { dataSourceId: '', sql: 'SELECT AVG(amount) AS aov FROM orders' },
          size: { col: 7, row: 1, width: 3, height: 2 },
        },
        {
          id: 'chart-trend', type: 'chart', chartType: 'area', title: 'Revenue Trend',
          config: {
            xAxis: { type: 'time' },
            yAxis: { type: 'value' },
            series: [{ type: 'line', areaStyle: { opacity: 0.3 }, smooth: true }],
            tooltip: { trigger: 'axis' },
            dataZoom: [{ type: 'inside' }, { type: 'slider' }],
          },
          query: { dataSourceId: '', sql: 'SELECT date, SUM(amount) AS revenue FROM orders GROUP BY date ORDER BY date' },
          size: { col: 1, row: 3, width: 8, height: 4 },
        },
        {
          id: 'chart-region', type: 'chart', chartType: 'bar', title: 'Revenue by Region',
          config: {
            xAxis: { type: 'category' },
            yAxis: { type: 'value' },
            series: [{ type: 'bar', encode: { x: 'region', y: 'revenue' } }],
            tooltip: { trigger: 'axis' },
          },
          query: { dataSourceId: '', sql: 'SELECT region, SUM(amount) AS revenue FROM orders GROUP BY region ORDER BY revenue DESC' },
          size: { col: 9, row: 3, width: 4, height: 4 },
        },
        {
          id: 'table-orders', type: 'table', title: 'Recent Orders',
          columns: [
            { key: 'date', label: 'Date' },
            { key: 'customer', label: 'Customer' },
            { key: 'amount', label: 'Amount' },
            { key: 'region', label: 'Region' },
          ],
          sortable: true, searchable: true, pageSize: 15,
          query: { dataSourceId: '', sql: 'SELECT date, customer, amount, region FROM orders ORDER BY date DESC LIMIT 100' },
          size: { col: 1, row: 7, width: 12, height: 5 },
        },
      ],
    },
  },
  {
    id: 'ops-metrics',
    name: 'Operations Metrics',
    description: 'Uptime gauge, error rates, latency charts, and incident table',
    category: 'engineering',
    definition: {
      title: 'Operations Metrics',
      theme: 'dark',
      layout: DEFAULT_APP_LAYOUT,
      controls: [
        { type: 'theme-toggle' },
        { type: 'date-range', field: 'timestamp' },
        { type: 'export', formats: ['png'] },
      ],
      widgets: [
        {
          id: 'gauge-uptime', type: 'gauge', title: 'Uptime',
          valueField: 'uptime', min: 0, max: 100,
          thresholds: [{ value: 95, color: '#ef4444' }, { value: 99, color: '#f59e0b' }, { value: 100, color: '#22c55e' }],
          query: { dataSourceId: '', sql: 'SELECT uptime_pct AS uptime FROM system_health ORDER BY timestamp DESC LIMIT 1' },
          size: { col: 1, row: 1, width: 3, height: 3 },
        },
        {
          id: 'kpi-errors', type: 'kpi', title: 'Error Rate (24h)',
          valueField: 'error_rate', format: 'percent',
          query: { dataSourceId: '', sql: "SELECT error_rate FROM system_health WHERE timestamp > NOW() - INTERVAL '24 hours' ORDER BY timestamp DESC LIMIT 1" },
          size: { col: 4, row: 1, width: 3, height: 2 },
        },
        {
          id: 'kpi-latency', type: 'kpi', title: 'P95 Latency (ms)',
          valueField: 'p95_ms', format: 'number',
          query: { dataSourceId: '', sql: "SELECT p95_ms FROM system_health WHERE timestamp > NOW() - INTERVAL '24 hours' ORDER BY timestamp DESC LIMIT 1" },
          size: { col: 7, row: 1, width: 3, height: 2 },
        },
        {
          id: 'chart-errors', type: 'chart', chartType: 'area', title: 'Error Rate Over Time',
          config: {
            xAxis: { type: 'time' },
            yAxis: { type: 'value', name: 'Error %' },
            series: [{ type: 'line', areaStyle: { opacity: 0.4, color: '#ef4444' }, lineStyle: { color: '#ef4444' } }],
            tooltip: { trigger: 'axis' },
          },
          query: { dataSourceId: '', sql: 'SELECT timestamp, error_rate FROM system_health ORDER BY timestamp' },
          size: { col: 1, row: 4, width: 6, height: 4 },
        },
        {
          id: 'chart-latency', type: 'chart', chartType: 'line', title: 'Latency Trend',
          config: {
            xAxis: { type: 'time' },
            yAxis: { type: 'value', name: 'ms' },
            series: [{ type: 'line', smooth: true }],
            tooltip: { trigger: 'axis' },
            dataZoom: [{ type: 'inside' }],
          },
          query: { dataSourceId: '', sql: 'SELECT timestamp, p95_ms FROM system_health ORDER BY timestamp' },
          size: { col: 7, row: 4, width: 6, height: 4 },
        },
      ],
    },
  },
  {
    id: 'user-analytics',
    name: 'User Analytics',
    description: 'DAU/MAU KPIs, signup trends, retention cohort heatmap',
    category: 'product',
    definition: {
      title: 'User Analytics',
      theme: 'light',
      layout: DEFAULT_APP_LAYOUT,
      controls: [
        { type: 'theme-toggle' },
        { type: 'date-range', field: 'date' },
      ],
      widgets: [
        {
          id: 'kpi-dau', type: 'kpi', title: 'Daily Active Users',
          valueField: 'dau', format: 'number',
          query: { dataSourceId: '', sql: "SELECT COUNT(DISTINCT user_id) AS dau FROM events WHERE date = CURRENT_DATE" },
          size: { col: 1, row: 1, width: 3, height: 2 },
        },
        {
          id: 'kpi-signups', type: 'kpi', title: 'New Signups (7d)',
          valueField: 'signups', format: 'number',
          query: { dataSourceId: '', sql: "SELECT COUNT(*) AS signups FROM users WHERE created_at > NOW() - INTERVAL '7 days'" },
          size: { col: 4, row: 1, width: 3, height: 2 },
        },
        {
          id: 'chart-signups', type: 'chart', chartType: 'bar', title: 'Signup Trend',
          config: {
            xAxis: { type: 'category' },
            yAxis: { type: 'value' },
            series: [{ type: 'bar', encode: { x: 'date', y: 'count' } }],
            tooltip: { trigger: 'axis' },
          },
          query: { dataSourceId: '', sql: "SELECT DATE(created_at) AS date, COUNT(*) AS count FROM users WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY date" },
          size: { col: 1, row: 3, width: 6, height: 4 },
        },
        {
          id: 'chart-retention', type: 'chart', chartType: 'heatmap', title: 'Retention by Cohort',
          config: {
            xAxis: { type: 'category' },
            yAxis: { type: 'category' },
            visualMap: { min: 0, max: 100, calculable: true },
            series: [{ type: 'heatmap', label: { show: true, formatter: '{c}%' } }],
            tooltip: {},
          },
          query: { dataSourceId: '', sql: 'SELECT cohort_week, retention_week, retention_pct FROM retention_cohorts ORDER BY cohort_week, retention_week' },
          size: { col: 7, row: 3, width: 6, height: 4 },
        },
      ],
    },
  },
  {
    id: 'financial',
    name: 'Financial Dashboard',
    description: 'Candlestick chart, portfolio KPIs, market metrics, transaction history',
    category: 'finance',
    definition: {
      title: 'Financial Dashboard',
      theme: 'dark',
      layout: DEFAULT_APP_LAYOUT,
      controls: [
        { type: 'theme-toggle' },
        { type: 'date-range', field: 'date' },
        { type: 'export', formats: ['png', 'csv'] },
      ],
      widgets: [
        {
          id: 'kpi-price', type: 'kpi', title: 'Current Price',
          valueField: 'price', format: 'currency',
          query: { dataSourceId: '', sql: 'SELECT close AS price FROM ohlcv ORDER BY date DESC LIMIT 1' },
          size: { col: 1, row: 1, width: 3, height: 2 },
        },
        {
          id: 'kpi-volume', type: 'kpi', title: 'Volume',
          valueField: 'volume', format: 'number',
          query: { dataSourceId: '', sql: 'SELECT volume FROM ohlcv ORDER BY date DESC LIMIT 1' },
          size: { col: 4, row: 1, width: 3, height: 2 },
        },
        {
          id: 'kpi-change', type: 'kpi', title: 'Daily Change',
          valueField: 'change_pct', format: 'percent',
          comparisonField: 'change_pct', comparisonLabel: 'vs prev close',
          query: { dataSourceId: '', sql: 'SELECT ((close - open) / open * 100) AS change_pct FROM ohlcv ORDER BY date DESC LIMIT 1' },
          size: { col: 7, row: 1, width: 3, height: 2 },
        },
        {
          id: 'chart-candle', type: 'chart', chartType: 'candlestick', title: 'Price Chart',
          config: {
            xAxis: { type: 'category' },
            yAxis: { type: 'value', scale: true },
            series: [{ type: 'candlestick', encode: { x: 'date', y: ['open', 'close', 'low', 'high'] } }],
            tooltip: { trigger: 'axis' },
            dataZoom: [{ type: 'inside' }, { type: 'slider' }],
          },
          query: { dataSourceId: '', sql: 'SELECT date, open, close, low, high FROM ohlcv ORDER BY date' },
          size: { col: 1, row: 3, width: 12, height: 5 },
        },
        {
          id: 'table-trades', type: 'table', title: 'Recent Trades',
          columns: [
            { key: 'date', label: 'Date' },
            { key: 'type', label: 'Type' },
            { key: 'quantity', label: 'Qty' },
            { key: 'price', label: 'Price' },
            { key: 'total', label: 'Total' },
          ],
          sortable: true, pageSize: 20,
          query: { dataSourceId: '', sql: 'SELECT date, type, quantity, price, (quantity * price) AS total FROM trades ORDER BY date DESC LIMIT 100' },
          size: { col: 1, row: 8, width: 12, height: 4 },
        },
      ],
    },
  },
];

export function getAppTemplate(id: string): AppTemplate | undefined {
  return APP_TEMPLATES.find(t => t.id === id);
}

export function listAppTemplates(): { id: string; name: string; description: string; category: string }[] {
  return APP_TEMPLATES.map(({ id, name, description, category }) => ({ id, name, description, category }));
}
