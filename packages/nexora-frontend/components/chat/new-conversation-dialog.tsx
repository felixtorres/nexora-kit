"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAgentList, useCreateConversation } from "@/hooks/use-conversation";

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}

export function NewConversationDialog({
  open,
  onOpenChange,
  onCreated,
}: NewConversationDialogProps) {
  const [title, setTitle] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const { data: agentData, isLoading: agentsLoading } = useAgentList();
  const createMutation = useCreateConversation();

  const agents = agentData?.agents ?? [];

  const handleCreate = async () => {
    const data: { title?: string; agentId?: string } = {};
    if (title.trim()) data.title = title.trim();
    if (selectedAgentId) data.agentId = selectedAgentId;

    const conversation = await createMutation.mutateAsync(data);
    setTitle("");
    setSelectedAgentId("");
    onOpenChange(false);
    onCreated(conversation.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Conversation</DialogTitle>
          <DialogDescription>
            Start a new conversation. Optionally select an agent to chat with.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="conv-title">Title (optional)</Label>
            <Input
              id="conv-title"
              placeholder="e.g. Debug login issue"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-select">Agent</Label>
            {agentsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading agents...
              </div>
            ) : agents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No agents found. A default agent will be used.
              </p>
            ) : (
              <select
                id="agent-select"
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Default (no agent)</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} ({agent.slug})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending && (
              <Loader2 className="mr-2 size-4 animate-spin" />
            )}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
