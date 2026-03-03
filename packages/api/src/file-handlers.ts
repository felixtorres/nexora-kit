import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { IFileStore, IConversationStore } from '@nexora-kit/storage';
import type { ApiRequest, ApiResponse } from './types.js';
import { ApiError, jsonResponse } from './router.js';

export interface FileHandlerDeps {
  fileStore: IFileStore;
  conversationStore?: IConversationStore;
  fileBasePath: string;
  maxFileSize?: number;
  allowedMimeTypes?: string[];
}

export interface FileBackend {
  write(path: string, data: Buffer): Promise<void>;
  read(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
}

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const DEFAULT_ALLOWED_TYPES = [
  'text/plain', 'text/markdown', 'text/csv', 'text/html',
  'application/json', 'application/pdf',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
];

const uploadSchema = z.object({
  conversationId: z.string().min(1),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  content: z.string().min(1), // base64
});

// --- POST /v1/files ---

export function createFileUploadHandler(deps: FileHandlerDeps, backend: FileBackend) {
  const maxSize = deps.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const allowedTypes = deps.allowedMimeTypes ?? DEFAULT_ALLOWED_TYPES;

  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const parsed = uploadSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, `Invalid request: ${parsed.error.issues[0].message}`, 'VALIDATION_ERROR');
    }

    const { conversationId, filename, mimeType, content } = parsed.data;

    // Validate MIME type
    if (!allowedTypes.includes(mimeType)) {
      throw new ApiError(400, `File type not allowed: ${mimeType}`, 'INVALID_FILE_TYPE');
    }

    // Decode base64 content
    let buffer: Buffer;
    try {
      buffer = Buffer.from(content, 'base64');
    } catch {
      throw new ApiError(400, 'Invalid base64 content', 'INVALID_CONTENT');
    }

    // Validate size
    if (buffer.length > maxSize) {
      throw new ApiError(400, `File too large: ${buffer.length} bytes (max ${maxSize})`, 'FILE_TOO_LARGE');
    }

    // Validate conversation ownership if store is available
    if (deps.conversationStore) {
      const conversation = await deps.conversationStore.get(conversationId, req.auth.userId);
      if (!conversation) throw new ApiError(404, 'Conversation not found');
    }

    // Generate storage path
    const fileId = randomUUID();
    const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
    const storagePath = `${deps.fileBasePath}/${fileId}${ext}`;

    // Write file content
    await backend.write(storagePath, buffer);

    // Store metadata
    const record = await deps.fileStore.create({
      conversationId,
      userId: req.auth.userId,
      filename,
      mimeType,
      sizeBytes: buffer.length,
      storagePath,
    });

    return jsonResponse(201, record);
  };
}

// --- GET /v1/files/:id ---

export function createFileGetHandler(deps: FileHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const file = await deps.fileStore.get(req.params.id);
    if (!file) throw new ApiError(404, 'File not found');

    // User isolation
    if (file.userId !== req.auth.userId) {
      throw new ApiError(404, 'File not found');
    }

    return jsonResponse(200, file);
  };
}

// --- GET /v1/files/:id/content ---

export function createFileDownloadHandler(deps: FileHandlerDeps, backend: FileBackend) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const file = await deps.fileStore.get(req.params.id);
    if (!file) throw new ApiError(404, 'File not found');

    // User isolation
    if (file.userId !== req.auth.userId) {
      throw new ApiError(404, 'File not found');
    }

    const data = await backend.read(file.storagePath);
    const base64 = data.toString('base64');

    return jsonResponse(200, {
      id: file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      content: base64,
    });
  };
}

// --- DELETE /v1/files/:id ---

export function createFileDeleteHandler(deps: FileHandlerDeps, backend: FileBackend) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const file = await deps.fileStore.get(req.params.id);
    if (!file) throw new ApiError(404, 'File not found');

    // User isolation
    if (file.userId !== req.auth.userId) {
      throw new ApiError(404, 'File not found');
    }

    // Delete content from storage backend
    await backend.delete(file.storagePath);

    // Delete metadata
    await deps.fileStore.delete(file.id);

    return jsonResponse(204, null);
  };
}

// --- GET /v1/conversations/:id/files ---

export function createConversationFilesHandler(deps: FileHandlerDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const conversationId = req.params.id;

    // Validate conversation ownership
    if (deps.conversationStore) {
      const conversation = await deps.conversationStore.get(conversationId, req.auth.userId);
      if (!conversation) throw new ApiError(404, 'Conversation not found');
    }

    const files = await deps.fileStore.listByConversation(conversationId);
    return jsonResponse(200, { files });
  };
}
