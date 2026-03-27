'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Code2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MessageThread } from '@/components/chat/message-thread';
import { MessageInput } from '@/components/chat/message-input';
import { DevPanel } from '@/components/chat/dev-panel';
import { SplitPane } from '@/components/app-preview/SplitPane';
import { AppPreviewFrame } from '@/components/app-preview/AppPreviewFrame';
import type { AppPreviewFrameRef } from '@/components/app-preview/AppPreviewFrame';
import { AppPreviewToolbar } from '@/components/app-preview/AppPreviewToolbar';
import { AppPreviewOverlay } from '@/components/app-preview/AppPreviewOverlay';
import { useAppPreview } from '@/hooks/use-app-preview';
import { useConversationStore } from '@/store/conversation';
import { useWebSocket } from '@/hooks/use-websocket';
import { useSendMessage, normalizeMessages } from '@/hooks/use-conversation';
import { useSettingsHydrated } from '@/store/settings';
import { api } from '@/lib/api';

export default function ConversationPage() {
  const params = useParams();
  const conversationId = params.conversationId as string;
  const queryClient = useQueryClient();
  const { setActiveConversation, setMessages, hydrateFeedback, isSending, isStreaming } =
    useConversationStore();
  const hydrated = useSettingsHydrated();
  const sendMessageRest = useSendMessage();
  const {
    sendMessage: sendMessageWs,
    sendAction,
    cancel,
    isConnected,
  } = useWebSocket(conversationId);
  const [showDevPanel, setShowDevPanel] = useState(false);
  const preview = useAppPreview();
  const previewFrameRef = useRef<AppPreviewFrameRef>(null);

  useEffect(() => {
    setActiveConversation(conversationId);

    // Don't fetch until settings are hydrated — apiKey would be empty otherwise
    if (!hydrated) return;

    // Load message history from the server
    api.messages
      .list(conversationId)
      .then((res) => {
        const visible = normalizeMessages(res.messages);
        setMessages(conversationId, visible);
      })
      .catch(() => {
        // Server may not have message store configured — start fresh
      });

    api.feedback
      .listConversation(conversationId)
      .then((res) => {
        hydrateFeedback(
          conversationId,
          res.items.map((item) => ({ messageSeq: item.messageSeq, rating: item.rating })),
        );
      })
      .catch(() => {
        // Older servers may not support feedback history yet
      });

    return () => setActiveConversation(null);
  }, [conversationId, hydrated, hydrateFeedback, setActiveConversation, setMessages]);

  const handleSend = useCallback(
    (input: string) => {
      if (isConnected) {
        sendMessageWs(input);
      } else {
        // Fallback to REST if WebSocket is not connected
        sendMessageRest.mutate({ conversationId, input });
      }
      // Refresh conversation list to update lastMessageAt
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    [isConnected, sendMessageWs, sendMessageRest, conversationId, queryClient],
  );

  const handleAction = useCallback(
    (actionId: string, payload: Record<string, unknown>) => {
      sendAction(actionId, payload);
    },
    [sendAction],
  );

  const handleReply = useCallback(
    (text: string) => {
      handleSend(text);
    },
    [handleSend],
  );

  const chatPanel = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Dev Panel toggle */}
      <div className="flex justify-end border-b px-2 py-1">
        <Button
          variant={showDevPanel ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => setShowDevPanel(!showDevPanel)}
        >
          <Code2 className="size-3.5" />
          Dev
        </Button>
      </div>
      <MessageThread
        conversationId={conversationId}
        onAction={handleAction}
        onReply={handleReply}
      />
      <MessageInput
        onSend={handleSend}
        onCancel={cancel}
        disabled={isSending}
        isStreaming={isStreaming}
      />
    </div>
  );

  const previewPanel = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <AppPreviewToolbar
        title={preview.currentTitle || 'Dashboard Preview'}
        onThemeToggle={() => previewFrameRef.current?.postPatch({ type: 'theme-change' })}
        onPopout={preview.popout}
        onClose={preview.closePreview}
      />
      {preview.currentHtml ? (
        <AppPreviewFrame ref={previewFrameRef} html={preview.currentHtml} />
      ) : (
        <AppPreviewOverlay state={preview.isLoading ? 'loading' : 'empty'} />
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1">
      <SplitPane
        mode={preview.mode}
        chatPanel={chatPanel}
        previewPanel={previewPanel}
      />
      {showDevPanel && <DevPanel isConnected={isConnected} />}
    </div>
  );
}
