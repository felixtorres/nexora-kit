import type { AgentLoop, MessageStore, ResponseBlock, Message } from '@nexora-kit/core';
import type { IConversationStore, IFeedbackStore } from '@nexora-kit/storage';
import type { ApiRequest, ApiResponse } from './types.js';
import { editMessageSchema } from './types.js';
import { ApiError, jsonResponse } from './router.js';

export interface MessageEditDeps {
  agentLoop: AgentLoop;
  conversationStore: IConversationStore;
  messageStore: MessageStore;
  feedbackStore?: IFeedbackStore;
}

function extractMessageText(message: Message): string {
  if (typeof message.content === 'string') return message.content;
  for (const part of message.content) {
    if (part.type === 'text') return part.text;
  }
  return '';
}

// --- PUT /v1/conversations/:id/messages/:seq ---

export function createEditMessageHandler(deps: MessageEditDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const conversationId = req.params.id;
    const seq = parseInt(req.params.seq, 10);
    if (isNaN(seq) || seq < 1) throw new ApiError(400, 'Invalid message sequence number');

    // Validate conversation ownership
    const conversation = await deps.conversationStore.get(conversationId, req.auth.userId);
    if (!conversation) throw new ApiError(404, 'Conversation not found');

    // Concurrency guard
    if (deps.agentLoop.isActive(conversationId)) {
      throw new ApiError(409, 'A generation is already in progress for this conversation', 'CONFLICT');
    }

    // Load messages and validate seq
    const messages = await deps.messageStore.get(conversationId);
    if (seq > messages.length) throw new ApiError(404, 'Message not found');

    // Validate it's a user message (seq is 1-based, array is 0-based)
    const targetMessage = messages[seq - 1];
    if (targetMessage.role !== 'user') {
      throw new ApiError(400, 'Can only edit user messages');
    }

    // Validate body
    const parsed = editMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, `Invalid request: ${parsed.error.issues[0].message}`, 'VALIDATION_ERROR');
    }

    const { input } = parsed.data;
    const chatInput = typeof input === 'string' ? { type: 'text' as const, text: input } : input;

    // Truncate: keep messages before seq, delete seq and everything after
    await deps.messageStore.truncateFrom(conversationId, seq - 1);

    // Clean up orphaned feedback
    if (deps.feedbackStore) {
      await deps.feedbackStore.deleteFromSeq(conversationId, seq);
    }

    // Re-run agent loop with new input
    let fullText = '';
    const allBlocks: ResponseBlock[] = [];

    for await (const event of deps.agentLoop.run({
      conversationId,
      input: chatInput,
      teamId: req.auth.teamId,
      userId: req.auth.userId,
      systemPrompt: conversation.systemPrompt ?? undefined,
      model: conversation.model ?? undefined,
      workspaceId: conversation.workspaceId ?? undefined,
    }, req.signal)) {
      if (event.type === 'text') {
        fullText += event.content;
      } else if (event.type === 'blocks') {
        allBlocks.push(...event.blocks);
      }
    }

    // Update message stats
    const updatedMessages = await deps.messageStore.get(conversationId);
    await deps.conversationStore.updateMessageStats(
      conversationId,
      updatedMessages.length,
      new Date().toISOString(),
    );

    return jsonResponse(200, {
      conversationId,
      message: fullText,
      ...(allBlocks.length > 0 ? { blocks: allBlocks } : {}),
    });
  };
}

// --- POST /v1/conversations/:id/messages/:seq/regenerate ---

export function createRegenerateMessageHandler(deps: MessageEditDeps) {
  return async (req: ApiRequest): Promise<ApiResponse> => {
    if (!req.auth) throw new ApiError(401, 'Authentication required');

    const conversationId = req.params.id;
    const seq = parseInt(req.params.seq, 10);
    if (isNaN(seq) || seq < 1) throw new ApiError(400, 'Invalid message sequence number');

    // Validate conversation ownership
    const conversation = await deps.conversationStore.get(conversationId, req.auth.userId);
    if (!conversation) throw new ApiError(404, 'Conversation not found');

    // Concurrency guard
    if (deps.agentLoop.isActive(conversationId)) {
      throw new ApiError(409, 'A generation is already in progress for this conversation', 'CONFLICT');
    }

    // Load messages and validate seq
    const messages = await deps.messageStore.get(conversationId);
    if (seq > messages.length) throw new ApiError(404, 'Message not found');

    // Validate it's an assistant message
    const targetMessage = messages[seq - 1];
    if (targetMessage.role !== 'assistant') {
      throw new ApiError(400, 'Can only regenerate assistant messages');
    }

    // Find the most recent user message before this assistant message
    let userMessageSeq = -1;
    let userMessageText = '';
    for (let i = seq - 2; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userMessageSeq = i + 1; // 1-based
        userMessageText = extractMessageText(messages[i]);
        break;
      }
    }
    if (userMessageSeq < 1) {
      throw new ApiError(400, 'No preceding user message found');
    }

    // Truncate: delete the user message and everything after it
    // Agent loop will re-append the user message and generate a new response
    await deps.messageStore.truncateFrom(conversationId, userMessageSeq - 1);

    // Clean up orphaned feedback
    if (deps.feedbackStore) {
      await deps.feedbackStore.deleteFromSeq(conversationId, userMessageSeq);
    }

    // Re-run agent loop with the original user message
    let fullText = '';
    const allBlocks: ResponseBlock[] = [];

    for await (const event of deps.agentLoop.run({
      conversationId,
      input: { type: 'text', text: userMessageText },
      teamId: req.auth.teamId,
      userId: req.auth.userId,
      systemPrompt: conversation.systemPrompt ?? undefined,
      model: conversation.model ?? undefined,
      workspaceId: conversation.workspaceId ?? undefined,
    }, req.signal)) {
      if (event.type === 'text') {
        fullText += event.content;
      } else if (event.type === 'blocks') {
        allBlocks.push(...event.blocks);
      }
    }

    // Update message stats
    const updatedMessages = await deps.messageStore.get(conversationId);
    await deps.conversationStore.updateMessageStats(
      conversationId,
      updatedMessages.length,
      new Date().toISOString(),
    );

    return jsonResponse(200, {
      conversationId,
      message: fullText,
      ...(allBlocks.length > 0 ? { blocks: allBlocks } : {}),
    });
  };
}
