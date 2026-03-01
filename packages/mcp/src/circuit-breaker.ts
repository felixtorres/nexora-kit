import { type CircuitBreakerConfig, DEFAULT_CIRCUIT_BREAKER_CONFIG } from './types.js';

export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private state: CircuitBreakerState = 'closed';
  private consecutiveFailures = 0;
  private halfOpenSuccesses = 0;
  private lastFailureTime = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  getState(): CircuitBreakerState {
    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.config.resetTimeoutMs) {
        this.state = 'half-open';
        this.halfOpenSuccesses = 0;
      }
    }
    return this.state;
  }

  canExecute(): boolean {
    const state = this.getState();
    return state === 'closed' || state === 'half-open';
  }

  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.halfOpenSuccesses) {
        this.state = 'closed';
        this.consecutiveFailures = 0;
        this.halfOpenSuccesses = 0;
      }
    } else {
      this.consecutiveFailures = 0;
    }
  }

  recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      this.state = 'open';
      this.halfOpenSuccesses = 0;
    } else if (this.consecutiveFailures >= this.config.failureThreshold) {
      this.state = 'open';
    }
  }

  reset(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.halfOpenSuccesses = 0;
    this.lastFailureTime = 0;
  }

  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }
}
