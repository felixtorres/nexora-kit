/**
 * dashboard_promote tool handler.
 *
 * Promotes a conversation-scoped dashboard (artifact) to a standalone dashboard
 * that outlives the conversation and can be shared.
 */

import type { ToolHandler, ToolHandlerResponse } from '@nexora-kit/core';
import type { DashboardStoreInterface } from '../store/types.js';
import { normalizeDashboardInput, parseDashboard } from '../widgets/dashboard-model.js';

export function createPromoteDashboardHandler(store: DashboardStoreInterface, publicUrl?: string): ToolHandler {
  return async (input, context): Promise<string | ToolHandlerResponse> => {
    const definition = input.definition as string;
    const title = input.title as string | undefined;

    if (!definition) {
      return 'Error: definition (dashboard JSON) is required';
    }

    let def;
    try {
      const rawJson = typeof definition === 'string' ? definition : JSON.stringify(definition);
      def = parseDashboard(normalizeDashboardInput(rawJson));
    } catch (error) {
      return `Error parsing dashboard: ${error instanceof Error ? error.message : String(error)}`;
    }

    const dashboard = await store.create({
      title: title ?? def.title,
      ownerId: context?.userId ?? 'unknown',
      teamId: context?.teamId ?? 'default',
      definition: typeof definition === 'string' ? definition : JSON.stringify(definition),
      refreshInterval: def.refreshInterval,
    });

    return {
      content: `Dashboard "${dashboard.title}" promoted to standalone (ID: ${dashboard.id}). It now persists independently of this conversation. Use dashboard_share to create a shareable link.`,
      blocks: [{
        type: 'custom:dashboard/info' as const,
        data: {
          dashboardId: dashboard.id,
          title: dashboard.title,
          status: 'standalone',
          createdAt: dashboard.createdAt,
        },
      }],
    };
  };
}
