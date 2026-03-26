/**
 * dashboard_list tool handler.
 *
 * Lists standalone dashboards for the current team.
 */

import type { ToolHandler, ToolHandlerResponse } from '@nexora-kit/core';
import type { DashboardStoreInterface } from '../store/types.js';

export function createListDashboardsHandler(store: DashboardStoreInterface): ToolHandler {
  return async (_input, context): Promise<string | ToolHandlerResponse> => {
    const teamId = context?.teamId ?? 'default';
    const dashboards = await store.list(teamId);

    if (dashboards.length === 0) {
      return 'No standalone dashboards found. Use dashboard_promote to save a dashboard from a conversation.';
    }

    const lines = ['Standalone dashboards:', ''];
    for (const d of dashboards) {
      const refresh = d.refreshInterval ? ` (auto-refresh: ${d.refreshInterval}s)` : '';
      const lastRefresh = d.lastRefreshedAt ? `, last refreshed: ${d.lastRefreshedAt}` : '';
      lines.push(`- **${d.title}** (id: \`${d.id}\`)${refresh}${lastRefresh}`);
    }

    return lines.join('\n');
  };
}
