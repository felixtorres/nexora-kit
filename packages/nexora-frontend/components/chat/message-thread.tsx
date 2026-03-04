'use client';

import { useEffect, useRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { User } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BlockRenderer } from './blocks/block-renderer';
import { StreamingIndicator } from './streaming-indicator';
import { VizRunner } from './blocks/viz-runner';
import { detectVizKind } from '@/lib/pyodide';
import { useConversationStore } from '@/store/conversation';
import type { Message } from '@/lib/block-types';

const markdownComponents: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className ?? '');
    const isBlock = match !== null;
    const content = String(children).replace(/\n$/, '');

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

    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex items-start gap-3 px-4 py-3 ${isUser ? '' : 'bg-muted/30'}`}>
      <div
        className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
          isUser ? 'bg-secondary text-secondary-foreground' : 'bg-primary text-primary-foreground'
        }`}
      >
        {isUser ? <User className="size-4" /> : 'AI'}
      </div>
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        {message.blocks && message.blocks.length > 0 ? (
          message.blocks.map((block, i) => <BlockRenderer key={i} block={block} />)
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={markdownComponents}
            >
              {typeof message.content === 'string' ? message.content : ''}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

const EMPTY: Message[] = [];

export function MessageThread({ conversationId }: { conversationId: string }) {
  const messages = useConversationStore((s) => s.messagesByConversation[conversationId]) ?? EMPTY;
  const isSending = useConversationStore((s) => s.isSending);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  if (messages.length === 0 && !isSending) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <p className="text-sm">Send a message to start the conversation.</p>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="divide-y">
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
        {isSending && <StreamingIndicator />}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
