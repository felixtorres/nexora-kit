import { describe, it, expect, vi } from 'vitest';
import {
  createFileUploadHandler,
  createFileGetHandler,
  createFileDownloadHandler,
  createFileDeleteHandler,
  createConversationFilesHandler,
} from './file-handlers.js';
import type { ApiRequest, AuthIdentity } from './types.js';
import type { FileHandlerDeps, FileBackend } from './file-handlers.js';
import type { IFileStore, FileRecord, IConversationStore, ConversationRecord } from '@nexora-kit/storage';

function makeAuth(overrides: Partial<AuthIdentity> = {}): AuthIdentity {
  return { userId: 'user-1', teamId: 'team-1', role: 'user', ...overrides };
}

function makeReq(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    url: '/test',
    headers: {},
    params: {},
    query: {},
    auth: makeAuth(),
    ...overrides,
  };
}

function makeFileRecord(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: 'file-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    filename: 'test.txt',
    mimeType: 'text/plain',
    sizeBytes: 100,
    storagePath: '/data/files/file-1.txt',
    metadata: {},
    createdAt: '2026-03-03T00:00:00Z',
    ...overrides,
  };
}

function makeMockFileStore(): IFileStore {
  return {
    create: vi.fn().mockResolvedValue(makeFileRecord()),
    get: vi.fn().mockResolvedValue(makeFileRecord()),
    listByConversation: vi.fn().mockResolvedValue([makeFileRecord()]),
    delete: vi.fn().mockResolvedValue(true),
    deleteByConversation: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockBackend(): FileBackend {
  return {
    write: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue(Buffer.from('hello')),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDeps(overrides: Partial<FileHandlerDeps> = {}): FileHandlerDeps {
  return {
    fileStore: makeMockFileStore(),
    fileBasePath: '/data/files',
    ...overrides,
  };
}

describe('createFileUploadHandler', () => {
  it('uploads a file and returns 201', async () => {
    const deps = makeDeps();
    const backend = makeMockBackend();
    const handler = createFileUploadHandler(deps, backend);
    const content = Buffer.from('hello world').toString('base64');

    const res = await handler(makeReq({
      body: {
        conversationId: 'conv-1',
        filename: 'hello.txt',
        mimeType: 'text/plain',
        content,
      },
    }));

    expect(res.status).toBe(201);
    expect(backend.write).toHaveBeenCalledWith(expect.stringContaining('/data/files/'), expect.any(Buffer));
    expect(deps.fileStore.create).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-1',
      filename: 'hello.txt',
      mimeType: 'text/plain',
    }));
  });

  it('rejects disallowed MIME types', async () => {
    const handler = createFileUploadHandler(makeDeps(), makeMockBackend());
    const content = Buffer.from('data').toString('base64');

    await expect(handler(makeReq({
      body: {
        conversationId: 'conv-1',
        filename: 'virus.exe',
        mimeType: 'application/x-msdownload',
        content,
      },
    }))).rejects.toThrow('File type not allowed');
  });

  it('rejects files exceeding size limit', async () => {
    const deps = makeDeps({ maxFileSize: 10 });
    const handler = createFileUploadHandler(deps, makeMockBackend());
    const content = Buffer.from('a'.repeat(100)).toString('base64');

    await expect(handler(makeReq({
      body: {
        conversationId: 'conv-1',
        filename: 'big.txt',
        mimeType: 'text/plain',
        content,
      },
    }))).rejects.toThrow('File too large');
  });

  it('validates conversation ownership when store is provided', async () => {
    const convStore = {
      get: vi.fn().mockResolvedValue(undefined),
    } as unknown as IConversationStore;
    const deps = makeDeps({ conversationStore: convStore });
    const handler = createFileUploadHandler(deps, makeMockBackend());
    const content = Buffer.from('data').toString('base64');

    await expect(handler(makeReq({
      body: {
        conversationId: 'unknown',
        filename: 'test.txt',
        mimeType: 'text/plain',
        content,
      },
    }))).rejects.toThrow('Conversation not found');
  });

  it('requires authentication', async () => {
    const handler = createFileUploadHandler(makeDeps(), makeMockBackend());
    await expect(handler(makeReq({ auth: undefined }))).rejects.toThrow('Authentication required');
  });
});

describe('createFileGetHandler', () => {
  it('returns file metadata', async () => {
    const handler = createFileGetHandler(makeDeps());
    const res = await handler(makeReq({ params: { id: 'file-1' } }));
    expect(res.status).toBe(200);
    expect((res.body as any).filename).toBe('test.txt');
  });

  it('returns 404 for unknown file', async () => {
    const fileStore = makeMockFileStore();
    (fileStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const handler = createFileGetHandler(makeDeps({ fileStore }));
    await expect(handler(makeReq({ params: { id: 'nope' } }))).rejects.toThrow('File not found');
  });

  it('enforces user isolation', async () => {
    const fileStore = makeMockFileStore();
    (fileStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(makeFileRecord({ userId: 'other-user' }));
    const handler = createFileGetHandler(makeDeps({ fileStore }));
    await expect(handler(makeReq({ params: { id: 'file-1' } }))).rejects.toThrow('File not found');
  });
});

describe('createFileDownloadHandler', () => {
  it('returns base64 file content', async () => {
    const backend = makeMockBackend();
    backend.read = vi.fn().mockResolvedValue(Buffer.from('file content'));
    const handler = createFileDownloadHandler(makeDeps(), backend);

    const res = await handler(makeReq({ params: { id: 'file-1' } }));
    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body.filename).toBe('test.txt');
    expect(Buffer.from(body.content, 'base64').toString()).toBe('file content');
  });
});

describe('createFileDeleteHandler', () => {
  it('deletes file content and metadata', async () => {
    const deps = makeDeps();
    const backend = makeMockBackend();
    const handler = createFileDeleteHandler(deps, backend);

    const res = await handler(makeReq({ params: { id: 'file-1' } }));
    expect(res.status).toBe(204);
    expect(backend.delete).toHaveBeenCalled();
    expect(deps.fileStore.delete).toHaveBeenCalledWith('file-1');
  });

  it('returns 404 for unknown file', async () => {
    const fileStore = makeMockFileStore();
    (fileStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const handler = createFileDeleteHandler(makeDeps({ fileStore }), makeMockBackend());
    await expect(handler(makeReq({ params: { id: 'nope' } }))).rejects.toThrow('File not found');
  });
});

describe('createConversationFilesHandler', () => {
  it('lists files for a conversation', async () => {
    const handler = createConversationFilesHandler(makeDeps());
    const res = await handler(makeReq({ params: { id: 'conv-1' } }));
    expect(res.status).toBe(200);
    expect((res.body as any).files).toHaveLength(1);
  });

  it('validates conversation ownership', async () => {
    const convStore = {
      get: vi.fn().mockResolvedValue(undefined),
    } as unknown as IConversationStore;
    const handler = createConversationFilesHandler(makeDeps({ conversationStore: convStore }));
    await expect(handler(makeReq({ params: { id: 'unknown' } }))).rejects.toThrow('Conversation not found');
  });
});
