"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { CodeBlock as CodeBlockType } from "@/lib/block-types";

export function CodeBlock({ block }: { block: CodeBlockType }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(block.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border bg-zinc-950 text-zinc-50 overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5 text-xs text-zinc-400">
        <span>{block.language ?? "plaintext"}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-zinc-200 transition-colors"
        >
          {copied ? (
            <>
              <Check className="size-3" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-sm leading-relaxed">
        <code>{block.code}</code>
      </pre>
    </div>
  );
}
