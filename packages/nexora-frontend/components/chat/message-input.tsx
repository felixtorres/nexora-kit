"use client";

import { useState, useCallback, type KeyboardEvent } from "react";
import { SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MessageInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [input, setInput] = useState("");

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput("");
  }, [input, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="border-t bg-background p-4">
      <div className="relative mx-auto max-w-3xl">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
          disabled={disabled}
          rows={1}
          className="w-full resize-none rounded-lg border bg-muted/30 px-4 py-3 pr-12 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <Button
          size="icon"
          variant="ghost"
          className="absolute bottom-2 right-2 size-8"
          onClick={handleSend}
          disabled={disabled || !input.trim()}
        >
          <SendHorizontal className="size-4" />
        </Button>
      </div>
    </div>
  );
}
