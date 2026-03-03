import { describe, it, expect, vi } from 'vitest';
import {
  createListArtifactsHandler,
  createGetArtifactHandler,
  createListArtifactVersionsHandler,
  createGetArtifactVersionHandler,
  createDeleteArtifactHandler,
} from './artifact-handlers.js';
import type { ApiRequest, AuthIdentity } from './types.js';
import type { ArtifactHandlerDeps } from './artifact-handlers.js';
import type { IArtifactStore, ArtifactRecord, ArtifactVersionRecord, IConversationStore } from '@nexora-kit/storage';

function makeAuth(): AuthIdentity {
  return { userId: 'user-1', teamId: 'team-1', role: 'user' };
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

function makeArtifact(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    id: 'art-1',
    conversationId: 'conv-1',
    title: 'My Document',
    type: 'document',
    language: null,
    currentVersion: 1,
    content: '# Hello',
    metadata: {},
    createdAt: '2026-03-03T00:00:00Z',
    updatedAt: '2026-03-03T00:00:00Z',
    ...overrides,
  };
}

function makeVersion(overrides: Partial<ArtifactVersionRecord> = {}): ArtifactVersionRecord {
  return {
    artifactId: 'art-1',
    version: 1,
    content: '# Hello',
    createdAt: '2026-03-03T00:00:00Z',
    ...overrides,
  };
}

function makeMockStore(): IArtifactStore {
  return {
    create: vi.fn().mockResolvedValue(makeArtifact()),
    update: vi.fn().mockResolvedValue(makeArtifact()),
    get: vi.fn().mockResolvedValue(makeArtifact()),
    listByConversation: vi.fn().mockResolvedValue([makeArtifact()]),
    getVersion: vi.fn().mockResolvedValue(makeVersion()),
    listVersions: vi.fn().mockResolvedValue([makeVersion()]),
    delete: vi.fn().mockResolvedValue(true),
    deleteByConversation: vi.fn(),
  };
}

function makeMockConvStore(): IConversationStore {
  return {
    create: vi.fn(),
    get: vi.fn().mockResolvedValue({ id: 'conv-1', userId: 'user-1' }),
    list: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    updateMessageStats: vi.fn(),
  };
}

function makeDeps(overrides: Partial<ArtifactHandlerDeps> = {}): ArtifactHandlerDeps {
  return {
    artifactStore: makeMockStore(),
    conversationStore: makeMockConvStore(),
    ...overrides,
  };
}

describe('createListArtifactsHandler', () => {
  it('lists artifacts for a conversation', async () => {
    const deps = makeDeps();
    const handler = createListArtifactsHandler(deps);

    const res = await handler(makeReq({ params: { id: 'conv-1' } }));
    expect(res.status).toBe(200);
    expect((res.body as any).artifacts).toHaveLength(1);
    expect(deps.artifactStore.listByConversation).toHaveBeenCalledWith('conv-1');
  });

  it('returns 404 if conversation not found', async () => {
    const convStore = makeMockConvStore();
    (convStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const deps = makeDeps({ conversationStore: convStore });
    const handler = createListArtifactsHandler(deps);

    await expect(handler(makeReq({ params: { id: 'nope' } }))).rejects.toThrow('Conversation not found');
  });

  it('rejects unauthenticated requests', async () => {
    const handler = createListArtifactsHandler(makeDeps());
    await expect(handler(makeReq({ auth: undefined }))).rejects.toThrow('Authentication required');
  });
});

describe('createGetArtifactHandler', () => {
  it('returns an artifact', async () => {
    const deps = makeDeps();
    const handler = createGetArtifactHandler(deps);

    const res = await handler(makeReq({ params: { id: 'conv-1', artifactId: 'art-1' } }));
    expect(res.status).toBe(200);
    expect((res.body as any).id).toBe('art-1');
  });

  it('returns 404 if artifact not found', async () => {
    const artStore = makeMockStore();
    (artStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const handler = createGetArtifactHandler(makeDeps({ artifactStore: artStore }));

    await expect(handler(makeReq({ params: { id: 'conv-1', artifactId: 'nope' } }))).rejects.toThrow('Artifact not found');
  });

  it('returns 404 if artifact belongs to different conversation', async () => {
    const artStore = makeMockStore();
    (artStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(makeArtifact({ conversationId: 'other-conv' }));
    const handler = createGetArtifactHandler(makeDeps({ artifactStore: artStore }));

    await expect(handler(makeReq({ params: { id: 'conv-1', artifactId: 'art-1' } }))).rejects.toThrow('Artifact not found');
  });
});

describe('createListArtifactVersionsHandler', () => {
  it('lists versions for an artifact', async () => {
    const deps = makeDeps();
    const handler = createListArtifactVersionsHandler(deps);

    const res = await handler(makeReq({ params: { id: 'conv-1', artifactId: 'art-1' } }));
    expect(res.status).toBe(200);
    expect((res.body as any).versions).toHaveLength(1);
  });

  it('returns 404 if artifact not in conversation', async () => {
    const artStore = makeMockStore();
    (artStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(makeArtifact({ conversationId: 'other' }));
    const handler = createListArtifactVersionsHandler(makeDeps({ artifactStore: artStore }));

    await expect(handler(makeReq({ params: { id: 'conv-1', artifactId: 'art-1' } }))).rejects.toThrow('Artifact not found');
  });
});

describe('createGetArtifactVersionHandler', () => {
  it('returns a specific version', async () => {
    const deps = makeDeps();
    const handler = createGetArtifactVersionHandler(deps);

    const res = await handler(makeReq({ params: { id: 'conv-1', artifactId: 'art-1', version: '1' } }));
    expect(res.status).toBe(200);
    expect((res.body as any).version).toBe(1);
  });

  it('returns 400 for invalid version number', async () => {
    const handler = createGetArtifactVersionHandler(makeDeps());
    await expect(handler(makeReq({ params: { id: 'conv-1', artifactId: 'art-1', version: 'abc' } }))).rejects.toThrow('Invalid version number');
  });

  it('returns 404 for nonexistent version', async () => {
    const artStore = makeMockStore();
    (artStore.getVersion as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const handler = createGetArtifactVersionHandler(makeDeps({ artifactStore: artStore }));

    await expect(handler(makeReq({ params: { id: 'conv-1', artifactId: 'art-1', version: '99' } }))).rejects.toThrow('Version not found');
  });
});

describe('createDeleteArtifactHandler', () => {
  it('deletes an artifact and returns 204', async () => {
    const deps = makeDeps();
    const handler = createDeleteArtifactHandler(deps);

    const res = await handler(makeReq({ params: { id: 'conv-1', artifactId: 'art-1' } }));
    expect(res.status).toBe(204);
    expect(deps.artifactStore.delete).toHaveBeenCalledWith('art-1');
  });

  it('returns 404 if artifact not found', async () => {
    const artStore = makeMockStore();
    (artStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const handler = createDeleteArtifactHandler(makeDeps({ artifactStore: artStore }));

    await expect(handler(makeReq({ params: { id: 'conv-1', artifactId: 'nope' } }))).rejects.toThrow('Artifact not found');
  });
});
