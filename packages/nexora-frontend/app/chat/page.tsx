import { MessageSquare } from "lucide-react";

export default function ChatPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
      <MessageSquare className="size-12 opacity-30" />
      <h2 className="text-xl font-medium">Select a conversation</h2>
      <p className="text-sm">
        Pick a conversation from the sidebar or create a new one.
      </p>
    </div>
  );
}
