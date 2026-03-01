import { z } from 'zod';
import type { AdminService } from '@nexora-kit/admin';
import type { ApiRequest, ApiResponse } from './types.js';
import { ApiError, jsonResponse } from './router.js';

function requireAdmin(req: ApiRequest): void {
  if (!req.auth) throw new ApiError(401, 'Authentication required');
  if (req.auth.role !== 'admin') throw new ApiError(403, 'Admin access required', 'FORBIDDEN');
}

// --- POST /v1/admin/plugins/:name/enable ---

export function createAdminPluginEnableHandler(admin: AdminService) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);
    const namespace = req.params.name;

    try {
      admin.enablePlugin(req.auth!.userId, namespace);
      return jsonResponse(200, { status: 'enabled', namespace });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new ApiError(400, msg, 'PLUGIN_ERROR');
    }
  };
}

// --- POST /v1/admin/plugins/:name/disable ---

export function createAdminPluginDisableHandler(admin: AdminService) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);
    const namespace = req.params.name;

    try {
      admin.disablePlugin(req.auth!.userId, namespace);
      return jsonResponse(200, { status: 'disabled', namespace });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new ApiError(400, msg, 'PLUGIN_ERROR');
    }
  };
}

// --- DELETE /v1/admin/plugins/:name ---

export function createAdminPluginUninstallHandler(admin: AdminService) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);
    const namespace = req.params.name;

    try {
      admin.uninstallPlugin(req.auth!.userId, namespace);
      return jsonResponse(200, { status: 'uninstalled', namespace });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new ApiError(400, msg, 'PLUGIN_ERROR');
    }
  };
}

// --- GET /v1/admin/audit-log ---

const auditLogQuerySchema = z.object({
  actor: z.string().optional(),
  action: z.string().optional(),
  target: z.string().optional(),
  since: z.string().optional(),
  limit: z.string().transform(Number).pipe(z.number().int().positive()).optional(),
});

export function createAdminAuditLogHandler(admin: AdminService) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);

    const parsed = auditLogQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ApiError(400, 'Invalid query parameters', 'VALIDATION_ERROR');
    }

    const filter = {
      actor: parsed.data.actor,
      action: parsed.data.action,
      target: parsed.data.target,
      since: parsed.data.since,
      limit: parsed.data.limit,
    };

    const events = admin.auditLogger.query(filter);
    return jsonResponse(200, { events, count: events.length });
  };
}

// --- GET /v1/admin/usage ---

const usageQuerySchema = z.object({
  since: z.string().optional(),
  pluginName: z.string().optional(),
  userId: z.string().optional(),
  breakdown: z.enum(['plugin', 'daily']).optional(),
});

export function createAdminUsageHandler(admin: AdminService) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);

    const parsed = usageQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ApiError(400, 'Invalid query parameters', 'VALIDATION_ERROR');
    }

    const filter = {
      since: parsed.data.since,
      pluginName: parsed.data.pluginName,
      userId: parsed.data.userId,
    };

    if (parsed.data.breakdown === 'daily') {
      const daily = admin.usageAnalytics.dailyBreakdown(filter);
      return jsonResponse(200, { breakdown: 'daily', data: daily });
    }

    const summaries = admin.usageAnalytics.summarizeByPlugin(filter);
    const totalTokens = summaries.reduce((sum, s) => sum + s.totalTokens, 0);
    return jsonResponse(200, { breakdown: 'plugin', data: summaries, totalTokens });
  };
}

// --- POST /v1/admin/audit-log/purge ---

export function createAdminAuditPurgeHandler(admin: AdminService) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);

    const deleted = admin.purgeAuditLog();
    return jsonResponse(200, { deleted });
  };
}
