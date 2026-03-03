import { describe, it, expect, vi } from 'vitest';
import {
  createEditMessageHandler,
  createRegenerateMessageHandler,
} from './message-handlers.js';
import type { ApiRequest, AuthIdentity } from './types.js';
import type { MessageEditDeps } from './message-handlers.js';
import type { Message } from '@nexora-kit/core';
import type { IConversationStore, ConversationRecord, IFeedbackStore } from '@nexora-kit/storage';

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

function makeConversation(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    id: 'conv-1',
    teamId: 'team-1',
    userId: 'user-1',
    title: 'Test',
    systemPrompt: null,
    templateId: null,
    workspaceId: null,
    model: null,
    agentId: null,
    pluginNamespaces: [],
    messageCount: 4,
    lastMessageAt: null,
    metadata: {},
    createdAt: '2026-03-03T00:00:00Z',
    updatedAt: '2026-03-03T00:00:00Z',
    ...overrides,
  };
}

function makeMessages(): Message[] {
  return [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' },
    { role: 'user', content: 'How are you?' },
    { role: 'assistant', content: 'I am fine.' },
  ];
}

function makeMockAgentLoop(events: Array<{ type: string; [key: string]: unknown }> = []) {
  return {
    run: vi.fn().mockImplementation(async function* () {
      for (const event of events) {
        yield event;
      }
    }),
    isActive: vi.fn().mockReturnValue(false),
    abort: vi.fn(),
    toolDispatcher: {} as any,
  };
}

