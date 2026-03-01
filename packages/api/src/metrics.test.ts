import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector } from './metrics.js';

describe('MetricsCollector', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  it('starts with zero counts', () => {
    const snap = metrics.snapshot();
    expect(snap.requests_total).toBe(0);
    expect(snap.active_connections).toBe(0);
    expect(snap.avg_latency_ms).toBe(0);
  });

  it('records requests', () => {
    metrics.recordRequest('GET', 200, 10);
    metrics.recordRequest('POST', 200, 20);
    metrics.recordRequest('GET', 404, 5);

    const snap = metrics.snapshot();
    expect(snap.requests_total).toBe(3);
    expect(snap.requests_by_status['200']).toBe(2);
    expect(snap.requests_by_status['404']).toBe(1);
    expect(snap.requests_by_method['GET']).toBe(2);
    expect(snap.requests_by_method['POST']).toBe(1);
  });

  it('calculates average latency', () => {
    metrics.recordRequest('GET', 200, 10);
    metrics.recordRequest('GET', 200, 20);
    metrics.recordRequest('GET', 200, 30);

    const snap = metrics.snapshot();
    expect(snap.avg_latency_ms).toBe(20);
  });

  it('calculates p95 latency', () => {
    for (let i = 1; i <= 100; i++) {
      metrics.recordRequest('GET', 200, i);
    }

    const snap = metrics.snapshot();
    expect(snap.p95_latency_ms).toBe(96);
  });

  it('tracks active connections', () => {
    metrics.connectionOpened();
    metrics.connectionOpened();
    expect(metrics.snapshot().active_connections).toBe(2);

    metrics.connectionClosed();
    expect(metrics.snapshot().active_connections).toBe(1);

    metrics.connectionClosed();
    metrics.connectionClosed(); // shouldn't go below 0
    expect(metrics.snapshot().active_connections).toBe(0);
  });

  it('tracks plugin counts', () => {
    metrics.updatePluginCounts(3, 5);
    const snap = metrics.snapshot();
    expect(snap.plugins_enabled).toBe(3);
    expect(snap.plugins_total).toBe(5);
  });

  it('reports uptime', () => {
    const snap = metrics.snapshot();
    expect(snap.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  it('resets counters', () => {
    metrics.recordRequest('GET', 200, 10);
    metrics.recordRequest('POST', 500, 50);

    metrics.reset();
    const snap = metrics.snapshot();
    expect(snap.requests_total).toBe(0);
    expect(snap.avg_latency_ms).toBe(0);
  });
});
