"use client";

import { useRouter, useParams } from "next/navigation";
import { Plus, MessageSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useConversationList } from "@/hooks/use-conversation";
import type { ConversationRecord } from "@/lib/block-types";

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

interface ConversationListProps {
  onNewConversation: () => void;
}

export function ConversationList({ onNewConversation }: ConversationListProps) {
  const router = useRouter();
  const params = useParams();
  const activeId = params?.conversationId as string | undefined;
  const { data, isLoading } = useConversationList();

  const conversations = data?.items ?? [];

  return (
    <div className="flex h-full w-64 flex-col border-r bg-muted/20">
      <div className="flex items-center justify-between border-b p-3">
        <h2 className="text-sm font-semibold">Conversations</h2>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={onNewConversation}
        >
          <Plus className="size-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            No conversations yet.
            <br />
            Click + to start one.
          </div>
        ) : (
          <div className="space-y-0.5 p-1.5">
            {conversations.map((conv: ConversationRecord) => (
              <button
                key={conv.id}
                onClick={() => router.push(`/chat/${conv.id}`)}
                className={`flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent ${
                  activeId === conv.id
                    ? "bg-accent text-accent-foreground"
                    : ""
                }`}
              >
                <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {conv.title || "New conversation"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {conv.messageCount} messages &middot;{" "}
                    {formatTime(conv.updatedAt)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
