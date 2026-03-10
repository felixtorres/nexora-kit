import type { LlmProvider } from '@nexora-kit/llm';
import type { Message } from './types.js';
import type { Logger } from './logger.js';
import { buildAtomicGroups } from './context.js';
import { estimateTokens } from './token-utils.js';

export interface CompactionConfig {
  /** Model ID to use for summarization. Defaults to cheapest available (smallest context window). */
  model?: string;
  /** Separate LLM provider for compaction. Defaults to main provider. */
  provider?: LlmProvider;
  /** Context usage ratio that triggers compaction (0-1). Default: 0.75 */
  triggerRatio?: number;
  /** Number of recent atomic groups to keep verbatim. Default: 4 */
  keepRecentGroups?: number;
  /** Maximum tokens for the summary. Default: 1000 */
  maxSummaryTokens?: number;
  /** Maximum input tokens allowed for compaction summarization. If the transcript
   *  to summarize exceeds this, skip compaction and fall back to hard truncation.
   *  Default: 0 (no limit — always attempt compaction). */
  maxCompactionInputTokens?: number;
  /** Logger for cost warnings. */
  logger?: Logger;
}

export interface CompactionResult {
  summary: string;
  compactedMessages: number;
  summaryTokens: number;
}

export class ContextCompactor {
  private readonly provider: LlmProvider;
  private readonly model: string;
  private readonly triggerRatio: number;
  private readonly keepRecentGroups: number;
  private readonly maxSummaryTokens: number;
  private readonly maxCompactionInputTokens: number;
  private readonly logger?: Logger;

  constructor(mainProvider: LlmProvider, config: CompactionConfig = {}) {
    this.provider = config.provider ?? mainProvider;
    this.triggerRatio = config.triggerRatio ?? 0.75;
    this.keepRecentGroups = config.keepRecentGroups ?? 4;
    this.maxSummaryTokens = config.maxSummaryTokens ?? 1000;
    this.maxCompactionInputTokens = config.maxCompactionInputTokens ?? 0;
    this.logger = config.logger;

    // Pick model: explicit config > cheapest available (smallest contextWindow heuristic)
    if (config.model) {
      this.model = config.model;
    } else {
      const sorted = [...this.provider.models].sort(
        (a, b) => a.contextWindow - b.contextWindow,
      );
      if (sorted.length === 0) {
        this.logger?.warn('compaction.no_models', {
          message: 'No models available for compaction — will fall back to hard truncation',
        });
      }
      this.model = sorted[0]?.id ?? 'default';
    }
  }

  shouldCompact(currentTokens: number, maxTokens: number): boolean {
    return currentTokens >= maxTokens * this.triggerRatio;
  }

  async compact(messages: Message[]): Promise<CompactionResult> {
    const nonSystem = messages.filter((m) => m.role !== 'system');
    const groups = buildAtomicGroups(nonSystem);

    // Keep recent groups verbatim, summarize the rest
    const keepCount = Math.min(this.keepRecentGroups, groups.length);
    const toSummarize = groups.slice(0, groups.length - keepCount);

    if (toSummarize.length === 0) {
      return { summary: '', compactedMessages: 0, summaryTokens: 0 };
    }

    const flatMessages = toSummarize.flatMap((g) => g);
    const compactedCount = flatMessages.length;

    // Build summarization prompt
    const transcript = flatMessages
      .map((m) => {
        const content =
          typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `[${m.role}]: ${content}`;
      })
      .join('\n');

    // Cost estimation: check input token count before calling LLM
    const inputTokenEstimate = estimateTokens(transcript);
    if (this.maxCompactionInputTokens > 0 && inputTokenEstimate > this.maxCompactionInputTokens) {
      this.logger?.warn('compaction.skipped_over_budget', {
        inputTokenEstimate,
        maxCompactionInputTokens: this.maxCompactionInputTokens,
        messagesToCompact: compactedCount,
        message: 'Compaction input exceeds budget — falling back to hard truncation',
      });
      return { summary: '', compactedMessages: 0, summaryTokens: 0 };
    }

    if (inputTokenEstimate > 10_000) {
      this.logger?.warn('compaction.high_input_tokens', {
        inputTokenEstimate,
        messagesToCompact: compactedCount,
        model: this.model,
      });
    }

    const summaryPrompt = `Summarize the following conversation history concisely. Preserve:
- Key decisions and conclusions
- Important facts stated by the user
- Tool call results (summarize, don't repeat verbatim)
- Current goal state and what has been accomplished

Keep the summary under ${this.maxSummaryTokens} tokens.

Conversation:
${transcript}`;

    let summary = '';
    const stream = this.provider.chat({
      model: this.model,
      messages: [{ role: 'user', content: summaryPrompt }],
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === 'text') {
        summary += event.content;
      }
    }

    return {
      summary,
      compactedMessages: compactedCount,
      summaryTokens: estimateTokens(summary),
    };
  }
}
