import { create } from "zustand";
import type { Message, ResponseBlock, StreamingArtifact, ToolCallBlock } from "@/lib/block-types";

// ── Dev Panel types ────────────────────────────────────────────────────

export interface DevEvent {
  direction: 'sent' | 'received';
  timestamp: number;
  data: unknown;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
}

// ── Store ──────────────────────────────────────────────────────────────

interface ConversationState {
  activeConversationId: string | null;
  messagesByConversation: Record<string, Message[]>;
  isSending: boolean;

  // Streaming state
  isStreaming: boolean;
  streamingText: string;
  streamingBlocks: ResponseBlock[];
  streamingToolCalls: ToolCallBlock[];
  artifacts: Map<string, StreamingArtifact>;

  // Dev panel state
  devEvents: DevEvent[];
  lastUsage: UsageInfo | null;

  setActiveConversation: (id: string | null) => void;
  setMessages: (conversationId: string, messages: Message[]) => void;
  addMessage: (conversationId: string, message: Message) => void;
  setIsSending: (sending: boolean) => void;

  // Streaming actions
  startStreaming: () => void;
  appendStreamingText: (text: string) => void;
  setStreamingBlocks: (blocks: ResponseBlock[]) => void;
  addToolCall: (tc: ToolCallBlock) => void;
  updateToolCallStatus: (id: string, status: ToolCallBlock['status']) => void;
  updateToolCallResult: (id: string, result: string, isError?: boolean) => void;
  finalizeStreaming: (conversationId: string) => void;
  clearStreaming: () => void;

  // Artifact actions
  initArtifact: (artifactId: string, title: string, content: string) => void;
  appendArtifactDelta: (artifactId: string, delta: string) => void;
  markArtifactDone: (artifactId: string) => void;

  // Dev panel actions
  addDevEvent: (event: DevEvent) => void;
  setLastUsage: (usage: UsageInfo) => void;
  clearDevEvents: () => void;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  activeConversationId: null,
  messagesByConversation: {},
  isSending: false,
  isStreaming: false,
  streamingText: "",
  streamingBlocks: [],
  streamingToolCalls: [],
  artifacts: new Map(),
  devEvents: [],
  lastUsage: null,

  setActiveConversation: (id) =>
    set({ activeConversationId: id, isSending: false, isStreaming: false }),

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

  startStreaming: () =>
    set({ isStreaming: true, streamingText: "", streamingBlocks: [], streamingToolCalls: [], isSending: true }),

  appendStreamingText: (text) =>
    set((state) => ({ streamingText: state.streamingText + text })),

  setStreamingBlocks: (blocks) =>
    set({ streamingBlocks: blocks }),

  addToolCall: (tc) =>
    set((state) => ({
      streamingToolCalls: [...state.streamingToolCalls, tc],
    })),

  updateToolCallStatus: (id, status) =>
    set((state) => ({
      streamingToolCalls: state.streamingToolCalls.map((tc) =>
        tc.id === id ? { ...tc, status } : tc
      ),
    })),

  updateToolCallResult: (id, result, isError) =>
    set((state) => ({
      streamingToolCalls: state.streamingToolCalls.map((tc) =>
        tc.id === id ? { ...tc, result, isError, status: isError ? 'error' as const : 'completed' as const } : tc
      ),
    })),

  finalizeStreaming: (conversationId) => {
    const { streamingText, streamingBlocks, streamingToolCalls } = get();
    const toolBlocks: ToolCallBlock[] = streamingToolCalls;
    const allBlocks = [
      ...toolBlocks,
      ...(streamingBlocks.length > 0 ? streamingBlocks : []),
    ];
    const blocks = allBlocks.length > 0 ? allBlocks : undefined;
    const content = streamingText || (blocks ? "" : "");
    const assistantMessage: Message = {
      role: "assistant",
      content,
      blocks,
    };
    // Only add if there's actual content
    if (content || blocks) {
      get().addMessage(conversationId, assistantMessage);
    }
    set({
      isStreaming: false,
      isSending: false,
      streamingText: "",
      streamingBlocks: [],
      streamingToolCalls: [],
    });
  },

  clearStreaming: () =>
    set({
      isStreaming: false,
      isSending: false,
      streamingText: "",
      streamingBlocks: [],
      streamingToolCalls: [],
    }),

  initArtifact: (artifactId, title, content) =>
    set((state) => {
      const artifacts = new Map(state.artifacts);
      artifacts.set(artifactId, { artifactId, title, content, done: false });
      return { artifacts };
    }),

  appendArtifactDelta: (artifactId, delta) =>
    set((state) => {
      const artifacts = new Map(state.artifacts);
      const existing = artifacts.get(artifactId);
      if (existing) {
        artifacts.set(artifactId, { ...existing, content: existing.content + delta });
      }
      return { artifacts };
    }),

  markArtifactDone: (artifactId) =>
    set((state) => {
      const artifacts = new Map(state.artifacts);
      const existing = artifacts.get(artifactId);
      if (existing) {
        artifacts.set(artifactId, { ...existing, done: true });
      }
      return { artifacts };
    }),

  addDevEvent: (event) =>
    set((state) => ({
      // Keep last 200 events to prevent unbounded growth
      devEvents: [...state.devEvents.slice(-199), event],
    })),

  setLastUsage: (usage) => set({ lastUsage: usage }),

  clearDevEvents: () => set({ devEvents: [], lastUsage: null }),
}));
