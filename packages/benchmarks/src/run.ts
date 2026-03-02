import { runHttpBench } from './http-bench.js';
import { printReport, type BenchResult } from './report.js';

async function main() {
  const iterations = parseInt(process.argv[2] ?? '100', 10);
  console.log(`Running benchmarks with ${iterations} iterations...\n`);

  const results: BenchResult[] = [];

  console.log('HTTP benchmarks...');
  results.push(...await runHttpBench(iterations));

  printReport(results);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
