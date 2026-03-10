/**
 * Built-in scoring metrics for the GEPA prompt optimizer.
 *
 * Each metric returns a {@link ScoreWithFeedback} — a numeric score (0–1)
 * plus diagnostic text explaining what went wrong. The diagnostic text is
 * the "text analogue of a gradient" that guides GEPA's reflective evolution.
 *
 * Custom metrics can be registered via the {@link MetricRegistry}.
 */

export interface ScoreWithFeedback {
  /** Score between 0.0 (worst) and 1.0 (best). */
  score: number;
  /** Natural-language diagnostic explaining what went wrong (or right). */
  feedback: string;
}

export interface ExecutionTraceInput {
  prompt: string;
  finalAnswer: string;
  toolCalls: { name: string; input: Record<string, unknown>; output?: string; isError: boolean }[];
  retrievedDocs?: string[];
  agentReasoning?: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export type MetricFunction = (
  trace: ExecutionTraceInput,
  context: MetricContext,
) => ScoreWithFeedback;

export interface MetricContext {
  /** Expected answer for answer_correctness. */
  expectedAnswer?: string;
  /** Expected tool names for tool_selection. */
  expectedTools?: string[];
  /** Gold document snippets for retrieval_relevance. */
  goldDocuments?: string[];
  /** User feedback rating: true = thumbs up, false = thumbs down, undefined = no feedback. */
  userRating?: boolean;
  /** User correction text (from feedback). */
  userCorrection?: string;
  /** Original content before compaction. */
  preCompactionContent?: string;
  /** Key facts that should survive compaction. */
  keyFacts?: string[];
}

// --- Built-in Metrics ---

/**
 * Scores how well the output matches an expected answer.
 * Uses word overlap (Jaccard similarity) with length-ratio penalty.
 */
export function answerCorrectness(trace: ExecutionTraceInput, context: MetricContext): ScoreWithFeedback {
  const expected = context.expectedAnswer;
  if (!expected) {
    return { score: 0.5, feedback: 'No expected answer provided — cannot evaluate correctness.' };
  }

  const answer = trace.finalAnswer;
  if (!answer) {
    return { score: 0, feedback: 'Agent produced no answer.' };
  }

  const expectedWords = tokenize(expected);
  const answerWords = tokenize(answer);

  if (expectedWords.size === 0) {
    return { score: 0.5, feedback: 'Expected answer is empty — cannot evaluate.' };
  }

  // Jaccard similarity on word sets
  const intersection = new Set([...expectedWords].filter((w) => answerWords.has(w)));
  const union = new Set([...expectedWords, ...answerWords]);
  const jaccard = union.size > 0 ? intersection.size / union.size : 0;

  // Length ratio penalty — penalize answers that are way too short or too long
  const lengthRatio = answerWords.size / expectedWords.size;
  const lengthPenalty = lengthRatio < 0.3 ? 0.5 : lengthRatio > 5 ? 0.7 : 1.0;

  const score = Math.min(1, jaccard * lengthPenalty);

  // Build diagnostic feedback
  const missingWords = [...expectedWords].filter((w) => !answerWords.has(w));
  const feedback: string[] = [];

  if (score >= 0.8) {
    feedback.push('Answer closely matches expected output.');
  } else if (score >= 0.5) {
    feedback.push('Answer partially matches expected output.');
  } else {
    feedback.push('Answer diverges significantly from expected output.');
  }

  if (missingWords.length > 0 && missingWords.length <= 10) {
    feedback.push(`Missing key terms: ${missingWords.slice(0, 5).join(', ')}.`);
  } else if (missingWords.length > 10) {
    feedback.push(`Missing ${missingWords.length} expected terms (e.g., ${missingWords.slice(0, 3).join(', ')}).`);
  }

  if (lengthPenalty < 1) {
    feedback.push(
      lengthRatio < 0.3
        ? `Answer is too short (${answerWords.size} words vs ${expectedWords.size} expected).`
        : `Answer is excessively long (${answerWords.size} words vs ${expectedWords.size} expected).`,
    );
  }

  return { score: round(score), feedback: feedback.join(' ') };
}

/**
 * Scores whether the agent called the right tools.
 * Measures precision and recall of tool names against expected set.
 */
export function toolSelection(trace: ExecutionTraceInput, context: MetricContext): ScoreWithFeedback {
  const expected = context.expectedTools;
  if (!expected || expected.length === 0) {
    return { score: 0.5, feedback: 'No expected tools provided — cannot evaluate tool selection.' };
  }

  const actualNames = new Set(trace.toolCalls.map((tc) => tc.name));
  const expectedSet = new Set(expected);

  const truePositives = [...expectedSet].filter((t) => actualNames.has(t));
  const falseNegatives = [...expectedSet].filter((t) => !actualNames.has(t));
  const falsePositives = [...actualNames].filter((t) => !expectedSet.has(t));
  const errorCalls = trace.toolCalls.filter((tc) => tc.isError);

  const precision = actualNames.size > 0 ? truePositives.length / actualNames.size : 0;
  const recall = expectedSet.size > 0 ? truePositives.length / expectedSet.size : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  // Penalty for error calls
  const errorPenalty = errorCalls.length > 0 ? Math.max(0, 1 - errorCalls.length * 0.15) : 1;
  const score = f1 * errorPenalty;

  const feedback: string[] = [];

  if (falseNegatives.length > 0) {
    feedback.push(`Missing tools: ${falseNegatives.join(', ')}.`);
  }
  if (falsePositives.length > 0) {
    feedback.push(`Unnecessary tools called: ${falsePositives.join(', ')}.`);
  }
  if (errorCalls.length > 0) {
    feedback.push(`${errorCalls.length} tool call(s) returned errors: ${errorCalls.map((tc) => tc.name).join(', ')}.`);
  }
  if (feedback.length === 0) {
    feedback.push('All expected tools were called correctly with no unnecessary calls.');
  }

  return { score: round(score), feedback: feedback.join(' ') };
}

/**
 * Scores how well retrieved documents cover the needed information.
 * Measures overlap between retrieved docs and gold document snippets.
 */
export function retrievalRelevance(trace: ExecutionTraceInput, context: MetricContext): ScoreWithFeedback {
  const gold = context.goldDocuments;
  if (!gold || gold.length === 0) {
    return { score: 0.5, feedback: 'No gold documents provided — cannot evaluate retrieval relevance.' };
  }

  const retrieved = trace.retrievedDocs;
  if (!retrieved || retrieved.length === 0) {
    return { score: 0, feedback: `No documents were retrieved, but ${gold.length} relevant document(s) expected.` };
  }

  // For each gold doc, check if any retrieved doc contains its key terms
  const goldWords = gold.map((doc) => tokenize(doc));
  const retrievedText = retrieved.join(' ').toLowerCase();
  const retrievedWords = tokenize(retrievedText);

  let covered = 0;
  const uncoveredDocs: number[] = [];

  for (let i = 0; i < goldWords.length; i++) {
    const docTerms = goldWords[i];
    const overlap = [...docTerms].filter((w) => retrievedWords.has(w));
    const coverage = docTerms.size > 0 ? overlap.length / docTerms.size : 0;

    if (coverage >= 0.3) {
      covered++;
    } else {
      uncoveredDocs.push(i + 1);
    }
  }

  const recall = covered / gold.length;

  // Precision penalty: too many irrelevant docs dilute context
  const precisionFactor = retrieved.length > gold.length * 3 ? 0.8 : 1.0;
  const score = recall * precisionFactor;

  const feedback: string[] = [];

  if (uncoveredDocs.length > 0) {
    feedback.push(`Gold document(s) #${uncoveredDocs.join(', #')} not adequately covered by retrieved results.`);
  }
  if (precisionFactor < 1) {
    feedback.push(`Retrieved ${retrieved.length} documents but only ${gold.length} gold docs — too many irrelevant results diluting context.`);
  }
  if (score >= 0.8) {
    feedback.push('Retrieval covered most relevant information.');
  } else if (score < 0.3) {
    feedback.push('Retrieval missed most relevant documents — query generation prompt needs improvement.');
  }

  return { score: round(score), feedback: feedback.join(' ') };
}

/**
 * Scores based on end-user feedback (thumbs up/down + corrections).
 * Binary with correction bonus/penalty.
 */
export function userSatisfaction(trace: ExecutionTraceInput, context: MetricContext): ScoreWithFeedback {
  if (context.userRating === undefined) {
    return { score: 0.5, feedback: 'No user feedback provided for this trace.' };
  }

  let score: number;
  const feedback: string[] = [];

  if (context.userRating) {
    score = 1.0;
    feedback.push('User gave positive feedback (thumbs up).');
  } else {
    score = 0.0;
    feedback.push('User gave negative feedback (thumbs down).');

    if (context.userCorrection) {
      feedback.push(`User correction: "${truncate(context.userCorrection, 200)}".`);
      // Negative + correction is highly valuable training signal
      score = 0.1; // Slightly above 0 because the correction provides learning signal
    }
  }

  return { score: round(score), feedback: feedback.join(' ') };
}

/**
 * Scores how well key information survives context compaction.
 * Checks whether key facts from the original content appear in the compacted result.
 */
export function compactionRetention(trace: ExecutionTraceInput, context: MetricContext): ScoreWithFeedback {
  const keyFacts = context.keyFacts;
  if (!keyFacts || keyFacts.length === 0) {
    return { score: 0.5, feedback: 'No key facts provided — cannot evaluate compaction retention.' };
  }

  const answer = trace.finalAnswer;
  if (!answer) {
    return { score: 0, feedback: 'Compaction produced no output.' };
  }

  const answerLower = answer.toLowerCase();
  const answerWords = tokenize(answer);

  let retained = 0;
  const lostFacts: string[] = [];

  for (const fact of keyFacts) {
    const factWords = tokenize(fact);
    if (factWords.size === 0) continue;

    // Check if the fact's key words appear in the compacted output
    const overlap = [...factWords].filter((w) => answerWords.has(w));
    const coverage = overlap.length / factWords.size;

    // Also check for substring match (handles proper nouns, numbers, etc.)
    const factLower = fact.toLowerCase();
    const substringMatch = answerLower.includes(factLower);

    if (coverage >= 0.5 || substringMatch) {
      retained++;
    } else {
      lostFacts.push(truncate(fact, 60));
    }
  }

  const score = retained / keyFacts.length;

  const feedback: string[] = [];
  feedback.push(`Retained ${retained}/${keyFacts.length} key facts.`);

  if (lostFacts.length > 0) {
    const shown = lostFacts.slice(0, 3);
    feedback.push(`Lost facts: ${shown.map((f) => `"${f}"`).join('; ')}.`);
    if (lostFacts.length > 3) {
      feedback.push(`(and ${lostFacts.length - 3} more)`);
    }
  }

  // Check compression ratio
  if (context.preCompactionContent) {
    const originalLen = context.preCompactionContent.length;
    const compactedLen = answer.length;
    const ratio = compactedLen / originalLen;
    if (ratio > 0.9) {
      feedback.push('Compaction barely reduced content — may not be effectively summarizing.');
    }
  }

  return { score: round(score), feedback: feedback.join(' ') };
}

// --- Metric Registry ---

export class MetricRegistry {
  private readonly metrics = new Map<string, MetricFunction>();

