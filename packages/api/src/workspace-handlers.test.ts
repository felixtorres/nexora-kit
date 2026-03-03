import { describe, it, expect, vi } from 'vitest';
import {
  createWorkspaceCreateHandler,
  createWorkspaceListHandler,
  createWorkspaceGetHandler,
  createWorkspaceUpdateHandler,
  createWorkspaceDeleteHandler,
  createDocumentCreateHandler,
  createDocumentListHandler,
  createDocumentUpdateHandler,
  createDocumentDeleteHandler,
} from './workspace-handlers.js';
import type { ApiRequest, AuthIdentity } from './types.js';
import type { WorkspaceHandlerDeps } from './workspace-handlers.js';
import type { IWorkspaceStore, IContextDocumentStore, WorkspaceRecord, ContextDocumentRecord } from '@nexora-kit/storage';

function makeAdmin(): AuthIdentity {
  return { userId: 'admin-1', teamId: 'team-1', role: 'admin' };
}

function makeUser(): AuthIdentity {
  return { userId: 'user-1', teamId: 'team-1', role: 'user' };
}

function makeReq(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    url: '/test',
    headers: {},
    params: {},
    query: {},
    auth: makeAdmin(),
    ...overrides,
  };
}

function makeWorkspace(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id: 'ws-1',
    teamId: 'team-1',
    name: 'Test Workspace',
    description: null,
    systemPrompt: null,
    metadata: {},
    createdAt: '2026-03-03T00:00:00Z',
    updatedAt: '2026-03-03T00:00:00Z',
    ...overrides,
  };
}

