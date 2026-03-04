'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { TextBlock as TextBlockType } from '@/lib/block-types';

const components: Components = {
  // Inline code — distinct pill style
  code({ className, children, ...props }) {
    const isBlock = /language-(\w+)/.test(className ?? '');
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8em] text-foreground"
        {...props}
      >
        {children}
      </code>
    );
  },
  // Fenced code blocks — dark terminal style matching CodeBlock component
  pre({ children }) {
    return (
      <pre className="rounded-lg border bg-zinc-950 p-3 text-sm leading-relaxed overflow-x-auto not-prose">
        {children}
      </pre>
    );
  },
};

export function TextBlock({ block }: { block: TextBlockType }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-p:my-2 prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-li:my-0.5 prose-pre:p-0 prose-pre:bg-transparent prose-pre:border-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {block.content}
      </ReactMarkdown>
    </div>
  );
}
