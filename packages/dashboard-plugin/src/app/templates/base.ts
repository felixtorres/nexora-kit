/**
 * Base HTML shell for generated dashboard apps.
 *
 * Assembles the final HTML document from CSS, widget HTML, runtime JS,
 * and control HTML fragments.
 */

import { escapeHtml } from '../escaper.js';

export interface HtmlShellOptions {
  title: string;
  description?: string;
  css: string;
  widgetHtml: string;
  runtimeJs: string;
  controlsHtml: string;
  theme: 'light' | 'dark' | 'auto';
  /** Serialized AppDefinition JSON — embedded for refresh/extraction. */
  definitionJson?: string;
}

export function buildHtmlShell(options: HtmlShellOptions): string {
  const { title, description, css, widgetHtml, runtimeJs, controlsHtml, theme, definitionJson } = options;
  const initialTheme = theme === 'auto' ? 'auto' : theme;

  return `<!DOCTYPE html>
<html lang="en" data-theme="${initialTheme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data: blob:;">
  <title>${escapeHtml(title)}</title>
  <script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"><\/script>
  <style>${css}</style>
</head>
<body>
  <div class="app-container">
    <header class="dashboard-header">
      <h1>${escapeHtml(title)}</h1>
      ${description ? `<p style="color:var(--text-secondary);font-size:0.875rem">${escapeHtml(description)}</p>` : ''}
      <div class="dashboard-controls">${controlsHtml}</div>
    </header>
    <script>window.__charts={};window.__widgets={};</script>
    <main class="dashboard-grid">
      ${widgetHtml}
    </main>
  </div>
  ${definitionJson ? `<script type="application/json" id="__APP_DEFINITION__">${definitionJson}<\/script>` : ''}
  <script>${runtimeJs}</script>
</body>
</html>`;
}
