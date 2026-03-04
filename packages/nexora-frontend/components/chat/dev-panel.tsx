'use client';

import { useRef, useEffect } from 'react';
import { Wifi, WifiOff, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useConversationStore, type DevEvent } from '@/store/conversation';

function EventRow({ event }: { event: DevEvent }) {
  const isSent = event.direction === 'sent';
  const data = event.data as Record<string, unknown>;
  const type = String(data.type ?? 'unknown');
  const time = new Date(event.timestamp).toLocaleTimeString();

  return (
    <details className="group border-b last:border-b-0">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/30">
        {isSent ? (
          <ArrowUp className="size-3 text-blue-500" />
        ) : (
          <ArrowDown className="size-3 text-green-500" />
        )}
        <Badge variant="outline" className="text-[10px] font-mono px-1 py-0">
          {type}
        </Badge>
        <span className="ml-auto text-[10px] text-muted-foreground font-mono">{time}</span>
      </summary>
      <pre className="overflow-x-auto bg-zinc-950 p-2 text-[11px] text-zinc-300 leading-relaxed">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  );
}

interface DevPanelProps {
  isConnected: boolean;
}

export function DevPanel({ isConnected }: DevPanelProps) {
  const devEvents = useConversationStore((s) => s.devEvents);
  const lastUsage = useConversationStore((s) => s.lastUsage);
  const clearDevEvents = useConversationStore((s) => s.clearDevEvents);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [devEvents.length]);

  return (
    <div className="flex h-full w-80 flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Dev Panel</span>
          {isConnected ? (
            <Wifi className="size-3.5 text-green-500" />
          ) : (
            <WifiOff className="size-3.5 text-red-500" />
          )}
        </div>
        <Button variant="ghost" size="icon" className="size-6" onClick={clearDevEvents} title="Clear">
          <Trash2 className="size-3" />
        </Button>
      </div>

      {/* Usage card */}
      {lastUsage && (
        <div className="border-b px-3 py-2">
          <div className="text-[10px] font-medium uppercase text-muted-foreground mb-1">Last Usage</div>
          <div className="flex gap-4 text-xs">
            <span>
              <span className="text-muted-foreground">In:</span>{' '}
              <span className="font-mono">{lastUsage.inputTokens.toLocaleString()}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Out:</span>{' '}
              <span className="font-mono">{lastUsage.outputTokens.toLocaleString()}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Total:</span>{' '}
              <span className="font-mono font-medium">
                {(lastUsage.inputTokens + lastUsage.outputTokens).toLocaleString()}
              </span>
            </span>
          </div>
        </div>
      )}

      {/* Event log */}
      <ScrollArea className="flex-1">
        <div className="divide-y-0">
          {devEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p className="text-xs">No events yet.</p>
              <p className="text-[10px] mt-1">Send a message to see WebSocket traffic.</p>
            </div>
          ) : (
            devEvents.map((event, i) => <EventRow key={i} event={event} />)
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
        {devEvents.length} event{devEvents.length !== 1 ? 's' : ''}
        {' · '}
        {isConnected ? 'connected' : 'disconnected'}
      </div>
    </div>
  );
}
