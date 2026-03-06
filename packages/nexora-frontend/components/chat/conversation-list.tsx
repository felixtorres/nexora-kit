"use client";

import { useState, useRef, useCallback } from "react";
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

const MIN_WIDTH = 180;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 256;

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
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const isResizing = useRef(false);

  const conversations = data?.items ?? [];

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (e.clientX - startX)));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [width]);

  function handleDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteError(null);
    deleteConversation.mutate(id, {
      onSuccess: () => {
        if (activeId === id) router.push("/chat");
        setDeleteTarget(null);
      },
      onError: (err) => {
        setDeleteError(err instanceof Error ? err.message : "Failed to delete conversation");
      },
    });
  }

  return (
    <div className="relative flex h-full shrink-0" style={{ width }}>
      {/* Panel content */}
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-muted/20">
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

        <ScrollArea className="min-h-0 flex-1">
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
                      <p className="truncate text-xs text-muted-foreground">
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
      </div>

      {/* Resize handle */}
      <div
        className="z-10 w-[3px] shrink-0 cursor-col-resize border-r border-border transition-colors hover:border-primary hover:bg-primary/10 active:border-primary active:bg-primary/20"
        onMouseDown={handleMouseDown}
      />

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteError(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Conversation</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong>{deleteTarget?.title || "this conversation"}</strong>?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p className="text-sm text-destructive">{deleteError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteError(null); }}>
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
