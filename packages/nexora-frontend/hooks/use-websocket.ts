'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useSettings, useSettingsHydrated } from '@/store/settings';
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
  const hydrated = useSettingsHydrated();

  // Store actions behind a ref so connect() has a stable identity.
  // Zustand actions are stable, but listing 15 deps makes the useCallback
  // fragile and triggers reconnects on any subtle reference change.
  const storeRef = useRef(useConversationStore.getState());
  useEffect(() => {
    // Keep ref current — Zustand actions are stable so this is cheap
    storeRef.current = useConversationStore.getState();
  });

  const wsRef = useRef<WebSocket | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversationIdRef = useRef(conversationId);
  const [isConnected, setIsConnected] = useState(false);

  // Keep conversationId ref in sync
  useEffect(() => {
    conversationIdRef.current = conversationId;
  });

  const cleanupWs = useCallback(() => {
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

  // Stable connect function — only depends on serverUrl and apiKey (primitives).
  // All store interactions go through storeRef.
  const connectRef = useRef<() => void>(() => {});

  useEffect(() => {
    connectRef.current = () => {
      if (!serverUrl || !apiKey || !conversationIdRef.current) return;

      cleanupWs();

      const wsUrl = serverUrl
        .replace(/^http/, 'ws')
        .replace(/\/$/, '')
        .replace(/\/\/localhost([:\/])/, '//127.0.0.1$1');
      const fullUrl = `${wsUrl}/v1/ws?token=${encodeURIComponent(apiKey)}`;
      console.log(`[nexora-ws] connecting to ${wsUrl}/v1/ws`);
      const ws = new WebSocket(fullUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[nexora-ws] connected');
        setIsConnected(true);
        reconnectAttemptRef.current = 0;

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

        const s = storeRef.current;

        if (data.type !== 'pong') {
          s.addDevEvent({ direction: 'received', timestamp: Date.now(), data });
        }

        const cid = conversationIdRef.current;
        if (!cid) return;

        switch (data.type) {
          case 'text': {
            const content = (data.payload as { content?: string })?.content ?? '';
            s.appendStreamingText(content);
            break;
          }
          case 'blocks': {
            const blocks = (data.payload as { blocks?: ResponseBlock[] })?.blocks ?? [];
            s.setStreamingBlocks(blocks);
            break;
          }
          case 'done': {
            s.finalizeStreaming(cid);
            break;
          }
          case 'cancelled': {
            s.finalizeStreaming(cid);
            break;
          }
          case 'error': {
            const errorMsg = (data.payload as { message?: string })?.message ?? data.message ?? 'Unknown error';
            s.addMessage(cid, {
              role: 'assistant',
              content: '',
              blocks: [{ type: 'error' as const, message: errorMsg }],
            });
            s.clearStreaming();
            break;
          }
          case 'conversation':
            break;
          case 'usage': {
            const p = data.payload as { inputTokens?: number; outputTokens?: number } | undefined;
            if (p) {
              s.setLastUsage({
                inputTokens: p.inputTokens ?? 0,
                outputTokens: p.outputTokens ?? 0,
              });
            }
            break;
          }
          case 'artifact_create': {
            const p = data.payload as { artifactId?: string; title?: string; content?: string } | undefined;
            if (p?.artifactId) {
              s.initArtifact(p.artifactId, p.title ?? '', p.content ?? '');
            }
            break;
          }
          case 'artifact_stream': {
            const p = data.payload as { artifactId?: string; delta?: string } | undefined;
            if (p?.artifactId && p.delta) {
              s.appendArtifactDelta(p.artifactId, p.delta);
            }
            break;
          }
          case 'artifact_done': {
            const p = data.payload as { artifactId?: string } | undefined;
            if (p?.artifactId) {
              s.markArtifactDone(p.artifactId);
            }
            break;
          }
          case 'tool_call': {
            const p = data.payload as { id?: string; name?: string; input?: Record<string, unknown> } | undefined;
            if (p?.id && p?.name) {
              s.addToolCall({
                type: 'tool_call',
                id: p.id,
                name: p.name,
                input: p.input,
                status: 'executing',
              });
            }
            break;
          }
          case 'tool_status': {
            const p = data.payload as { id?: string; status?: string } | undefined;
            if (p?.id && p?.status) {
              s.updateToolCallStatus(p.id, p.status as 'executing' | 'completed' | 'error');
            }
            break;
          }
          case 'tool_result': {
            const p = data.payload as { toolUseId?: string; content?: string; isError?: boolean } | undefined;
            if (p?.toolUseId) {
              s.updateToolCallResult(p.toolUseId, p.content ?? '', p.isError);
            }
            break;
          }
          case 'turn_start': {
            const p = data.payload as { turn?: number; maxTurns?: number } | undefined;
            if (p?.turn) {
              s.addActivity({
                type: 'activity', event: 'turn_start',
                label: `Turn ${p.turn}/${p.maxTurns ?? '?'}`,
                timestamp: Date.now(),
              });
            }
            break;
          }
          case 'turn_continue': {
            const p = data.payload as { currentTurn?: number; additionalTurns?: number } | undefined;
            if (p) {
              s.addActivity({
                type: 'activity', event: 'turn_continue',
                label: `Extended by ${p.additionalTurns ?? 0} turns`,
                timestamp: Date.now(),
              });
            }
            break;
          }
          case 'compaction': {
            const p = data.payload as { compactedMessages?: number; summaryTokens?: number } | undefined;
            if (p) {
              s.addActivity({
                type: 'activity', event: 'compaction',
                label: `Compacted ${p.compactedMessages ?? 0} messages`,
                detail: p.summaryTokens ? `${p.summaryTokens} token summary` : undefined,
                timestamp: Date.now(),
              });
            }
            break;
          }
          case 'sub_agent_start': {
            const p = data.payload as { agentId?: string; task?: string } | undefined;
            if (p?.agentId) {
              s.addActivity({
                type: 'activity', event: 'sub_agent_start',
                label: `Sub-agent: ${p.task ?? 'working'}`,
                detail: p.agentId,
                timestamp: Date.now(),
              });
            }
            break;
          }
          case 'sub_agent_end': {
            const p = data.payload as { agentId?: string; tokensUsed?: number } | undefined;
            if (p?.agentId) {
              s.addActivity({
                type: 'activity', event: 'sub_agent_end',
                label: `Sub-agent done`,
                detail: p.tokensUsed ? `${p.tokensUsed} tokens` : undefined,
                timestamp: Date.now(),
              });
            }
            break;
          }
          case 'thinking': {
            const content = (data.payload as { content?: string })?.content ?? '';
            if (content) {
              s.addActivity({
                type: 'activity', event: 'thinking',
                label: 'Thinking',
                detail: content,
                timestamp: Date.now(),
              });
            }
            break;
          }
          case 'pong':
            break;
        }
      };

      ws.onerror = (e) => {
        console.error('[nexora-ws] connection error', e);
        setIsConnected(false);
      };

      ws.onclose = (e) => {
        console.warn(`[nexora-ws] closed code=${e.code} reason=${e.reason || '(none)'} url=${ws.url}`);
        setIsConnected(false);
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
          if (conversationIdRef.current) connectRef.current();
        }, delay);
      };
    };
  }, [serverUrl, apiKey, cleanupWs]);

  // Main connection effect — stable deps, strict-mode safe.
  useEffect(() => {
    if (hydrated && conversationId && serverUrl && apiKey) {
      connectRef.current();
    }
    return cleanupWs;
  }, [hydrated, conversationId, serverUrl, apiKey, cleanupWs]);

  const sendMessage = useCallback(
    (input: string) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      if (!conversationIdRef.current) return;

      const s = storeRef.current;
      s.addMessage(conversationIdRef.current, { role: 'user', content: input });
      s.startStreaming();

      const msg = {
        type: 'chat',
        conversationId: conversationIdRef.current,
        input,
      };
      s.addDevEvent({ direction: 'sent', timestamp: Date.now(), data: msg });
      wsRef.current.send(JSON.stringify(msg));
    },
    []
  );

  const sendAction = useCallback(
    (actionId: string, payload: Record<string, unknown>) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      if (!conversationIdRef.current) return;

      const s = storeRef.current;
      s.startStreaming();

      const msg = {
        type: 'chat',
        conversationId: conversationIdRef.current,
        input: { type: 'action', actionId, payload },
      };
      s.addDevEvent({ direction: 'sent', timestamp: Date.now(), data: msg });
      wsRef.current.send(JSON.stringify(msg));
    },
    []
  );

  const cancel = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!conversationIdRef.current) return;

    const s = storeRef.current;
    const msg = { type: 'cancel', conversationId: conversationIdRef.current };
    s.addDevEvent({ direction: 'sent', timestamp: Date.now(), data: msg });
    wsRef.current.send(JSON.stringify(msg));
  }, []);

  return { sendMessage, sendAction, cancel, isConnected };
}
