import type { Message, MessageContent, ResponseBlock } from './types.js';

export interface ActionMapping {
  toolName: string;
  actionId: string;
}

/**
 * Routes action callbacks to the tool that produced them.
 * Scans blocks for actionable elements (CardBlock.actions, ActionBlock.actions, FormBlock)
 * and maps their action IDs to the originating tool.
 */
export class ActionRouter {
  private mappings = new Map<string, Map<string, ActionMapping>>();

  /**
   * Extract action IDs from blocks and register mappings for a conversation.
   */
  registerFromBlocks(conversationId: string, toolName: string, blocks: ResponseBlock[]): void {
    let convMap = this.mappings.get(conversationId);
    if (!convMap) {
      convMap = new Map();
      this.mappings.set(conversationId, convMap);
    }

    for (const block of blocks) {
      if (block.type === 'card' && block.actions) {
        for (const action of block.actions) {
          convMap.set(action.id, { toolName, actionId: action.id });
        }
      } else if (block.type === 'action') {
        for (const action of block.actions) {
          convMap.set(action.id, { toolName, actionId: action.id });
        }
      } else if (block.type === 'form') {
        convMap.set(block.id, { toolName, actionId: block.id });
      }
    }
  }

  /**
   * Resolve an actionId to the tool that produced it.
   */
  resolve(conversationId: string, actionId: string): ActionMapping | undefined {
    return this.mappings.get(conversationId)?.get(actionId);
  }

  /**
   * Rebuild action mappings from stored messages.
   * Scans tool messages for BlocksContent preceded by ToolUseContent to reconstruct mappings.
   */
  rebuildFromMessages(conversationId: string, messages: Message[]): void {
    this.clear(conversationId);

    for (const msg of messages) {
      if (!Array.isArray(msg.content)) continue;

      // For assistant messages, extract tool names from tool_use content
      if (msg.role === 'assistant') {
        continue; // tool names are in assistant messages, blocks are in tool messages
      }

      if (msg.role === 'tool') {
        const parts = msg.content as MessageContent[];

        // Find the tool_result to get the toolUseId, then look for blocks
        let toolName: string | undefined;
        for (const part of parts) {
          if (part.type === 'tool_result') {
            // We need to find the tool name from the preceding assistant message
            // Look for the matching tool_use in conversation history
            toolName = this.findToolName(messages, part.toolUseId);
          }
        }

        if (toolName) {
          for (const part of parts) {
            if (part.type === 'blocks') {
              this.registerFromBlocks(conversationId, toolName, part.blocks);
            }
          }
        }
      }
    }
  }

  /**
   * Clear all mappings for a conversation.
   */
  clear(conversationId: string): void {
    this.mappings.delete(conversationId);
  }

  private findToolName(messages: Message[], toolUseId: string): string | undefined {
    for (const msg of messages) {
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        for (const part of msg.content as MessageContent[]) {
          if (part.type === 'tool_use' && part.id === toolUseId) {
            return part.name;
          }
        }
      }
    }
    return undefined;
  }
}