function makeDeps(overrides: Partial<MessageEditDeps> = {}): MessageEditDeps {
  return {
    agentLoop: makeMockAgentLoop([
      { type: 'text', content: 'New response' },
      { type: 'done' },
    ]) as any,
    conversationStore: {
      get: vi.fn().mockResolvedValue(makeConversation()),
      updateMessageStats: vi.fn().mockResolvedValue(undefined),
    } as unknown as IConversationStore,
    messageStore: {
      get: vi.fn().mockResolvedValue(makeMessages()),
      truncateFrom: vi.fn().mockResolvedValue(undefined),
      append: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

describe('createEditMessageHandler', () => {
  it('edits a user message and returns new response', async () => {
    const deps = makeDeps();
    const handler = createEditMessageHandler(deps);

    const res = await handler(makeReq({
      params: { id: 'conv-1', seq: '3' },
      body: { input: 'Updated question' },
    }));

    expect(res.status).toBe(200);
    expect((res.body as any).message).toBe('New response');
    expect(deps.messageStore.truncateFrom).toHaveBeenCalledWith('conv-1', 2);
    expect(deps.agentLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        input: { type: 'text', text: 'Updated question' },
      }),
      undefined,
    );
  });

  it('rejects editing non-user messages', async () => {
    const handler = createEditMessageHandler(makeDeps());

    await expect(handler(makeReq({
      params: { id: 'conv-1', seq: '2' }, // assistant message
      body: { input: 'edit' },
    }))).rejects.toThrow('Can only edit user messages');
  });

  it('rejects invalid seq', async () => {
    const handler = createEditMessageHandler(makeDeps());

    await expect(handler(makeReq({
      params: { id: 'conv-1', seq: '0' },
      body: { input: 'edit' },
    }))).rejects.toThrow('Invalid message sequence number');
  });

  it('rejects seq beyond message count', async () => {
    const handler = createEditMessageHandler(makeDeps());

    await expect(handler(makeReq({
      params: { id: 'conv-1', seq: '10' },
      body: { input: 'edit' },
    }))).rejects.toThrow('Message not found');
  });

  it('returns 409 if generation is active', async () => {
    const agentLoop = makeMockAgentLoop();
    agentLoop.isActive.mockReturnValue(true);
    const handler = createEditMessageHandler(makeDeps({ agentLoop: agentLoop as any }));

    await expect(handler(makeReq({
      params: { id: 'conv-1', seq: '1' },
      body: { input: 'edit' },
    }))).rejects.toThrow('A generation is already in progress');
  });

  it('returns 404 for unknown conversation', async () => {
    const store = { get: vi.fn().mockResolvedValue(undefined), updateMessageStats: vi.fn() } as unknown as IConversationStore;
    const handler = createEditMessageHandler(makeDeps({ conversationStore: store }));

    await expect(handler(makeReq({
      params: { id: 'nope', seq: '1' },
      body: { input: 'edit' },
    }))).rejects.toThrow('Conversation not found');
  });

  it('cleans up orphaned feedback when feedbackStore is provided', async () => {
    const feedbackStore = {
      deleteFromSeq: vi.fn().mockResolvedValue(undefined),
    } as unknown as IFeedbackStore;
    const deps = makeDeps({ feedbackStore });
    const handler = createEditMessageHandler(deps);

    await handler(makeReq({
      params: { id: 'conv-1', seq: '3' },
      body: { input: 'Updated' },
    }));

    expect(feedbackStore.deleteFromSeq).toHaveBeenCalledWith('conv-1', 3);
  });

  it('updates message stats after edit', async () => {
    const deps = makeDeps();
    const handler = createEditMessageHandler(deps);

    await handler(makeReq({
      params: { id: 'conv-1', seq: '1' },
      body: { input: 'New first message' },
    }));

    expect(deps.conversationStore.updateMessageStats).toHaveBeenCalledWith(
      'conv-1',
      expect.any(Number),
      expect.any(String),
    );
  });

  it('requires authentication', async () => {
    const handler = createEditMessageHandler(makeDeps());
    await expect(handler(makeReq({
      auth: undefined,
      params: { id: 'conv-1', seq: '1' },
      body: { input: 'edit' },
    }))).rejects.toThrow('Authentication required');
  });
});

describe('createRegenerateMessageHandler', () => {
  it('regenerates an assistant message', async () => {
    const deps = makeDeps();
    const handler = createRegenerateMessageHandler(deps);

    const res = await handler(makeReq({
      params: { id: 'conv-1', seq: '4' }, // last assistant message
    }));

    expect(res.status).toBe(200);
    expect((res.body as any).message).toBe('New response');
    // Should truncate before the user message (seq 3) that triggered the assistant message (seq 4)
    // truncateFrom(conv-1, 2) keeps seq 1,2 and deletes 3,4
    expect(deps.messageStore.truncateFrom).toHaveBeenCalledWith('conv-1', 2);
    expect(deps.agentLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        input: { type: 'text', text: 'How are you?' },
      }),
      undefined,
    );
  });

  it('rejects regenerating non-assistant messages', async () => {
    const handler = createRegenerateMessageHandler(makeDeps());

    await expect(handler(makeReq({
      params: { id: 'conv-1', seq: '3' }, // user message
    }))).rejects.toThrow('Can only regenerate assistant messages');
  });

  it('returns 409 if generation is active', async () => {
    const agentLoop = makeMockAgentLoop();
    agentLoop.isActive.mockReturnValue(true);
    const handler = createRegenerateMessageHandler(makeDeps({ agentLoop: agentLoop as any }));

    await expect(handler(makeReq({
      params: { id: 'conv-1', seq: '2' },
    }))).rejects.toThrow('A generation is already in progress');
  });

  it('cleans up orphaned feedback', async () => {
    const feedbackStore = {
      deleteFromSeq: vi.fn().mockResolvedValue(undefined),
    } as unknown as IFeedbackStore;
    const deps = makeDeps({ feedbackStore });
    const handler = createRegenerateMessageHandler(deps);

    await handler(makeReq({
      params: { id: 'conv-1', seq: '4' },
    }));

    // Should delete feedback from the user message seq onward
    expect(feedbackStore.deleteFromSeq).toHaveBeenCalledWith('conv-1', 3);
  });

  it('handles assistant message at seq 2 (first response)', async () => {
    const deps = makeDeps();
    const handler = createRegenerateMessageHandler(deps);

    const res = await handler(makeReq({
      params: { id: 'conv-1', seq: '2' },
    }));

    expect(res.status).toBe(200);
    // truncateFrom(conv-1, 0) keeps nothing before seq 1, deletes 1,2
    expect(deps.messageStore.truncateFrom).toHaveBeenCalledWith('conv-1', 0);
    expect(deps.agentLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { type: 'text', text: 'Hello' },
      }),
      undefined,
    );
  });

  it('passes conversation systemPrompt and model to agent loop', async () => {
    const conversation = makeConversation({ systemPrompt: 'Be concise', model: 'gpt-4' });
    const store = {
      get: vi.fn().mockResolvedValue(conversation),
      updateMessageStats: vi.fn(),
    } as unknown as IConversationStore;
    const deps = makeDeps({ conversationStore: store });
    const handler = createRegenerateMessageHandler(deps);

    await handler(makeReq({
      params: { id: 'conv-1', seq: '2' },
    }));

    expect(deps.agentLoop.run).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: 'Be concise',
        model: 'gpt-4',
      }),
      undefined,
    );
  });

  it('returns 404 for unknown conversation', async () => {
    const store = { get: vi.fn().mockResolvedValue(undefined), updateMessageStats: vi.fn() } as unknown as IConversationStore;
    const handler = createRegenerateMessageHandler(makeDeps({ conversationStore: store }));

    await expect(handler(makeReq({
      params: { id: 'nope', seq: '1' },
    }))).rejects.toThrow('Conversation not found');
  });

  it('updates message stats after regeneration', async () => {
    const deps = makeDeps();
    const handler = createRegenerateMessageHandler(deps);

    await handler(makeReq({
      params: { id: 'conv-1', seq: '2' },
    }));

    expect(deps.conversationStore.updateMessageStats).toHaveBeenCalledWith(
      'conv-1',
      expect.any(Number),
      expect.any(String),
    );
  });
});
