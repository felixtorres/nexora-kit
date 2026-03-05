"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Plus, MessageSquare, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConversationList, useDeleteConversation } from "@/hooks/use-conversation";
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
  const deleteConversation = useDeleteConversation();
  const [deleteTarget, setDeleteTarget] = useState<ConversationRecord | null>(null);

  const conversations = data?.items ?? [];

  function handleDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    deleteConversation.mutate(id, {
      onSuccess: () => {
        if (activeId === id) router.push("/chat");
        setDeleteTarget(null);
      },
    });
  }

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
              <div
                key={conv.id}
                className={`group flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent ${
                  activeId === conv.id
                    ? "bg-accent text-accent-foreground"
                    : ""
                }`}
              >
                <button
                  className="flex min-w-0 flex-1 items-start gap-2"
                  onClick={() => router.push(`/chat/${conv.id}`)}
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
                <button
                  className="mt-0.5 shrink-0 rounded-sm p-0.5 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(conv);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Conversation</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong>{deleteTarget?.title || "this conversation"}</strong>?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteConversation.isPending}
            >
              {deleteConversation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
