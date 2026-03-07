import type { Validator, CaseResult, ValidationResult, CaseValidation } from './types.js';

export function runValidators(validators: Validator[], result: CaseResult): CaseValidation[] {
  return validators.map((v) => {
    const vr = runSingleValidator(v, result);
    return {
      validator: validatorLabel(v),
      passed: vr.passed,
      message: vr.message,
    };
  });
}

function runSingleValidator(v: Validator, result: CaseResult): ValidationResult {
  switch (v.type) {
    case 'contains': {
      const haystack = v.caseSensitive ? result.responseText : result.responseText.toLowerCase();
      const needle = v.caseSensitive ? v.value : v.value.toLowerCase();
      const found = haystack.includes(needle);
      return {
        passed: found,
        message: found
          ? `Response contains "${v.value}"`
          : `Response does not contain "${v.value}"`,
      };
    }

    case 'not_contains': {
      const found = result.responseText.includes(v.value);
      return {
        passed: !found,
        message: found
          ? `Response unexpectedly contains "${v.value}"`
          : `Response correctly omits "${v.value}"`,
      };
    }

    case 'regex': {
      const re = new RegExp(v.pattern, v.flags);
      const match = re.test(result.responseText);
      return {
        passed: match,
        message: match
          ? `Response matches /${v.pattern}/${v.flags ?? ''}`
          : `Response does not match /${v.pattern}/${v.flags ?? ''}`,
      };
    }

    case 'json_valid': {
      try {
        JSON.parse(result.responseText);
        return { passed: true, message: 'Response is valid JSON' };
      } catch {
        return { passed: false, message: 'Response is not valid JSON' };
      }
    }

    case 'max_tokens': {
      const total = result.metrics.totalTokens;
      const ok = total <= v.limit;
      return {
        passed: ok,
        message: ok
          ? `Tokens ${total} <= ${v.limit}`
          : `Tokens ${total} exceeds limit ${v.limit}`,
      };
    }

    case 'max_turns': {
      const turns = result.metrics.turns;
      const ok = turns <= v.limit;
      return {
        passed: ok,
        message: ok
          ? `Turns ${turns} <= ${v.limit}`
          : `Turns ${turns} exceeds limit ${v.limit}`,
      };
    }

    case 'max_latency_ms': {
      const ms = result.metrics.latencyMs;
      const ok = ms <= v.limit;
      return {
        passed: ok,
        message: ok
          ? `Latency ${ms}ms <= ${v.limit}ms`
          : `Latency ${ms}ms exceeds limit ${v.limit}ms`,
      };
    }

    case 'custom':
      return v.fn(result);
  }
}

function validatorLabel(v: Validator): string {
  switch (v.type) {
    case 'contains':
      return `contains("${v.value}")`;
    case 'not_contains':
      return `not_contains("${v.value}")`;
    case 'regex':
      return `regex(/${v.pattern}/${v.flags ?? ''})`;
    case 'json_valid':
      return 'json_valid';
    case 'max_tokens':
      return `max_tokens(${v.limit})`;
    case 'max_turns':
      return `max_turns(${v.limit})`;
    case 'max_latency_ms':
      return `max_latency_ms(${v.limit})`;
    case 'custom':
      return `custom(${v.name})`;
  }
}
