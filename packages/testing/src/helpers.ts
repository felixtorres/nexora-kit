import type { AgentLoop } from '@nexora-kit/core';
import type { ChatEvent } from '@nexora-kit/core';

/**
 * Collects all events from an AgentLoop run into an array.
 */
export async function collectEvents(
  loop: AgentLoop,
  request: Parameters<AgentLoop['run']>[0],
): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of loop.run(request)) {
    events.push(event);
  }
  return events;
}
