/**
 * Vega-Lite spec validator.
 *
 * Validates that a JSON object is a structurally valid Vega-Lite spec
 * before sending it to the frontend for rendering.
 */

export interface SpecValidationResult {
  valid: boolean;
  error?: string;
}

/** Vega-Lite mark types we accept */
const VALID_MARKS = new Set([
  'bar', 'line', 'area', 'point', 'circle', 'square', 'rect', 'tick',
  'rule', 'text', 'arc', 'boxplot', 'geoshape', 'trail',
]);

/** Valid encoding channel names */
const VALID_CHANNELS = new Set([
  'x', 'y', 'x2', 'y2', 'color', 'opacity', 'size', 'shape',
  'detail', 'text', 'tooltip', 'href', 'url', 'description',
  'row', 'column', 'facet', 'theta', 'radius', 'angle',
  'strokeWidth', 'strokeDash', 'order',
]);

/** Composite view keys in Vega-Lite */
const COMPOSITE_KEYS = ['layer', 'concat', 'hconcat', 'vconcat', 'repeat'] as const;

/**
 * Normalize a chart spec that may arrive as:
 *  - A JSON string of a raw Vega-Lite spec
 *  - A raw Vega-Lite object (has mark/layer/concat)
 *  - The wrapped form { engine: 'vega-lite', config: {...} }
 *
 * Returns the wrapped form or an error string.
 */
export function normalizeChartSpec(
  raw: unknown,
): { engine: 'vega-lite'; config: Record<string, unknown> } | string {
  let parsed = raw;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return 'spec must be valid JSON';
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'spec must be a JSON object';
  }

  const obj = parsed as Record<string, unknown>;

  // Already wrapped
  if ('engine' in obj && 'config' in obj && typeof obj.config === 'object' && obj.config !== null) {
    return obj as { engine: 'vega-lite'; config: Record<string, unknown> };
  }

  // Raw Vega-Lite spec
  if ('mark' in obj || COMPOSITE_KEYS.some((k) => k in obj)) {
    return { engine: 'vega-lite', config: obj };
  }

  return 'spec must have mark/encoding or layer';
}

export function validateVegaLiteSpec(spec: Record<string, unknown>): SpecValidationResult {
  if (!spec || typeof spec !== 'object') {
    return { valid: false, error: 'Spec must be a JSON object' };
  }

  // Must have either mark + encoding (unit spec) or layer/concat/hconcat/vconcat/repeat
  const isSingleView = 'mark' in spec;
  const isComposite = 'layer' in spec || 'concat' in spec || 'hconcat' in spec || 'vconcat' in spec || 'repeat' in spec;

  if (!isSingleView && !isComposite) {
    return { valid: false, error: 'Spec must have either "mark" (single view) or "layer"/"concat" (composite)' };
  }

  // Validate single view spec
  if (isSingleView) {
    const markValidation = validateMark(spec.mark);
    if (!markValidation.valid) return markValidation;

    if ('encoding' in spec && spec.encoding) {
      const encodingValidation = validateEncoding(spec.encoding as Record<string, unknown>);
      if (!encodingValidation.valid) return encodingValidation;
    }
  }

  // Validate composite spec layers
  if ('layer' in spec) {
    const layers = spec.layer;
    if (!Array.isArray(layers)) {
      return { valid: false, error: '"layer" must be an array' };
    }
    for (let i = 0; i < layers.length; i++) {
      if (typeof layers[i] !== 'object' || layers[i] === null) {
        return { valid: false, error: `Layer ${i} must be an object` };
      }
    }
  }

  return { valid: true };
}

function validateMark(mark: unknown): SpecValidationResult {
  if (typeof mark === 'string') {
    if (!VALID_MARKS.has(mark)) {
      return { valid: false, error: `Unknown mark type: "${mark}". Valid: ${[...VALID_MARKS].join(', ')}` };
    }
    return { valid: true };
  }

  if (typeof mark === 'object' && mark !== null && 'type' in mark) {
    const markType = (mark as { type: unknown }).type;
    if (typeof markType === 'string' && !VALID_MARKS.has(markType)) {
      return { valid: false, error: `Unknown mark type: "${markType}"` };
    }
    return { valid: true };
  }

  return { valid: false, error: '"mark" must be a string or object with a "type" field' };
}

function validateEncoding(encoding: Record<string, unknown>): SpecValidationResult {
  for (const channel of Object.keys(encoding)) {
    if (!VALID_CHANNELS.has(channel)) {
      return { valid: false, error: `Unknown encoding channel: "${channel}". Valid: ${[...VALID_CHANNELS].join(', ')}` };
    }
  }
  return { valid: true };
}
