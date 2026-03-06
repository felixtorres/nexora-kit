import type { ToolDefinition } from './types.js';
import type { ToolHandler, ToolExecutionContext } from './dispatcher.js';
import type { InMemoryWorkingMemory } from './working-memory.js';
import type { UserMemoryStoreInterface } from './user-memory-interface.js';

interface BuiltinToolEntry {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export function getBuiltinToolDefinitions(
  workingMemory: InMemoryWorkingMemory,
  options?: {
    userMemoryStore?: UserMemoryStoreInterface;
  },
): BuiltinToolEntry[] {
  const tools: BuiltinToolEntry[] = [];

  tools.push({
    definition: {
      name: '_note_to_self',
      description:
        'Save a private note to working memory for this conversation. Use this to track intermediate results, plans, or observations across turns. Notes persist for the duration of the conversation.',
      parameters: {
        type: 'object',
        properties: {
          note: {
            type: 'string',
            description: 'The note to save',
          },
        },
        required: ['note'],
      },
    },
    handler: async (input: Record<string, unknown>, context?: ToolExecutionContext) => {
      const conversationId = context?.conversationId ?? 'default';
      const note = String(input.note ?? '');
      workingMemory.addNote(conversationId, note);
      return `Note saved. You now have ${workingMemory.getNotes(conversationId).length} notes.`;
    },
  });

  tools.push({
    definition: {
      name: '_recall',
      description:
        'Retrieve all working memory notes for this conversation. Use this to review your previous observations and plans.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    handler: async (_input: Record<string, unknown>, context?: ToolExecutionContext) => {
      const conversationId = context?.conversationId ?? 'default';
      const notes = workingMemory.getNotes(conversationId);
      if (notes.length === 0) return 'No notes saved yet.';
      return notes.map((n, i) => `${i + 1}. ${n}`).join('\n');
    },
  });

  if (options?.userMemoryStore) {
    const store = options.userMemoryStore;
    tools.push({
      definition: {
        name: '_save_to_memory',
        description:
          'Promote an important fact to permanent user memory. Use this for facts the user would want remembered across conversations (preferences, key information). Only save confirmed facts, not speculative ones.',
        parameters: {
          type: 'object',
          properties: {
            fact: {
              type: 'string',
              description: 'The fact to remember permanently',
            },
            namespace: {
              type: 'string',
              description: 'Category for the fact (e.g. "preferences", "context")',
              default: 'general',
            },
          },
          required: ['fact'],
        },
      },
      handler: async (input: Record<string, unknown>, context?: ToolExecutionContext) => {
        const userId = context?.userId ?? 'unknown';
        const fact = String(input.fact ?? '');
        const namespace = String(input.namespace ?? 'general');
        const key = `fact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        await store.set(userId, { key, value: fact, namespace, source: 'llm' });
        return `Fact saved to permanent memory under "${namespace}".`;
      },
    });
  }

  return tools;
}
