/**
 * dashboard:app_promote tool handler.
 *
 * Promotes a generated dashboard app to a standalone dashboard
 * in the DashboardStore. The stored definition is the full HTML bundle.
 *
 * Accepts either:
 * - dashboardId: ID from app_create (already saved, this is a no-op confirmation)
 * - html + title: raw HTML content for manual promotion
 */

import type { ToolHandler, ToolHandlerResponse } from '@nexora-kit/core';
import type { DashboardStoreInterface } from '../store/types.js';

export function createAppPromoteHandler(store: DashboardStoreInterface, publicUrl?: string): ToolHandler {
  return async (input, context): Promise<string | ToolHandlerResponse> => {
    const dashboardId = input.dashboardId as string | undefined;
    const appHtml = input.html as string | undefined;
    const title = input.title as string | undefined;

    // Path 1: Already saved by app_create — just confirm it exists
    if (dashboardId) {
      const existing = await store.get(dashboardId);
      if (!existing) {
        return `Error: dashboard '${dashboardId}' not found. It may have been lost on server restart (in-memory store).`;
      }
      return {
        content: `Dashboard app "${existing.title}" is ready (ID: ${dashboardId}). Use dashboard_app_share with this ID to create a shareable link.`,
        blocks: [{
          type: 'custom:app/preview' as const,
          data: {
            appId: dashboardId,
            title: existing.title,
            standalone: true,
          },
        }],
      };
    }

    // Path 2: Raw HTML promotion (legacy / manual)
    if (!appHtml) return 'Error: either dashboardId or html is required';
    if (!title) return 'Error: title is required when promoting with html';

    const trimmed = appHtml.trimStart();
    if (!trimmed.startsWith('<!DOCTYPE') && !trimmed.startsWith('<html') && !trimmed.startsWith('<')) {
      return 'Error: html must be the generated HTML app content, not a title or artifact ID. Pass the full HTML string from the app_create artifact.';
    }

    const dashboard = await store.create({
      title,
      ownerId: context?.userId ?? 'unknown',
      teamId: context?.teamId ?? 'default',
      definition: appHtml,
    });

    return {
      content: `Dashboard app "${title}" promoted to standalone (ID: ${dashboard.id}). Use dashboard_app_share with this ID to create a shareable link.`,
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
