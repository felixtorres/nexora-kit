import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useConversationStore } from '@/store/conversation';
import { useSettings, useSettingsHydrated } from '@/store/settings';
import type { Message, DisplayBlock, ToolCallBlock } from '@/lib/block-types';

interface ContentPart {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  toolUseId?: string;
  content?: string;
  isError?: boolean;
}

/**
 * Normalize raw backend messages into frontend Messages with reconstructed
 * tool call blocks. The backend stores tool calls as:
 *   - assistant message content: [{ type: 'tool_use', id, name, input }, ...]
 *   - tool message content: [{ type: 'tool_result', toolUseId, content, isError }, ...]
 *
 * We correlate these across messages to rebuild ToolCallBlock objects.
 */
export function normalizeMessages(rawMessages: unknown[]): Message[] {
  // Pass 1: collect tool results AND embedded blocks from 'tool' role messages
  const toolResults = new Map<string, { content: string; isError?: boolean }>();
  const toolBlocks = new Map<string, DisplayBlock[]>();
  for (const raw of rawMessages) {
    const msg = raw as Record<string, unknown>;
    if (msg.role !== 'tool' || !Array.isArray(msg.content)) continue;

    let currentToolUseId: string | undefined;
    const collectedBlocks: DisplayBlock[] = [];

    for (const part of msg.content as ContentPart[]) {
      if (part.type === 'tool_result' && part.toolUseId) {
        currentToolUseId = part.toolUseId;
        toolResults.set(part.toolUseId, {
          content: typeof part.content === 'string' ? part.content : '',
          isError: part.isError,
        });
      } else if (part.type === 'blocks' && Array.isArray((part as any).blocks)) {
        collectedBlocks.push(...((part as any).blocks as DisplayBlock[]));
      }
    }

    // Associate collected blocks with the tool call that produced them
    if (currentToolUseId && collectedBlocks.length > 0) {
      toolBlocks.set(currentToolUseId, collectedBlocks);
    }
  }

  // Pass 2: extract text + tool blocks from each message
  interface ParsedMsg {
    role: string;
    text: string;
    toolCallEntries: ToolCallBlock[];
    existingBlocks: DisplayBlock[];
  }

  const parsed: ParsedMsg[] = [];

  for (const raw of rawMessages) {
    const msg = raw as Record<string, unknown>;
    const role = msg.role as string;

    if (role !== 'user' && role !== 'assistant') continue;

    const content = msg.content;
    let text = '';
    const toolCallEntries: ToolCallBlock[] = [];

    // Blocks embedded in the content array or from associated tool results
    let contentBlocks: DisplayBlock[] = [];

    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      for (const part of content as ContentPart[]) {
        if (typeof part === 'string') {
          text += part;
        } else if (part?.type === 'text' && typeof part.text === 'string') {
          text += part.text;
        } else if (part?.type === 'tool_use' && part.id && part.name) {
          const result = toolResults.get(part.id);
          toolCallEntries.push({
            type: 'tool_call',
            id: part.id,
            name: part.name,
            input: part.input,
            status: result?.isError ? 'error' : 'completed',
            result: result?.content,
            isError: result?.isError,
          });
          // Collect any custom blocks (e.g. dashboard app preview) associated with this tool call
          const associatedBlocks = toolBlocks.get(part.id);
          if (associatedBlocks) {
            contentBlocks.push(...associatedBlocks);
          }
        } else if (part?.type === 'blocks' && Array.isArray((part as any).blocks)) {
          // Extract custom blocks stored inside tool message content
          contentBlocks.push(...((part as any).blocks as DisplayBlock[]));
        }
      }
    } else {
      text = String(content ?? '');
    }

    if (!text && toolCallEntries.length === 0 && contentBlocks.length === 0) continue;

    // Also check for top-level blocks field (present on frontend-created messages)
    const existingBlocks = [
      ...contentBlocks,
      ...((msg.blocks as DisplayBlock[] | undefined) ?? []),
    ];
    parsed.push({ role, text, toolCallEntries, existingBlocks });
  }

  // Pass 3: merge consecutive assistant messages into single turns.
  // The backend stores one turn as: assistant (tool_use) → tool → assistant (text).
  // During streaming, the frontend shows these as one bubble. Merge them here
  // so reload matches the live experience.
  const messages: Message[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];

    if (p.role === 'user') {
      messages.push({ role: 'user', content: p.text });
      continue;
    }

    // Assistant message — merge with subsequent consecutive assistant messages
    let mergedText = p.text;
    const mergedBlocks: DisplayBlock[] = [...p.existingBlocks, ...p.toolCallEntries];

    while (i + 1 < parsed.length && parsed[i + 1].role === 'assistant') {
      i++;
      const next = parsed[i];
      if (next.text) {
        if (mergedText) mergedText += '\n\n';
        mergedText += next.text;
      }
      mergedBlocks.push(...next.existingBlocks, ...next.toolCallEntries);
    }

    messages.push({
      role: 'assistant',
      content: mergedText,
      blocks: mergedBlocks.length > 0 ? mergedBlocks : undefined,
    });
  }

  return messages;
}

// Keep single-message normalizer for non-history use cases (REST send response)
export function normalizeMessage(raw: unknown): Message {
  const results = normalizeMessages([raw]);
  if (results.length > 0) return results[0];
  const msg = raw as Record<string, unknown>;
  return { role: msg.role as Message['role'], content: String(msg.content ?? '') };
}

export function useConversationList() {
  const serverUrl = useSettings((s) => s.serverUrl);
  const apiKey = useSettings((s) => s.apiKey);
  const hydrated = useSettingsHydrated();

  return useQuery({
    queryKey: ['conversations', serverUrl],
    queryFn: () => api.conversations.list({ limit: 50 }),
    enabled: hydrated && !!serverUrl && !!apiKey,
  });
}

export function useAgentList() {
  const serverUrl = useSettings((s) => s.serverUrl);
  const apiKey = useSettings((s) => s.apiKey);
  const hydrated = useSettingsHydrated();

  return useQuery({
    queryKey: ['agents', serverUrl],
    queryFn: () => api.agents.list(),
    enabled: hydrated && !!serverUrl && !!apiKey,
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data?: { title?: string; agentId?: string }) => api.conversations.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.conversations.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

export function useSendMessage() {
  const { addMessage, setIsSending } = useConversationStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ conversationId, input }: { conversationId: string; input: string }) => {
      const userMessage: Message = { role: 'user', content: input };
      addMessage(conversationId, userMessage);
      setIsSending(true);
      return api.messages.send(conversationId, input).then((data) => ({ data, conversationId }));
    },
    onSuccess: ({ data, conversationId }) => {
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.message,
        blocks: data.blocks,
      };
      addMessage(conversationId, assistantMessage);
      setIsSending(false);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: () => {
      setIsSending(false);
    },
  });
}
