'use client';

import type { DisplayBlock } from '@/lib/block-types';
import { TextBlock } from './text-block';
import { CodeBlock } from './code-block';
import { TableBlock } from './table-block';
import { ImageBlock } from './image-block';
import { ActionBlock } from './action-block';
import { CardBlock } from './card-block';
import { FormBlock } from './form-block';
import { ProgressBlock } from './progress-block';
import { SuggestedRepliesBlock } from './suggested-replies-block';

interface BlockRendererProps {
  block: DisplayBlock;
  allBlocks?: DisplayBlock[];
  index?: number;
  onAction?: (actionId: string, payload: Record<string, unknown>) => void;
  onReply?: (text: string) => void;
}

const noop = () => {};

export function BlockRenderer({ block, allBlocks, index, onAction, onReply }: BlockRendererProps) {
  switch (block.type) {
    case 'text':
      return <TextBlock block={block} />;
    case 'code':
      return <CodeBlock block={block} allBlocks={allBlocks} index={index} />;
    case 'table':
      return <TableBlock block={block} />;
    case 'image':
      return <ImageBlock block={block} />;
    case 'action':
      return <ActionBlock block={block} onAction={onAction ?? noop} />;
    case 'card':
      return <CardBlock block={block} onAction={onAction ?? noop} />;
    case 'form':
      return <FormBlock block={block} onAction={onAction ?? noop} />;
    case 'progress':
      return <ProgressBlock block={block} />;
    case 'suggested_replies':
      return <SuggestedRepliesBlock block={block} onReply={onReply ?? noop} />;
    case 'error':
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {block.message}
        </div>
      );
    default: {
      // Custom blocks (custom:*) — render as collapsible JSON viewer
      const customBlock = block as { type: string; data: unknown };
      if (customBlock.type.startsWith('custom:')) {
        return (
          <details className="rounded-lg border bg-muted/20">
            <summary className="cursor-pointer px-4 py-2 text-xs font-mono text-muted-foreground">
              {customBlock.type}
            </summary>
            <pre className="overflow-x-auto px-4 py-2 text-xs">
              {JSON.stringify(customBlock.data, null, 2)}
            </pre>
          </details>
        );
      }
      return (
        <div className="rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground">
          Unsupported block type: {(block as { type: string }).type}
        </div>
      );
    }
  }
}
