'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useSettings } from '@/store/settings';
import { useConversationStore } from '@/store/conversation';
import type { ResponseBlock } from '@/lib/block-types';

export type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface WsEvent {
  type: string;
  conversationId?: string;
  payload?: Record<string, unknown>;
  message?: string;
}

const PING_INTERVAL = 25_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export function useWebSocket(conversationId: string | null) {
  const serverUrl = useSettings((s) => s.serverUrl);
  const apiKey = useSettings((s) => s.apiKey);

  const {
    startStreaming,
    appendStreamingText,
    setStreamingBlocks,
    finalizeStreaming,
    clearStreaming,
    addMessage,
    initArtifact,
    appendArtifactDelta,
    markArtifactDone,
    addDevEvent,
    setLastUsage,
  } = useConversationStore();

  const wsRef = useRef<WebSocket | null>(null);
  const statusRef = useRef<WsStatus>('disconnected');
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;

  const cleanup = useCallback(() => {
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!serverUrl || !conversationIdRef.current) return;

    cleanup();
    statusRef.current = 'connecting';

    const wsUrl = serverUrl.replace(/^http/, 'ws').replace(/\/$/, '');
    const params = apiKey ? `?token=${encodeURIComponent(apiKey)}` : '';
    const ws = new WebSocket(`${wsUrl}/v1/ws${params}`);
    wsRef.current = ws;

    ws.onopen = () => {
      statusRef.current = 'connected';
      reconnectAttemptRef.current = 0;

      // Start ping keepalive
      pingTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL);
    };

    ws.onmessage = (event) => {
      let data: WsEvent;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      // Record all received events for Dev Panel (skip pong/ping noise)
      if (data.type !== 'pong') {
        addDevEvent({ direction: 'received', timestamp: Date.now(), data });
      }

      const cid = conversationIdRef.current;
      if (!cid) return;

      switch (data.type) {
        case 'text': {
          const content = (data.payload as { content?: string })?.content ?? '';
          appendStreamingText(content);
          break;
        }
        case 'blocks': {
          const blocks = (data.payload as { blocks?: ResponseBlock[] })?.blocks ?? [];
          setStreamingBlocks(blocks);
          break;
        }
        case 'done': {
          finalizeStreaming(cid);
          break;
        }
        case 'cancelled': {
          // Finalize with whatever partial content we have
          finalizeStreaming(cid);
          break;
        }
        case 'error': {
          const errorMsg = (data.payload as { message?: string })?.message ?? data.message ?? 'Unknown error';
          // Add error as a frontend-only error block message
          addMessage(cid, {
            role: 'assistant',
            content: '',
            blocks: [{ type: 'error' as const, message: errorMsg }],
          });
          clearStreaming();
          break;
        }
        case 'conversation': {
          // Server assigned/confirmed conversation ID — no action needed for operator WS
          break;
        }
        case 'usage': {
          const p = data.payload as { inputTokens?: number; outputTokens?: number } | undefined;
          if (p) {
            setLastUsage({
              inputTokens: p.inputTokens ?? 0,
              outputTokens: p.outputTokens ?? 0,
            });
          }
          break;
        }
        case 'artifact_create': {
          const p = data.payload as { artifactId?: string; title?: string; content?: string } | undefined;
          if (p?.artifactId) {
            initArtifact(p.artifactId, p.title ?? '', p.content ?? '');
          }
          break;
        }
        case 'artifact_stream': {
          const p = data.payload as { artifactId?: string; delta?: string } | undefined;
          if (p?.artifactId && p.delta) {
            appendArtifactDelta(p.artifactId, p.delta);
          }
          break;
        }
        case 'artifact_done': {
          const p = data.payload as { artifactId?: string } | undefined;
          if (p?.artifactId) {
            markArtifactDone(p.artifactId);
          }
          break;
        }
        case 'pong':
          break;
      }
    };

    ws.onerror = () => {
      statusRef.current = 'error';
    };

    ws.onclose = () => {
      statusRef.current = 'disconnected';
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }

      // Reconnect with exponential backoff
      const delay = Math.min(
        RECONNECT_BASE_MS * 2 ** reconnectAttemptRef.current,
        RECONNECT_MAX_MS
      );
      reconnectAttemptRef.current++;
      reconnectTimerRef.current = setTimeout(() => {
        if (conversationIdRef.current) connect();
      }, delay);
    };
  }, [
    serverUrl,
    apiKey,
    cleanup,
    startStreaming,
    appendStreamingText,
    setStreamingBlocks,
    finalizeStreaming,
    clearStreaming,
    addMessage,
    initArtifact,
    appendArtifactDelta,
    markArtifactDone,
    addDevEvent,
    setLastUsage,
  ]);

  // Connect when conversationId is set and serverUrl exists
  useEffect(() => {
    if (conversationId && serverUrl) {
      connect();
    }
    return cleanup;
  }, [conversationId, serverUrl, connect, cleanup]);

  const sendMessage = useCallback(
    (input: string) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      if (!conversationIdRef.current) return;

      // Add user message to store
      addMessage(conversationIdRef.current, { role: 'user', content: input });
      startStreaming();

      const msg = {
        type: 'chat',
        conversationId: conversationIdRef.current,
        input,
      };
      addDevEvent({ direction: 'sent', timestamp: Date.now(), data: msg });
      wsRef.current.send(JSON.stringify(msg));
    },
    [addMessage, startStreaming, addDevEvent]
  );

  const sendAction = useCallback(
    (actionId: string, payload: Record<string, unknown>) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      if (!conversationIdRef.current) return;

      startStreaming();

      const msg = {
        type: 'chat',
        conversationId: conversationIdRef.current,
        input: { type: 'action', actionId, payload },
      };
      addDevEvent({ direction: 'sent', timestamp: Date.now(), data: msg });
      wsRef.current.send(JSON.stringify(msg));
    },
    [startStreaming, addDevEvent]
  );

  const cancel = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!conversationIdRef.current) return;

    const msg = { type: 'cancel', conversationId: conversationIdRef.current };
    addDevEvent({ direction: 'sent', timestamp: Date.now(), data: msg });
    wsRef.current.send(JSON.stringify(msg));
  }, [addDevEvent]);

  const isConnected = statusRef.current === 'connected';

  return { sendMessage, sendAction, cancel, isConnected };
}
