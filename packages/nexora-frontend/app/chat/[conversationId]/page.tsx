"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { MessageThread } from "@/components/chat/message-thread";
import { MessageInput } from "@/components/chat/message-input";
import { useConversationStore } from "@/store/conversation";
import { useSendMessage } from "@/hooks/use-conversation";
import { api } from "@/lib/api";

export default function ConversationPage() {
  const params = useParams();
  const conversationId = params.conversationId as string;
  const { setActiveConversation, setMessages, isSending } =
    useConversationStore();
  const sendMessage = useSendMessage();

  useEffect(() => {
    setActiveConversation(conversationId);

    // Load message history from the server
    api.messages
      .list(conversationId)
      .then((res) => {
        setMessages(conversationId, res.messages);
      })
      .catch(() => {
        // Server may not have message store configured — start fresh
      });

    return () => setActiveConversation(null);
  }, [conversationId, setActiveConversation, setMessages]);

  const handleSend = (input: string) => {
    sendMessage.mutate({ conversationId, input });
  };

  return (
    <div className="flex flex-1 flex-col">
      <MessageThread conversationId={conversationId} />
      <MessageInput onSend={handleSend} disabled={isSending} />
    </div>
  );
}
