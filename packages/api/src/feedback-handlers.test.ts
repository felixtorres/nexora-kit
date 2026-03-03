import { describe, it, expect, vi } from 'vitest';
import {
  createSubmitFeedbackHandler,
  createAdminFeedbackQueryHandler,
  createAdminFeedbackSummaryHandler,
} from './feedback-handlers.js';
import type { ApiRequest, AuthIdentity } from './types.js';
import type { FeedbackHandlerDeps } from './feedback-handlers.js';
import type { IFeedbackStore, FeedbackRecord, PaginatedResult, FeedbackSummary } from '@nexora-kit/storage';

function makeAuth(role: 'admin' | 'user' = 'user'): AuthIdentity {
  return { userId: 'user-1', teamId: 'team-1', role };
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

function makeMockFeedbackStore(overrides: Partial<IFeedbackStore> = {}): IFeedbackStore {
  return {
    submit: vi.fn().mockResolvedValue({
      id: 'fb-1',
      conversationId: 'conv-1',
      messageSeq: 2,
      userId: 'user-1',
      rating: 'positive',
      comment: null,
      tags: [],
      pluginNamespace: null,
      model: null,
      createdAt: '2026-03-03T00:00:00.000Z',
    } satisfies FeedbackRecord),
    get: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ items: [], nextCursor: null } satisfies PaginatedResult<FeedbackRecord>),
    summary: vi.fn().mockResolvedValue({
      totalCount: 0,
      positiveCount: 0,
      negativeCount: 0,
      positiveRate: 0,
      byPlugin: [],
      byModel: [],
      topTags: [],
    } satisfies FeedbackSummary),
    deleteByConversation: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as IFeedbackStore;
}

describe('createSubmitFeedbackHandler', () => {
  it('submits feedback and returns 200', async () => {
    const feedbackStore = makeMockFeedbackStore();
    const deps: FeedbackHandlerDeps = { feedbackStore };
    const handler = createSubmitFeedbackHandler(deps);

    const res = await handler(makeReq({
      method: 'POST',
      params: { id: 'conv-1', seq: '2' },
      body: { rating: 'positive', comment: 'Great!', tags: ['helpful'] },
    }));

    expect(res.status).toBe(200);
    expect(feedbackStore.submit).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-1',
      messageSeq: 2,
      userId: 'user-1',
      rating: 'positive',
      comment: 'Great!',
      tags: ['helpful'],
    }));
  });

  it('rejects unauthenticated requests', async () => {
    const handler = createSubmitFeedbackHandler({ feedbackStore: makeMockFeedbackStore() });
    await expect(handler(makeReq({ auth: undefined }))).rejects.toThrow('Authentication required');
  });

  it('rejects invalid message sequence', async () => {
    const handler = createSubmitFeedbackHandler({ feedbackStore: makeMockFeedbackStore() });
    await expect(handler(makeReq({
      method: 'POST',
      params: { id: 'conv-1', seq: 'abc' },
      body: { rating: 'positive' },
    }))).rejects.toThrow('Invalid message sequence number');
  });

  it('rejects invalid rating value', async () => {
    const handler = createSubmitFeedbackHandler({ feedbackStore: makeMockFeedbackStore() });
    await expect(handler(makeReq({
      method: 'POST',
      params: { id: 'conv-1', seq: '2' },
      body: { rating: 'excellent' },
    }))).rejects.toThrow('Invalid request');
  });
});

describe('createAdminFeedbackQueryHandler', () => {
  it('returns paginated feedback for admin', async () => {
    const feedbackStore = makeMockFeedbackStore();
    const handler = createAdminFeedbackQueryHandler({ feedbackStore });

    const res = await handler(makeReq({ auth: makeAuth('admin') }));
    expect(res.status).toBe(200);
    expect(feedbackStore.query).toHaveBeenCalledWith(expect.objectContaining({}));
  });

  it('passes query filters', async () => {
    const feedbackStore = makeMockFeedbackStore();
    const handler = createAdminFeedbackQueryHandler({ feedbackStore });

    await handler(makeReq({
      auth: makeAuth('admin'),
      query: { rating: 'negative', pluginNamespace: 'faq', limit: '10' },
    }));

    expect(feedbackStore.query).toHaveBeenCalledWith(expect.objectContaining({
      rating: 'negative',
      pluginNamespace: 'faq',
      limit: 10,
    }));
  });

  it('rejects non-admin users', async () => {
    const handler = createAdminFeedbackQueryHandler({ feedbackStore: makeMockFeedbackStore() });
    await expect(handler(makeReq({ auth: makeAuth('user') }))).rejects.toThrow('Admin access required');
  });
});

describe('createAdminFeedbackSummaryHandler', () => {
  it('returns summary for admin', async () => {
    const feedbackStore = makeMockFeedbackStore();
    const handler = createAdminFeedbackSummaryHandler({ feedbackStore });

    const res = await handler(makeReq({ auth: makeAuth('admin') }));
    expect(res.status).toBe(200);
    expect(feedbackStore.summary).toHaveBeenCalled();
  });

  it('passes summary filters', async () => {
    const feedbackStore = makeMockFeedbackStore();
    const handler = createAdminFeedbackSummaryHandler({ feedbackStore });

    await handler(makeReq({
      auth: makeAuth('admin'),
      query: { model: 'claude-3', from: '2026-01-01' },
    }));

    expect(feedbackStore.summary).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-3',
      from: '2026-01-01',
    }));
  });

  it('rejects non-admin users', async () => {
    const handler = createAdminFeedbackSummaryHandler({ feedbackStore: makeMockFeedbackStore() });
    await expect(handler(makeReq({ auth: makeAuth('user') }))).rejects.toThrow('Admin access required');
  });
});
