"use client";

import { useState, useCallback, useEffect, useRef, type KeyboardEvent } from "react";
import { SendHorizontal, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

interface CommandEntry {
  name: string;
  description: string;
}

interface MessageInputProps {
  onSend: (message: string) => void;
  onCancel?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
}

export function MessageInput({ onSend, onCancel, disabled, isStreaming }: MessageInputProps) {
  const [input, setInput] = useState("");
  const [commands, setCommands] = useState<CommandEntry[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const commandsFetched = useRef(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Fetch commands once on first `/` keystroke
  useEffect(() => {
    if (commandsFetched.current) return;
    if (!input.startsWith("/")) return;
    commandsFetched.current = true;
    api.commands.list().then((res) => setCommands(res.commands)).catch(() => {});
  }, [input]);

  // Show picker when typing `/`
  const filtered = input.startsWith("/")
    ? commands.filter((c) =>
        c.name.toLowerCase().includes(input.toLowerCase())
      )
    : [];

  useEffect(() => {
    setShowPicker(input.startsWith("/") && filtered.length > 0);
    setSelectedIndex(0);
  }, [input, filtered.length]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput("");
    setShowPicker(false);
  }, [input, disabled, onSend]);

  const selectCommand = useCallback(
    (cmd: CommandEntry) => {
      setInput(cmd.name + " ");
      setShowPicker(false);
    },
    []
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (showPicker && filtered.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          selectCommand(filtered[selectedIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setShowPicker(false);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, showPicker, filtered, selectedIndex, selectCommand]
  );

  return (
    <div className="border-t bg-background p-4">
      <div className="relative mx-auto max-w-3xl">
        {/* Slash command picker */}
        {showPicker && (
          <div
            ref={pickerRef}
            className="absolute bottom-full left-0 mb-1 w-full max-h-52 overflow-y-auto rounded-lg border bg-popover shadow-lg z-50"
          >
            {filtered.map((cmd, i) => (
              <button
                key={cmd.name}
                type="button"
                className={`flex w-full items-start gap-3 px-3 py-2 text-left text-sm transition-colors ${
                  i === selectedIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted/50"
                }`}
                onMouseEnter={() => setSelectedIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectCommand(cmd);
                }}
              >
                <span className="shrink-0 font-mono text-xs text-primary">{cmd.name}</span>
                <span className="text-xs text-muted-foreground">{cmd.description}</span>
              </button>
            ))}
          </div>
        )}

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (/ for commands)"
          disabled={disabled}
          rows={1}
          className="w-full resize-none rounded-lg border bg-muted/30 px-4 py-3 pr-24 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <div className="absolute bottom-2 right-2 flex items-center gap-1">
          {isStreaming && onCancel && (
            <Button
              size="icon"
              variant="outline"
              className="size-8 border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
              onClick={onCancel}
              title="Cancel"
            >
              <Square className="size-3.5" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={handleSend}
            disabled={disabled || !input.trim()}
          >
            <SendHorizontal className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
