'use client';

import { useState } from 'react';
import { ChevronRight, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { ToolCallBlock as ToolCallBlockType } from '@/lib/block-types';

function formatToolName(name: string): string {
  // "@ns/server.tool_name" → "tool_name" or "data-agent__dbinsight_generate_context" → "generate_context"
  const lastDot = name.lastIndexOf('.');
  const lastDunder = name.lastIndexOf('__');
  if (lastDot !== -1) return name.slice(lastDot + 1);
  if (lastDunder !== -1) return name.slice(lastDunder + 2);
  return name;
}

function StatusIcon({ status }: { status: ToolCallBlockType['status'] }) {
  switch (status) {
    case 'executing':
      return <Loader2 className="size-4 animate-spin text-blue-500" />;
    case 'completed':
      return <CheckCircle2 className="size-4 text-green-500" />;
    case 'error':
      return <XCircle className="size-4 text-red-500" />;
  }
}

export function ToolCallBlock({ block }: { block: ToolCallBlockType }) {
  const [open, setOpen] = useState(false);
  const displayName = formatToolName(block.name);
  const hasContent = block.input || block.result;

  return (
    <div className="rounded-lg border bg-muted/10">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/20 transition-colors"
        onClick={() => hasContent && setOpen(!open)}
        disabled={!hasContent}
      >
        <ChevronRight
          className={`size-3.5 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''} ${!hasContent ? 'invisible' : ''}`}
        />
        <StatusIcon status={block.status} />
        <span className="font-mono text-xs text-muted-foreground">{displayName}</span>
        {block.status === 'executing' && (
          <span className="text-xs text-muted-foreground/60">Running...</span>
        )}
      </button>

      {open && hasContent && (
        <div className="border-t px-3 py-2 space-y-2">
          {block.input && Object.keys(block.input).length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Input</div>
              <pre className="overflow-x-auto rounded bg-muted/30 px-2 py-1.5 text-xs font-mono">
                {JSON.stringify(block.input, null, 2)}
              </pre>
            </div>
          )}
          {block.result && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">
                {block.isError ? 'Error' : 'Result'}
              </div>
              <pre className={`overflow-x-auto rounded px-2 py-1.5 text-xs font-mono whitespace-pre-wrap break-words max-h-60 overflow-y-auto ${block.isError ? 'bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-200' : 'bg-muted/30'}`}>
                {block.result.length > 2000 ? block.result.slice(0, 2000) + '\n... (truncated)' : block.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
