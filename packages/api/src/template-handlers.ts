import { z } from 'zod';
import type { IConversationTemplateStore } from '@nexora-kit/storage';
import type { ApiRequest, ApiResponse } from './types.js';
import { ApiError, jsonResponse } from './router.js';

export interface TemplateHandlerDeps {
  templateStore: IConversationTemplateStore;
}

function requireAdmin(req: ApiRequest): void {
  if (!req.auth) throw new ApiError(401, 'Authentication required');
  if (req.auth.role !== 'admin') throw new ApiError(403, 'Admin access required', 'FORBIDDEN');
}

const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  systemPrompt: z.string().max(50_000).optional(),
  pluginNamespaces: z.array(z.string()).optional(),
  model: z.string().max(100).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTurns: z.number().int().min(1).max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  systemPrompt: z.string().max(50_000).nullable().optional(),
  pluginNamespaces: z.array(z.string()).optional(),
  model: z.string().max(100).nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  maxTurns: z.number().int().min(1).max(100).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// --- POST /v1/admin/templates ---

export function createTemplateCreateHandler(deps: TemplateHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);

    const parsed = createTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, `Invalid request: ${parsed.error.issues[0].message}`, 'VALIDATION_ERROR');
    }

    const template = await deps.templateStore.create({
      teamId: req.auth!.teamId,
      ...parsed.data,
    });

    return jsonResponse(201, template);
  };
}

// --- GET /v1/templates ---

export function createTemplateListHandler(deps: TemplateHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const templates = await deps.templateStore.list(req.auth.teamId);
    return jsonResponse(200, { templates });
  };
}

// --- GET /v1/templates/:id ---

export function createTemplateGetHandler(deps: TemplateHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const template = await deps.templateStore.get(req.params.id, req.auth.teamId);
    if (!template) throw new ApiError(404, 'Template not found');

    return jsonResponse(200, template);
  };
}

// --- PATCH /v1/admin/templates/:id ---

export function createTemplateUpdateHandler(deps: TemplateHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);

    const parsed = updateTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, `Invalid request: ${parsed.error.issues[0].message}`, 'VALIDATION_ERROR');
    }

    const updated = await deps.templateStore.update(req.params.id, req.auth!.teamId, parsed.data);
    if (!updated) throw new ApiError(404, 'Template not found');

    return jsonResponse(200, updated);
  };
}

// --- DELETE /v1/admin/templates/:id ---

export function createTemplateDeleteHandler(deps: TemplateHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    requireAdmin(req);

    const deleted = await deps.templateStore.delete(req.params.id, req.auth!.teamId);
    if (!deleted) throw new ApiError(404, 'Template not found');

    return jsonResponse(204, null);
  };
}
