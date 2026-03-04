"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ConversationList } from "@/components/chat/conversation-list";
import { NewConversationDialog } from "@/components/chat/new-conversation-dialog";

export default function ChatLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="-m-4 flex h-[calc(100vh-3.5rem)]">
      <ConversationList onNewConversation={() => setDialogOpen(true)} />
      <div className="flex flex-1 flex-col">{children}</div>
      <NewConversationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(id) => router.push(`/chat/${id}`)}
      />
    </div>
  );
}
