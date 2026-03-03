import { z } from 'zod';
import type { IFeedbackStore } from '@nexora-kit/storage';
import type { ApiRequest, ApiResponse } from './types.js';
import { ApiError, jsonResponse } from './router.js';

export interface FeedbackHandlerDeps {
  feedbackStore: IFeedbackStore;
}

const submitFeedbackSchema = z.object({
  rating: z.enum(['positive', 'negative']),
  comment: z.string().max(2000).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
});

function requireAdmin(req: ApiRequest): void {
  if (!req.auth) throw new ApiError(401, 'Authentication required');
  if (req.auth.role !== 'admin') throw new ApiError(403, 'Admin access required', 'FORBIDDEN');
}

// --- POST /v1/conversations/:id/messages/:seq/feedback ---

export function createSubmitFeedbackHandler(deps: FeedbackHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const conversationId = req.params.id;
    const messageSeq = parseInt(req.params.seq, 10);
    if (isNaN(messageSeq) || messageSeq < 0) {
      throw new ApiError(400, 'Invalid message sequence number', 'VALIDATION_ERROR');
    }

    const parsed = submitFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, `Invalid request: ${parsed.error.issues[0].message}`, 'VALIDATION_ERROR');
    }

    const feedback = await deps.feedbackStore.submit({
      conversationId,
      messageSeq,
      userId: req.auth.userId,
      rating: parsed.data.rating,
      comment: parsed.data.comment,
      tags: parsed.data.tags,
    });

    return jsonResponse(200, feedback);
  };
}

// --- GET /v1/admin/feedback ---

const feedbackQuerySchema = z.object({
  pluginNamespace: z.string().optional(),
  rating: z.enum(['positive', 'negative']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.string().transform(Number).pipe(z.number().int().positive().max(100)).optional(),
});

export function createAdminFeedbackQueryHandler(deps: FeedbackHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);

    const parsed = feedbackQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ApiError(400, 'Invalid query parameters', 'VALIDATION_ERROR');
    }

    const result = await deps.feedbackStore.query({
      pluginNamespace: parsed.data.pluginNamespace,
      rating: parsed.data.rating,
      from: parsed.data.from,
      to: parsed.data.to,
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
    });

    return jsonResponse(200, result);
  };
}

// --- GET /v1/admin/feedback/summary ---

const feedbackSummaryQuerySchema = z.object({
  pluginNamespace: z.string().optional(),
  model: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export function createAdminFeedbackSummaryHandler(deps: FeedbackHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);

    const parsed = feedbackSummaryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ApiError(400, 'Invalid query parameters', 'VALIDATION_ERROR');
    }

    const summary = await deps.feedbackStore.summary({
      pluginNamespace: parsed.data.pluginNamespace,
      model: parsed.data.model,
      from: parsed.data.from,
      to: parsed.data.to,
    });

    return jsonResponse(200, summary);
  };
}
