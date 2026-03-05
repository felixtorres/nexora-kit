import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useConversationStore } from '@/store/conversation';
import { useSettings } from '@/store/settings';
import type { Message } from '@/lib/block-types';

/**
 * The backend core Message type uses `content: string | MessageContent[]`.
 * When loading history the server may serialize content as an array of content
 * parts (e.g. tool calls, file references). Coerce to a plain string so
 * ReactMarkdown always receives a string child.
 */
function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          // { type: "text", text: string }
          if ('text' in part && typeof part.text === 'string') return part.text;
          // { type: "tool_result", ... } or other non-text parts — skip
        }
        return '';
      })
      .join('');
  }
  return String(content ?? '');
}

export function normalizeMessage(raw: unknown): Message {
  const msg = raw as Record<string, unknown>;
  return {
    role: msg.role as Message['role'],
    content: normalizeContent(msg.content),
    blocks: msg.blocks as Message['blocks'],
  };
}

export function useConversationList() {
  const serverUrl = useSettings((s) => s.serverUrl);

  return useQuery({
    queryKey: ['conversations', serverUrl],
    queryFn: () => api.conversations.list({ limit: 50 }),
    enabled: !!serverUrl,
  });
}

export function useAgentList() {
  const serverUrl = useSettings((s) => s.serverUrl);

  return useQuery({
    queryKey: ['agents', serverUrl],
    queryFn: () => api.agents.list(),
    enabled: !!serverUrl,
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
