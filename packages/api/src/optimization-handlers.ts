import { z } from 'zod';
import type { AdminService } from '@nexora-kit/admin';
import type { ApiRequest, ApiResponse } from './types.js';
import { ApiError, jsonResponse } from './router.js';

function requireAdmin(req: ApiRequest): void {
  if (!req.auth) throw new ApiError(401, 'Authentication required');
  if (req.auth.role !== 'admin') throw new ApiError(403, 'Admin access required', 'FORBIDDEN');
}

// --- POST /v1/admin/optimize ---

const optimizeBodySchema = z.object({
  componentType: z.enum(['skill', 'tool_description', 'system_prompt', 'compaction']),
  componentName: z.string().min(1),
  botId: z.string().optional(),
  force: z.boolean().optional(),
});

export function createOptimizeTriggerHandler(admin: AdminService) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);

    const parsed = optimizeBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ApiError(400, `Invalid request: ${parsed.error.issues[0].message}`, 'VALIDATION_ERROR');
    }

    const { componentType, componentName, botId, force } = parsed.data;

    try {
      // Check readiness
      const readiness = await admin.getOptimizationReadiness(
        componentType,
        componentName,
        botId,
      );

      if (!readiness.ready && !force) {
        return jsonResponse(200, {
          status: 'not_ready',
          ...readiness,
          message: `Need at least ${readiness.minRequired} scored traces (have ${readiness.traceCount}) and 3 negative scores (have ${readiness.negativeCount}). Use force=true to override.`,
        });
      }

      // Run optimization synchronously — calls LLM, stores candidate
      const currentPrompt = (req.body as Record<string, unknown>).currentPrompt as string | undefined;
      const result = await admin.runOptimization(
        req.auth!.userId,
        componentType,
        componentName,
        currentPrompt ?? '',
        botId,
      );

      return jsonResponse(200, {
        status: 'completed',
        candidateId: result.candidateId,
        scoreImprovement: result.scoreImprovement,
        tracesAnalyzed: result.tracesAnalyzed,
        message: `Optimization complete. Review with GET /v1/admin/optimize/candidates or approve with POST .../candidates/${result.candidateId}/approve`,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('not configured')) {
        throw new ApiError(400, 'Optimization not enabled. Set optimization.enabled: true in nexora.yaml.', 'NOT_CONFIGURED');
      }
      throw new ApiError(400, msg, 'OPTIMIZATION_ERROR');
    }
  };
}

// --- GET /v1/admin/optimize/candidates ---

const candidatesQuerySchema = z.object({
  componentType: z.enum(['skill', 'tool_description', 'system_prompt', 'compaction']).optional(),
  componentName: z.string().optional(),
  botId: z.string().optional(),
  status: z.enum(['candidate', 'approved', 'active', 'unvalidated', 'rolled_back']).optional(),
  limit: z.string().transform(Number).pipe(z.number().int().positive()).optional(),
});

export function createOptimizeCandidatesHandler(admin: AdminService) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);

    const parsed = candidatesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ApiError(400, 'Invalid query parameters', 'VALIDATION_ERROR');
    }

    try {
      const candidates = await admin.listOptimizationCandidates(parsed.data);
      return jsonResponse(200, { candidates, count: candidates.length });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new ApiError(400, msg, 'OPTIMIZATION_ERROR');
    }
  };
}

// --- POST /v1/admin/optimize/candidates/:id/approve ---

export function createOptimizeApproveHandler(admin: AdminService) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);
    const promptId = req.params.id;

    try {
      await admin.approveOptimization(req.auth!.userId, promptId);
      return jsonResponse(200, { status: 'approved', promptId });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('not found')) {
        throw new ApiError(404, msg, 'NOT_FOUND');
      }
      throw new ApiError(400, msg, 'OPTIMIZATION_ERROR');
    }
  };
}

// --- POST /v1/admin/optimize/candidates/:id/rollback ---

export function createOptimizeRollbackHandler(admin: AdminService) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);
    const promptId = req.params.id;

    try {
      await admin.rollbackOptimization(req.auth!.userId, promptId);
      return jsonResponse(200, { status: 'rolled_back', promptId });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('not found')) {
        throw new ApiError(404, msg, 'NOT_FOUND');
      }
      throw new ApiError(400, msg, 'OPTIMIZATION_ERROR');
    }
  };
}