function makeDocument(overrides: Partial<ContextDocumentRecord> = {}): ContextDocumentRecord {
  return {
    id: 'doc-1',
    workspaceId: 'ws-1',
    title: 'Test Doc',
    content: 'Some content',
    priority: 0,
    tokenCount: 3,
    metadata: {},
    createdAt: '2026-03-03T00:00:00Z',
    updatedAt: '2026-03-03T00:00:00Z',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<WorkspaceHandlerDeps> = {}): WorkspaceHandlerDeps {
  return {
    workspaceStore: {
      create: vi.fn().mockResolvedValue(makeWorkspace()),
      get: vi.fn().mockResolvedValue(makeWorkspace()),
      list: vi.fn().mockResolvedValue([makeWorkspace()]),
      update: vi.fn().mockResolvedValue(makeWorkspace()),
      delete: vi.fn().mockResolvedValue(true),
    } as unknown as IWorkspaceStore,
    contextDocumentStore: {
      create: vi.fn().mockResolvedValue(makeDocument()),
      get: vi.fn().mockResolvedValue(makeDocument()),
      listByWorkspace: vi.fn().mockResolvedValue([makeDocument()]),
      update: vi.fn().mockResolvedValue(makeDocument()),
      delete: vi.fn().mockResolvedValue(true),
      deleteByWorkspace: vi.fn().mockResolvedValue(undefined),
    } as unknown as IContextDocumentStore,
    ...overrides,
  };
}

describe('Workspace Handlers', () => {
  describe('createWorkspaceCreateHandler', () => {
    it('creates a workspace (admin)', async () => {
      const deps = makeDeps();
      const handler = createWorkspaceCreateHandler(deps);
      const res = await handler(makeReq({ body: { name: 'New WS' } }));
      expect(res.status).toBe(201);
      expect(deps.workspaceStore.create).toHaveBeenCalled();
    });

    it('rejects non-admin', async () => {
      const handler = createWorkspaceCreateHandler(makeDeps());
      await expect(handler(makeReq({ auth: makeUser(), body: { name: 'WS' } }))).rejects.toThrow('Admin');
    });

    it('rejects invalid body', async () => {
      const handler = createWorkspaceCreateHandler(makeDeps());
      await expect(handler(makeReq({ body: {} }))).rejects.toThrow();
    });
  });

  describe('createWorkspaceListHandler', () => {
    it('lists workspaces for team', async () => {
      const deps = makeDeps();
      const handler = createWorkspaceListHandler(deps);
      const res = await handler(makeReq({ auth: makeUser() }));
      expect(res.status).toBe(200);
      expect(deps.workspaceStore.list).toHaveBeenCalledWith('team-1');
    });

    it('rejects unauthenticated', async () => {
      const handler = createWorkspaceListHandler(makeDeps());
      await expect(handler(makeReq({ auth: undefined }))).rejects.toThrow('Authentication');
    });
  });

  describe('createWorkspaceGetHandler', () => {
    it('gets a workspace by id', async () => {
      const handler = createWorkspaceGetHandler(makeDeps());
      const res = await handler(makeReq({ params: { id: 'ws-1' }, auth: makeUser() }));
      expect(res.status).toBe(200);
    });

    it('returns 404 for non-existent', async () => {
      const deps = makeDeps();
      (deps.workspaceStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      const handler = createWorkspaceGetHandler(deps);
      await expect(handler(makeReq({ params: { id: 'nope' } }))).rejects.toThrow('not found');
    });
  });

  describe('createWorkspaceUpdateHandler', () => {
    it('updates workspace (admin)', async () => {
      const deps = makeDeps();
      const handler = createWorkspaceUpdateHandler(deps);
      const res = await handler(makeReq({ params: { id: 'ws-1' }, body: { name: 'Updated' } }));
      expect(res.status).toBe(200);
    });

    it('rejects non-admin', async () => {
      const handler = createWorkspaceUpdateHandler(makeDeps());
      await expect(handler(makeReq({ auth: makeUser(), params: { id: 'ws-1' }, body: { name: 'X' } }))).rejects.toThrow('Admin');
    });
  });

  describe('createWorkspaceDeleteHandler', () => {
    it('deletes workspace and its documents (admin)', async () => {
      const deps = makeDeps();
      const handler = createWorkspaceDeleteHandler(deps);
      const res = await handler(makeReq({ params: { id: 'ws-1' } }));
      expect(res.status).toBe(204);
      expect(deps.contextDocumentStore.deleteByWorkspace).toHaveBeenCalledWith('ws-1');
      expect(deps.workspaceStore.delete).toHaveBeenCalledWith('ws-1', 'team-1');
    });
  });

  describe('createDocumentCreateHandler', () => {
    it('creates a document (admin)', async () => {
      const deps = makeDeps();
      const handler = createDocumentCreateHandler(deps);
      const res = await handler(makeReq({
        params: { id: 'ws-1' },
        body: { title: 'Doc', content: 'Text' },
      }));
      expect(res.status).toBe(201);
    });

    it('returns 404 when workspace not found', async () => {
      const deps = makeDeps();
      (deps.workspaceStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      const handler = createDocumentCreateHandler(deps);
      await expect(handler(makeReq({
        params: { id: 'ws-nope' },
        body: { title: 'Doc', content: 'Text' },
      }))).rejects.toThrow('not found');
    });
  });

  describe('createDocumentListHandler', () => {
    it('lists documents for workspace', async () => {
      const deps = makeDeps();
      const handler = createDocumentListHandler(deps);
      const res = await handler(makeReq({ params: { id: 'ws-1' }, auth: makeUser() }));
      expect(res.status).toBe(200);
    });
  });

  describe('createDocumentUpdateHandler', () => {
    it('updates a document (admin)', async () => {
      const deps = makeDeps();
      const handler = createDocumentUpdateHandler(deps);
      const res = await handler(makeReq({
        params: { docId: 'doc-1' },
        body: { title: 'Updated Title' },
      }));
      expect(res.status).toBe(200);
    });

    it('returns 404 when document not found', async () => {
      const deps = makeDeps();
      (deps.contextDocumentStore.update as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      const handler = createDocumentUpdateHandler(deps);
      await expect(handler(makeReq({
        params: { docId: 'nope' },
        body: { title: 'X' },
      }))).rejects.toThrow('not found');
    });
  });

  describe('createDocumentDeleteHandler', () => {
    it('deletes a document (admin)', async () => {
      const deps = makeDeps();
      const handler = createDocumentDeleteHandler(deps);
      const res = await handler(makeReq({ params: { docId: 'doc-1' } }));
      expect(res.status).toBe(204);
    });

    it('returns 404 when document not found', async () => {
      const deps = makeDeps();
      (deps.contextDocumentStore.delete as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const handler = createDocumentDeleteHandler(deps);
      await expect(handler(makeReq({ params: { docId: 'nope' } }))).rejects.toThrow('not found');
    });
  });
});
