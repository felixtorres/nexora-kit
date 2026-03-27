/**
 * CSS stylesheet generator for dashboard apps.
 *
 * Produces theme variables (light + dark), grid layout, widget card styles,
 * responsive breakpoints, and typography.
 */

import type { AppLayout } from '../types.js';
import { DEFAULT_APP_LAYOUT } from '../types.js';

export function buildStylesheet(layout?: Partial<AppLayout>): string {
  const l = { ...DEFAULT_APP_LAYOUT, ...layout };
  const cols = l.columns ?? DEFAULT_APP_LAYOUT.columns;

  return `
/* --- Theme variables --- */
:root, [data-theme="light"] {
  --bg-primary: #ffffff;
  --bg-card: #ffffff;
  --bg-hover: #f8fafc;
  --text-primary: #0f172a;
  --text-secondary: #64748b;
  --text-muted: #94a3b8;
  --border: #e2e8f0;
  --accent: #3b82f6;
  --success: #22c55e;
  --danger: #ef4444;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.08);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.12);
  --chart-colors: #3b82f6,#8b5cf6,#ec4899,#f59e0b,#10b981,#06b6d4,#f43f5e,#6366f1;
}

[data-theme="dark"] {
  --bg-primary: #0f172a;
  --bg-card: #1e293b;
  --bg-hover: #334155;
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --border: #334155;
  --accent: #60a5fa;
  --success: #4ade80;
  --danger: #f87171;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.4);
  --chart-colors: #60a5fa,#a78bfa,#f472b6,#fbbf24,#34d399,#22d3ee,#fb7185,#818cf8;
}

/* --- Base reset --- */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* --- Dashboard layout --- */
.app-container {
  max-width: ${l.maxWidth ?? '1400px'};
  margin: 0 auto;
  padding: ${l.padding}px;
}

.dashboard-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${l.gap}px;
  flex-wrap: wrap;
  gap: 12px;
}

.dashboard-header h1 {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
}

.dashboard-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(${cols.desktop}, 1fr);
  gap: ${l.gap}px;
}

@media (max-width: 1024px) {
  .dashboard-grid { grid-template-columns: repeat(${cols.tablet}, 1fr); }
  .app-container { padding: 16px; }
}

@media (max-width: 640px) {
  .dashboard-grid { grid-template-columns: 1fr; }
  .app-container { padding: 12px; }
  .widget-card { grid-column: 1 / -1 !important; }
}

/* --- Widget card --- */
.widget-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
  box-shadow: var(--shadow-sm);
  transition: box-shadow 0.2s ease, transform 0.2s ease;
  overflow: hidden;
}
.widget-card:hover {
  box-shadow: var(--shadow-md);
  transform: scale(1.002);
}

.widget-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.widget-title {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.widget-actions { display: flex; gap: 4px; }

.chart-container { width: 100%; min-height: 250px; }

/* --- KPI card --- */
.kpi-value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}
.kpi-label {
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.kpi-delta {
  font-size: 0.75rem;
  font-weight: 500;
  margin-top: 4px;
}
.kpi-delta.up { color: var(--success); }
.kpi-delta.down { color: var(--danger); }
.kpi-delta.flat { color: var(--text-muted); }
.kpi-sparkline { width: 100%; height: 40px; margin-top: 8px; }

/* --- Stat widget --- */
.stat-value {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
}
.stat-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
}
.stat-trend {
  font-size: 0.75rem;
  font-weight: 500;
  margin-top: 2px;
}

/* --- Table widget --- */
.widget-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}
.widget-table thead th {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-secondary);
  text-align: left;
  padding: 8px 12px;
  border-bottom: 2px solid var(--border);
  position: sticky;
  top: 0;
  background: var(--bg-card);
  cursor: default;
}
.widget-table thead th.sortable { cursor: pointer; }
.widget-table thead th.sortable:hover { color: var(--accent); }
.widget-table tbody tr { border-bottom: 1px solid var(--border); }
.widget-table tbody tr:hover { background: var(--bg-hover); }
.widget-table tbody td { padding: 8px 12px; }
.table-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  font-size: 0.75rem;
  color: var(--text-secondary);
}
.table-pagination { display: flex; gap: 4px; }
.table-pagination button {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-card);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 0.75rem;
}
.table-pagination button.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

/* --- Metric card --- */
.metric-card-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
}
.metric-sparkline { width: 100%; height: 40px; margin-top: 8px; }

/* --- Gauge --- */
.gauge-container { width: 100%; min-height: 200px; }

/* --- Text widget --- */
.text-content {
  font-size: 0.875rem;
  color: var(--text-primary);
  line-height: 1.6;
}

/* --- Buttons --- */
.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.8125rem;
  transition: all 0.15s ease;
}
.btn-icon:hover { color: var(--accent); border-color: var(--accent); }

.btn-sm {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.75rem;
  transition: all 0.15s ease;
}
.btn-sm:hover { color: var(--accent); border-color: var(--accent); }

/* --- Table search --- */
.table-search {
  font-size: 0.75rem;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-card);
  color: var(--text-primary);
  width: 140px;
  outline: none;
}
.table-search:focus { border-color: var(--accent); }

/* --- Control group --- */
.control-group { display: flex; align-items: center; gap: 6px; }
.control-label { font-size: 0.75rem; color: var(--text-secondary); white-space: nowrap; }
.control-input {
  font-size: 0.75rem;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-card);
  color: var(--text-primary);
}
`;
}
