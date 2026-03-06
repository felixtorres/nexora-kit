export class InMemoryWorkingMemory {
  private notes = new Map<string, string[]>();

  addNote(conversationId: string, note: string): void {
    const existing = this.notes.get(conversationId) ?? [];
    existing.push(note);
    this.notes.set(conversationId, existing);
  }

  getNotes(conversationId: string): string[] {
    return this.notes.get(conversationId) ?? [];
  }

  clear(conversationId: string): void {
    this.notes.delete(conversationId);
  }
}
