import { create } from 'zustand';
import type {
  ActivityBlock,
  DisplayBlock,
  Message,
  ResponseBlock,
  StreamingArtifact,
  ToolCallBlock,
} from '@/lib/block-types';

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
  streamingActivities: ActivityBlock[];
  /** Ordered list of content segments — preserves interleaving of text & blocks. */
  streamingParts: DisplayBlock[];
  artifacts: Map<string, StreamingArtifact>;

  // Feedback state: "conversationId:messageSeq" → rating
  feedbackByMessage: Record<string, 'positive' | 'negative'>;

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
  addActivity: (activity: ActivityBlock) => void;
  finalizeStreaming: (conversationId: string) => void;
  clearStreaming: () => void;

  // Artifact actions
  initArtifact: (artifactId: string, title: string, content: string) => void;
  appendArtifactDelta: (artifactId: string, delta: string) => void;
  markArtifactDone: (artifactId: string) => void;

  // Feedback actions
  setFeedback: (
    conversationId: string,
    messageSeq: number,
    rating: 'positive' | 'negative',
  ) => void;
  hydrateFeedback: (
    conversationId: string,
    feedback: Array<{ messageSeq: number; rating: 'positive' | 'negative' }>,
  ) => void;
  getFeedback: (conversationId: string, messageSeq: number) => 'positive' | 'negative' | undefined;

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
  streamingText: '',
  streamingBlocks: [],
  streamingToolCalls: [],
  streamingActivities: [],
  streamingParts: [],
  artifacts: new Map(),
  feedbackByMessage: {},
  devEvents: [],
  lastUsage: null,

  setActiveConversation: (id) =>
    set({
      activeConversationId: id,
      isSending: false,
      isStreaming: false,
      streamingText: '',
      streamingBlocks: [],
      streamingToolCalls: [],
      streamingActivities: [],
      streamingParts: [],
    }),

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
        [conversationId]: [...(state.messagesByConversation[conversationId] ?? []), message],
      },
    })),

  setIsSending: (sending) => set({ isSending: sending }),

  startStreaming: () =>
    set({
      isStreaming: true,
      streamingText: '',
      streamingBlocks: [],
      streamingToolCalls: [],
      streamingActivities: [],
      streamingParts: [],
      isSending: true,
    }),

  appendStreamingText: (text) =>
    set((state) => {
      const parts = [...state.streamingParts];
      const last = parts[parts.length - 1];
      if (last && last.type === 'text') {
        // Append to existing text segment
        parts[parts.length - 1] = { ...last, content: (last as { content: string }).content + text };
      } else {
        // Start a new text segment
        parts.push({ type: 'text' as const, content: text });
      }
      return { streamingText: state.streamingText + text, streamingParts: parts };
    }),

  setStreamingBlocks: (blocks) =>
    set((state) => {
      // Replace content blocks in parts (remove old ones, append new)
      const parts: DisplayBlock[] = state.streamingParts.filter(
        (p) => p.type === 'text' || p.type === 'tool_call' || p.type === 'activity',
      );
      for (const b of blocks) {
        parts.push(b as DisplayBlock);
      }
      return { streamingBlocks: blocks, streamingParts: parts };
    }),

  addToolCall: (tc) =>
    set((state) => ({
      streamingToolCalls: [...state.streamingToolCalls, tc],
      streamingParts: [...state.streamingParts, tc as DisplayBlock],
    })),

  updateToolCallStatus: (id, status) =>
    set((state) => {
      const updateTc = (tc: ToolCallBlock) => (tc.id === id ? { ...tc, status } : tc);
      return {
        streamingToolCalls: state.streamingToolCalls.map(updateTc),
        streamingParts: state.streamingParts.map((p): DisplayBlock =>
          p.type === 'tool_call' ? updateTc(p as ToolCallBlock) : p,
        ),
      };
    }),

  updateToolCallResult: (id, result, isError) =>
    set((state) => {
      const updateTc = (tc: ToolCallBlock) =>
        tc.id === id
          ? { ...tc, result, isError, status: isError ? ('error' as const) : ('completed' as const) }
          : tc;
      return {
        streamingToolCalls: state.streamingToolCalls.map(updateTc),
        streamingParts: state.streamingParts.map((p): DisplayBlock =>
          p.type === 'tool_call' ? updateTc(p as ToolCallBlock) : p,
        ),
      };
    }),

  addActivity: (activity) =>
    set((state) => ({
      streamingActivities: [...state.streamingActivities, activity],
      streamingParts: [...state.streamingParts, activity as DisplayBlock],
    })),

  finalizeStreaming: (conversationId) => {
    const { streamingParts, streamingText } = get();
    // Use the ordered parts as blocks — text segments are already text blocks.
    // Filter out empty text segments.
    const blocks = streamingParts.filter(
      (p) => !(p.type === 'text' && !(p as { content: string }).content),
    );
    const content = streamingText || '';
    const assistantMessage: Message = {
      role: 'assistant',
      content,
      blocks: blocks.length > 0 ? blocks : undefined,
    };
    if (content || blocks.length > 0) {
      get().addMessage(conversationId, assistantMessage);
    }
    set({
      isStreaming: false,
      isSending: false,
      streamingText: '',
      streamingBlocks: [],
      streamingToolCalls: [],
      streamingActivities: [],
      streamingParts: [],
    });
  },

  clearStreaming: () =>
    set({
      isStreaming: false,
      isSending: false,
      streamingText: '',
      streamingBlocks: [],
      streamingToolCalls: [],
      streamingActivities: [],
      streamingParts: [],
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

  setFeedback: (conversationId, messageSeq, rating) =>
    set((state) => ({
      feedbackByMessage: {
        ...state.feedbackByMessage,
        [`${conversationId}:${messageSeq}`]: rating,
      },
    })),

  hydrateFeedback: (conversationId, feedback) =>
    set((state) => {
      const next = { ...state.feedbackByMessage };

      for (const key of Object.keys(next)) {
        if (key.startsWith(`${conversationId}:`)) {
          delete next[key];
        }
      }

      for (const item of feedback) {
        next[`${conversationId}:${item.messageSeq}`] = item.rating;
      }

      return { feedbackByMessage: next };
    }),

  getFeedback: (conversationId, messageSeq) => {
    return get().feedbackByMessage[`${conversationId}:${messageSeq}`];
  },

  addDevEvent: (event) =>
    set((state) => ({
      // Keep last 200 events to prevent unbounded growth
      devEvents: [...state.devEvents.slice(-199), event],
    })),

  setLastUsage: (usage) => set({ lastUsage: usage }),

  clearDevEvents: () => set({ devEvents: [], lastUsage: null }),
}));
