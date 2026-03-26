/**
 * dashboard_promote tool handler.
 *
 * Promotes a conversation-scoped dashboard (artifact) to a standalone dashboard
 * that outlives the conversation and can be shared.
 */

import type { ToolHandler, ToolHandlerResponse } from '@nexora-kit/core';
import type { DashboardStoreInterface } from '../store/types.js';
import { parseDashboard } from '../widgets/dashboard-model.js';

export function createPromoteDashboardHandler(store: DashboardStoreInterface): ToolHandler {
  return async (input, context): Promise<string | ToolHandlerResponse> => {
    const definition = input.definition as string;
    const title = input.title as string | undefined;

    if (!definition) {
      return 'Error: definition (dashboard JSON) is required';
    }

    let def;
    try {
      def = parseDashboard(typeof definition === 'string' ? definition : JSON.stringify(definition));
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
      content: `Dashboard "${dashboard.title}" promoted to standalone (ID: ${dashboard.id}). It now persists independently of this conversation.`,
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
