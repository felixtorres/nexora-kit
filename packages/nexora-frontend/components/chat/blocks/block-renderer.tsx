'use client';

import type { ResponseBlock } from '@/lib/block-types';
import { TextBlock } from './text-block';
import { CodeBlock } from './code-block';

interface BlockRendererProps {
  block: ResponseBlock;
  /** All blocks in the message, used for sibling context (e.g. finding preceding table data). */
  allBlocks?: ResponseBlock[];
  index?: number;
}

export function BlockRenderer({ block, allBlocks, index }: BlockRendererProps) {
  switch (block.type) {
    case 'text':
      return <TextBlock block={block} />;
    case 'code':
      return <CodeBlock block={block} allBlocks={allBlocks} index={index} />;
    case 'error':
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {block.message}
        </div>
      );
    default:
      // Phase 3 will handle remaining block types
      return (
        <div className="rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground">
          Unsupported block type: {block.type}
        </div>
      );
  }
}
