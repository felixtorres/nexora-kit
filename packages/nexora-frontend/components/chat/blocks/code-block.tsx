'use client';

import { useState, useEffect, useRef } from 'react';
import { Check, Copy } from 'lucide-react';
import hljs from 'highlight.js';
import type { CodeBlock as CodeBlockType, DisplayBlock } from '@/lib/block-types';
import { detectVizKind } from '@/lib/pyodide';
import { VizRunner } from './viz-runner';

interface CodeBlockProps {
  block: CodeBlockType;
  allBlocks?: DisplayBlock[];
  index?: number;
}

/** Walk backwards through allBlocks[0..index-1] to find the nearest TableBlock rows. */
function findPrecedingTableData(
  allBlocks: DisplayBlock[] | undefined,
  index: number | undefined,
): Record<string, unknown>[] | undefined {
  if (!allBlocks || index === undefined) return undefined;
  for (let i = index - 1; i >= 0; i--) {
    const b = allBlocks[i];
    if (b.type === 'table') return b.rows;
  }
  return undefined;
}

export function CodeBlock({ block, allBlocks, index }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  // Apply syntax highlighting after mount / when code changes
  useEffect(() => {
    const el = codeRef.current;
    if (!el) return;
    // Reset any previous highlight so hljs re-runs cleanly
    el.removeAttribute('data-highlighted');
    if (block.language) {
      try {
        const result = hljs.highlight(block.code, {
          language: block.language,
          ignoreIllegals: true,
        });
        el.innerHTML = result.value;
        return;
      } catch {
        // Unknown language — fall through to auto-detect
      }
    }
    hljs.highlightElement(el);
  }, [block.code, block.language]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(block.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const showRunner = block.language === 'python' && detectVizKind(block.code) !== null;
  const tableData = showRunner ? findPrecedingTableData(allBlocks, index) : undefined;

  return (
    <div>
      <div className="rounded-lg border bg-zinc-950 text-zinc-50 overflow-hidden">
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5 text-xs text-zinc-400">
          <span>{block.language ?? 'plaintext'}</span>
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
          <code ref={codeRef} className={block.language ? `language-${block.language}` : undefined}>
            {block.code}
          </code>
        </pre>
      </div>
      {showRunner && <VizRunner code={block.code} tableData={tableData} />}
    </div>
  );
}
