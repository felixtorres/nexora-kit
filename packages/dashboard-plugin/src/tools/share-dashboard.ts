/**
 * dashboard_share tool handler.
 *
 * Creates a share link for a standalone dashboard.
 * The token grants read-only access to the dashboard and its data.
 */

import type { ToolHandler, ToolHandlerResponse } from '@nexora-kit/core';
import type { DashboardStoreInterface } from '../store/types.js';

export function createShareDashboardHandler(store: DashboardStoreInterface, publicUrl?: string): ToolHandler {
  return async (input): Promise<string | ToolHandlerResponse> => {
    const dashboardId = input.dashboardId as string;
    const expiresIn = input.expiresInHours as number | undefined;

    if (!dashboardId) {
      return 'Error: dashboardId is required';
    }

    const dashboard = await store.get(dashboardId);
    if (!dashboard) {
      return `Error: dashboard '${dashboardId}' not found. Only standalone dashboards can be shared — use dashboard_promote first.`;
    }

    const expiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 60 * 60 * 1000).toISOString()
      : undefined;

    const share = await store.createShare(dashboardId, expiresAt);

    return {
      content: [
        `Share link created for "${dashboard.title}".`,
        `URL: ${publicUrl ?? ''}/shared/dashboards/${share.token}`,
        expiresAt ? `Expires: ${expiresAt}` : 'No expiration.',
        '',
        'Anyone with this link can view the dashboard — no login required.',
      ].join('\n'),
      blocks: [{
        type: 'custom:dashboard/share' as const,
        data: {
          dashboardId,
          shareId: share.id,
          token: share.token,
          permissions: share.permissions,
          expiresAt: share.expiresAt,
        },
      }],
    };
  };
}
