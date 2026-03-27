/**
 * dashboard:app_promote tool handler.
 *
 * Promotes a generated dashboard app (artifact) to a standalone dashboard
 * in the DashboardStore. The stored definition is the full HTML bundle.
 */

import type { ToolHandler, ToolHandlerResponse } from '@nexora-kit/core';
import type { DashboardStoreInterface } from '../store/types.js';

export function createAppPromoteHandler(store: DashboardStoreInterface): ToolHandler {
  return async (input, context): Promise<string | ToolHandlerResponse> => {
    const appHtml = input.html as string;
    const title = input.title as string;

    if (!appHtml) return 'Error: html (generated app content) is required';
    if (!title) return 'Error: title is required';

    const dashboard = await store.create({
      title,
      ownerId: context?.userId ?? 'unknown',
      teamId: context?.teamId ?? 'default',
      definition: appHtml,
    });

    return {
      content: `Dashboard app "${title}" promoted to standalone (ID: ${dashboard.id}). Accessible via /shared/dashboards/:token after sharing.`,
      blocks: [{
        type: 'custom:app/preview' as const,
        data: {
          appId: dashboard.id,
          title,
          standalone: true,
        },
      }],
    };
  };
}
