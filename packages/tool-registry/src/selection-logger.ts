export interface SelectionLogEntry {
  timestamp: number;
  query: string;
  selectedCount: number;
  droppedCount: number;
  tokensUsed: number;
  timeMs: number;
  topTools: string[];
}

export class SelectionLogger {
  private entries: SelectionLogEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries;
  }

  log(entry: SelectionLogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  getRecent(count = 10): SelectionLogEntry[] {
    return this.entries.slice(-count);
  }

  getAll(): SelectionLogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }

  size(): number {
    return this.entries.length;
  }
}
