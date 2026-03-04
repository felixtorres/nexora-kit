'use client';

import { useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { MessageThread } from '@/components/chat/message-thread';
import { MessageInput } from '@/components/chat/message-input';
import { useConversationStore } from '@/store/conversation';
import { useWebSocket } from '@/hooks/use-websocket';
import { useSendMessage, normalizeMessage } from '@/hooks/use-conversation';
import { api } from '@/lib/api';

export default function ConversationPage() {
  const params = useParams();
  const conversationId = params.conversationId as string;
  const queryClient = useQueryClient();
  const { setActiveConversation, setMessages, isSending, isStreaming } = useConversationStore();
  const sendMessageRest = useSendMessage();
  const { sendMessage: sendMessageWs, sendAction, cancel, isConnected } = useWebSocket(conversationId);

  useEffect(() => {
    setActiveConversation(conversationId);

    // Load message history from the server
    api.messages
      .list(conversationId)
      .then((res) => {
        setMessages(conversationId, res.messages.map(normalizeMessage));
      })
      .catch(() => {
        // Server may not have message store configured — start fresh
      });

    return () => setActiveConversation(null);
  }, [conversationId, setActiveConversation, setMessages]);

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
    [isConnected, sendMessageWs, sendMessageRest, conversationId, queryClient]
  );

  const handleAction = useCallback(
    (actionId: string, payload: Record<string, unknown>) => {
      sendAction(actionId, payload);
    },
    [sendAction]
  );

  const handleReply = useCallback(
    (text: string) => {
      handleSend(text);
    },
    [handleSend]
  );

  return (
    <div className="flex flex-1 flex-col">
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
}