  constructor() {
    // Register built-ins
    this.metrics.set('answer_correctness', answerCorrectness);
    this.metrics.set('tool_selection', toolSelection);
    this.metrics.set('retrieval_relevance', retrievalRelevance);
    this.metrics.set('user_satisfaction', userSatisfaction);
    this.metrics.set('compaction_retention', compactionRetention);
  }

  register(name: string, fn: MetricFunction): void {
    this.metrics.set(name, fn);
  }

  get(name: string): MetricFunction | undefined {
    return this.metrics.get(name);
  }

  evaluate(name: string, trace: ExecutionTraceInput, context: MetricContext): ScoreWithFeedback {
    const fn = this.metrics.get(name);
    if (!fn) {
      throw new Error(`Unknown metric: ${name}`);
    }
    return fn(trace, context);
  }

  evaluateAll(trace: ExecutionTraceInput, context: MetricContext): Map<string, ScoreWithFeedback> {
    const results = new Map<string, ScoreWithFeedback>();
    for (const [name, fn] of this.metrics) {
      results.set(name, fn(trace, context));
    }
    return results;
  }

  list(): string[] {
    return [...this.metrics.keys()];
  }
}

// --- Helpers ---

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[\s\p{P}]+/u)
      .filter((w) => w.length > 1),
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen) + '...' : s;
}
