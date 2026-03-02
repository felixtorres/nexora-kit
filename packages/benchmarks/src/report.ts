export interface BenchResult {
  name: string;
  samples: number[];
}

export function printReport(results: BenchResult[]): void {
  console.log('\n=== Benchmark Results ===\n');
  console.log(
    pad('Name', 30) +
    pad('Samples', 10) +
    pad('p50 (ms)', 12) +
    pad('p95 (ms)', 12) +
    pad('p99 (ms)', 12) +
    pad('Avg (ms)', 12),
  );
  console.log('-'.repeat(88));

  for (const result of results) {
    const sorted = [...result.samples].sort((a, b) => a - b);
    const p50 = percentile(sorted, 0.50);
    const p95 = percentile(sorted, 0.95);
    const p99 = percentile(sorted, 0.99);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;

    console.log(
      pad(result.name, 30) +
      pad(String(sorted.length), 10) +
      pad(p50.toFixed(2), 12) +
      pad(p95.toFixed(2), 12) +
      pad(p99.toFixed(2), 12) +
      pad(avg.toFixed(2), 12),
    );
  }

  console.log('');
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function pad(str: string, len: number): string {
  return str.padEnd(len);
}
