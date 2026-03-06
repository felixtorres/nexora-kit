/**
 * `_search_tools` meta-tool: lets the LLM discover tools at runtime.
 * Registered in the tool dispatcher (NOT in ToolIndex) so it can't find itself.
 */

import type { ToolDefinition } from '@nexora-kit/core';
import type { ToolIndex } from './tool-index.js';
import type { ConversationToolMemory } from './conversation-tool-memory.js';

export const SEARCH_TOOLS_NAME = '_search_tools';

const MAX_RESULTS = 5;

/** Returns the tool definition for _search_tools. */
export function getSearchToolsDefinition(): ToolDefinition {
  return {
    name: SEARCH_TOOLS_NAME,
    description:
      'Search for available tools by keyword or description. ' +
      'Use this when you need a capability that is not in your current tool set. ' +
      'Found tools will become available on the next turn.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query describing the tool capability you need',
        },
        namespace: {
          type: 'string',
          description: 'Optional namespace to restrict search to',
        },
      },
      required: ['query'],
    },
  };
}

export interface SearchToolsHandlerOptions {
  toolIndex: ToolIndex;
  conversationToolMemory: ConversationToolMemory;
}

/**
 * Creates the handler function for the _search_tools meta-tool.
 * The handler searches the ToolIndex and records found tools in ConversationToolMemory.
 */
export function createSearchToolsHandler(options: SearchToolsHandlerOptions) {
  const { toolIndex, conversationToolMemory } = options;

  return async (
    input: Record<string, unknown>,
    context?: { conversationId?: string },
  ): Promise<string> => {
    const query = String(input.query ?? '');
    const namespace = input.namespace as string | undefined;

    if (!query) {
      return 'Please provide a search query describing the tool you need.';
    }

    const namespaces = namespace ? [namespace] : [];
    const results = toolIndex.search({ text: query, namespaces, limit: MAX_RESULTS });

    if (results.length === 0) {
      return `No tools found matching "${query}". Try different keywords.`;
    }

    const toolNames = results.map((r) => r.tool.name);

    // Record found tools in conversation memory so the selector includes them next turn
    const conversationId = context?.conversationId;
    if (conversationId) {
      conversationToolMemory.load(conversationId, toolNames);
    }

    const summaries = results.map(
      (r) => `- **${r.tool.name}** (${r.namespace}): ${r.tool.description}`,
    );

    return (
      `Found ${results.length} tool(s):\n${summaries.join('\n')}\n\n` +
      'These tools are now available. Call them on your next turn.'
    );
  };
}
