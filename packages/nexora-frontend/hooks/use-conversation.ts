import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useConversationStore } from "@/store/conversation";
import { useSettings } from "@/store/settings";
import type { Message } from "@/lib/block-types";

export function useConversationList() {
  const serverUrl = useSettings((s) => s.serverUrl);

  return useQuery({
    queryKey: ["conversations", serverUrl],
    queryFn: () => api.conversations.list({ limit: 50 }),
    enabled: !!serverUrl,
  });
}

export function useAgentList() {
  const serverUrl = useSettings((s) => s.serverUrl);

  return useQuery({
    queryKey: ["agents", serverUrl],
    queryFn: () => api.agents.list(),
    enabled: !!serverUrl,
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data?: { title?: string; agentId?: string }) =>
      api.conversations.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

export function useSendMessage() {
  const { addMessage, setIsSending } = useConversationStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      conversationId,
      input,
    }: {
      conversationId: string;
      input: string;
    }) => {
      const userMessage: Message = { role: "user", content: input };
      addMessage(conversationId, userMessage);
      setIsSending(true);
      return api.messages
        .send(conversationId, input)
        .then((data) => ({ data, conversationId }));
    },
    onSuccess: ({ data, conversationId }) => {
      const assistantMessage: Message = {
        role: "assistant",
        content: data.message,
        blocks: data.blocks,
      };
      addMessage(conversationId, assistantMessage);
      setIsSending(false);
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: () => {
      setIsSending(false);
    },
  });
}
