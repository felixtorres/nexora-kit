/**
 * Per-conversation memory of tools the LLM has "loaded" via _search_tools.
 * Max 20 loaded tools per conversation, 30-minute TTL eviction.
 */

const DEFAULT_MAX_TOOLS = 20;
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface MemoryEntry {
  toolNames: Set<string>;
  lastAccess: number;
}

export class ConversationToolMemory {
  private readonly store = new Map<string, MemoryEntry>();
  private readonly maxTools: number;
  private readonly ttlMs: number;

  constructor(options?: { maxTools?: number; ttlMs?: number }) {
    this.maxTools = options?.maxTools ?? DEFAULT_MAX_TOOLS;
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  }

  /** Record tools as loaded for a conversation. */
  load(conversationId: string, toolNames: string[]): void {
    this.evictExpired();
    let entry = this.store.get(conversationId);
    if (!entry) {
      entry = { toolNames: new Set(), lastAccess: Date.now() };
      this.store.set(conversationId, entry);
    }
    entry.lastAccess = Date.now();
    for (const name of toolNames) {
      if (entry.toolNames.size >= this.maxTools) break;
      entry.toolNames.add(name);
    }
  }

  /** Retrieve loaded tool names for a conversation. */
  getLoaded(conversationId: string): string[] {
    this.evictExpired();
    const entry = this.store.get(conversationId);
    if (!entry) return [];
    entry.lastAccess = Date.now();
    return [...entry.toolNames];
  }

  /** Clear memory for a conversation. */
  clear(conversationId: string): void {
    this.store.delete(conversationId);
  }

  /** Remove expired entries. */
  private evictExpired(): void {
    const now = Date.now();
    for (const [id, entry] of this.store) {
      if (now - entry.lastAccess > this.ttlMs) {
        this.store.delete(id);
      }
    }
  }
}
