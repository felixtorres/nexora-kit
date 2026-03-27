/**
 * dashboard:app_share tool handler.
 *
 * Creates a share link for a standalone dashboard app.
 * The shared URL serves the HTML bundle directly — no platform needed.
 */

import type { ToolHandler, ToolHandlerResponse } from '@nexora-kit/core';
import type { DashboardStoreInterface } from '../store/types.js';

export function createAppShareHandler(store: DashboardStoreInterface): ToolHandler {
  return async (input): Promise<string | ToolHandlerResponse> => {
    const dashboardId = input.dashboardId as string;
    const expiresIn = input.expiresInHours as number | undefined;

    if (!dashboardId) return 'Error: dashboardId is required';

    const dashboard = await store.get(dashboardId);
    if (!dashboard) {
      return `Error: dashboard '${dashboardId}' not found. Use app_promote first.`;
    }

    const expiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 60 * 60 * 1000).toISOString()
      : undefined;

    const share = await store.createShare(dashboardId, expiresAt);

    return {
      content: [
        `Share link created for "${dashboard.title}".`,
        `URL: /shared/dashboards/${share.token}`,
        expiresAt ? `Expires: ${expiresAt}` : 'No expiration.',
        '',
        'Anyone with this link can view the dashboard — no login required.',
      ].join('\n'),
    };
  };
}
