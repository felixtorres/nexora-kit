"use client";

export function StreamingIndicator() {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium">
        AI
      </div>
      <div className="flex items-center gap-1 pt-2">
        <span className="size-2 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:0ms]" />
        <span className="size-2 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:150ms]" />
        <span className="size-2 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:300ms]" />
      </div>
    </div>
  );
}
