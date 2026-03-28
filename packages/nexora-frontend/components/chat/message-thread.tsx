'use client';

import { useEffect, useRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Bot, User } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BlockRenderer } from './blocks/block-renderer';
import { MessageFeedback } from './message-feedback';
import { StreamingIndicator } from './streaming-indicator';
import { VizRunner } from './blocks/viz-runner';
import { detectVizKind } from '@/lib/pyodide';
import { useConversationStore } from '@/store/conversation';
import type { Message, DisplayBlock } from '@/lib/block-types';

/**
 * ReactMarkdown passes `children` as a React node, not a plain string.
 * Recursively extract the text content so VizRunner always receives a string.
 */
function extractText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node && typeof node === 'object' && 'props' in (node as object)) {
    return extractText((node as { props: { children?: unknown } }).props.children);
  }
  return '';
}

const markdownComponents: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className ?? '');
    const isBlock = match !== null;
    const content = extractText(children).replace(/\n$/, '');

    if (isBlock) {
      const isPython = match![1] === 'python';
      const isViz = isPython && detectVizKind(content) !== null;

      return (
        <div>
          <code className={className} {...props}>
            {children}
          </code>
          {isViz && <VizRunner code={content} />}
        </div>
      );
    }

    // Inline code
    return (
      <code
        className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8em] text-foreground"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre({ children }) {
    return (
      <pre className="rounded-lg border bg-zinc-950 p-3 text-sm leading-relaxed overflow-x-auto not-prose">
        {children}
      </pre>
    );
  },
};

interface MessageBubbleProps {
  message: Message;
  conversationId?: string;
  messageSeq?: number;
  onAction?: (actionId: string, payload: Record<string, unknown>) => void;
  onReply?: (text: string) => void;
}

/** Content block types that already represent the response text */
const CONTENT_BLOCK_TYPES = new Set(['text', 'code', 'table', 'card', 'image', 'form']);

function MessageBubble({
  message,
  conversationId,
  messageSeq,
  onAction,
  onReply,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const blocks = message.blocks && message.blocks.length > 0 ? message.blocks : null;

  // Show raw text content only when blocks don't already cover it.
  // Activity blocks and tool_call blocks are metadata — the text IS the response.
  // But text/code/table/card etc. blocks already contain the formatted response.
  const hasContentBlocks = blocks?.some((b) => CONTENT_BLOCK_TYPES.has(b.type)) ?? false;
  const showText = !!message.content && !hasContentBlocks;

  return (
    <div className={`flex items-start gap-3 px-4 py-4 ${isUser ? '' : 'bg-muted/30'}`}>
      {/* Avatar */}
      <div
        className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ring-1 ring-border ${
          isUser ? 'bg-secondary text-secondary-foreground' : 'bg-primary text-primary-foreground'
        }`}
      >
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-3 pt-0.5">
        {blocks &&
          blocks.map((block: DisplayBlock, i: number) => (
            <BlockRenderer
              key={i}
              block={block}
              allBlocks={message.blocks}
              index={i}
              onAction={onAction}
              onReply={onReply}
            />
          ))}
        {showText && (
          <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-p:my-2 prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-li:my-0.5 prose-pre:p-0 prose-pre:bg-transparent prose-pre:border-0">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={markdownComponents}
            >
              {typeof message.content === 'string' ? message.content : ''}
            </ReactMarkdown>
          </div>
        )}
        {!isUser && conversationId != null && messageSeq != null && (
          <MessageFeedback conversationId={conversationId} messageSeq={messageSeq} />
        )}
      </div>
    </div>
  );
}

const EMPTY: Message[] = [];

interface MessageThreadProps {
  conversationId: string;
  onAction?: (actionId: string, payload: Record<string, unknown>) => void;
  onReply?: (text: string) => void;
}

export function MessageThread({ conversationId, onAction, onReply }: MessageThreadProps) {
  const messages = useConversationStore((s) => s.messagesByConversation[conversationId]) ?? EMPTY;
  const isSending = useConversationStore((s) => s.isSending);
  const isStreaming = useConversationStore((s) => s.isStreaming);
  const streamingText = useConversationStore((s) => s.streamingText);
  const streamingBlocks = useConversationStore((s) => s.streamingBlocks);
  const streamingToolCalls = useConversationStore((s) => s.streamingToolCalls);
  const streamingActivities = useConversationStore((s) => s.streamingActivities);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const getViewport = () =>
    scrollAreaRef.current?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');

  // Scroll instantly on every streaming token — smooth scroll re-triggers its
  // animation on each update which causes the viewport to jitter upward.
  useEffect(() => {
    const viewport = getViewport();
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'instant' });
    }
  }, [streamingText, streamingBlocks, streamingToolCalls, streamingActivities]);

  // Smooth scroll only when a completed message lands or sending state changes.
  useEffect(() => {
    const viewport = getViewport();
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, isSending]);

  if (messages.length === 0 && !isSending) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <p className="text-sm">Send a message to start the conversation.</p>
      </div>
    );
  }

  return (
    <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!min-w-0">
      <div className="divide-y">
        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            message={msg}
            conversationId={conversationId}
            messageSeq={i}
            onAction={onAction}
            onReply={onReply}
          />
        ))}

        {/* Streaming assistant response */}
        {isStreaming &&
          (streamingText ||
            streamingBlocks.length > 0 ||
            streamingToolCalls.length > 0 ||
            streamingActivities.length > 0) && (
            <MessageBubble
              message={{
                role: 'assistant',
                content: streamingText,
                blocks: (() => {
                  const all = [
                    ...streamingActivities,
                    ...streamingToolCalls,
                    ...(streamingBlocks.length > 0 ? streamingBlocks : []),
                  ];
                  return all.length > 0 ? all : undefined;
                })(),
              }}
              onAction={onAction}
              onReply={onReply}
            />
          )}

        {/* Show dots only when streaming hasn't produced content yet */}
        {isSending && !isStreaming && <StreamingIndicator />}
        {isStreaming &&
          !streamingText &&
          streamingBlocks.length === 0 &&
          streamingActivities.length === 0 && <StreamingIndicator />}
      </div>
    </ScrollArea>
  );
}
