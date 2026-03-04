import { create } from "zustand";
import type { Message } from "@/lib/block-types";

interface ConversationState {
  activeConversationId: string | null;
  messagesByConversation: Record<string, Message[]>;
  isSending: boolean;

  setActiveConversation: (id: string | null) => void;
  setMessages: (conversationId: string, messages: Message[]) => void;
  addMessage: (conversationId: string, message: Message) => void;
  setIsSending: (sending: boolean) => void;
}

export const useConversationStore = create<ConversationState>((set) => ({
  activeConversationId: null,
  messagesByConversation: {},
  isSending: false,

  setActiveConversation: (id) =>
    set({ activeConversationId: id, isSending: false }),

  setMessages: (conversationId, messages) =>
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: messages,
      },
    })),

  addMessage: (conversationId, message) =>
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: [
          ...(state.messagesByConversation[conversationId] ?? []),
          message,
        ],
      },
    })),

  setIsSending: (sending) => set({ isSending: sending }),
}));
