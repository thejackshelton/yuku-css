/** The median and 95th percentile of one call, in milliseconds. */
export interface Timing {
  median: number;
  p95: number;
}

/**
 * Times `run` for at least `budget` milliseconds and 10 samples, after a warmup. A sample times
 * enough calls to last `least` milliseconds, so the clock's cost and precision vanish.
 */
export function sample(run: () => void, budget: number, least = 0.02): Timing {
  let start = performance.now();
  let calls = 0;
  while (calls < 3 || performance.now() - start < budget / 5) {
    run();
    calls++;
  }
  const batch = Math.max(1, Math.ceil(least / ((performance.now() - start) / calls)));
  const samples: number[] = [];
  start = performance.now();
  while (samples.length < 10 || performance.now() - start < budget) {
    const before = performance.now();
    for (let i = 0; i < batch; i++) run();
    samples.push((performance.now() - before) / batch);
  }
  return { median: quantile(samples, 0.5), p95: quantile(samples, 0.95) };
}

export const BUCKETS: { name: string; max: number }[] = [
  { name: "< 1 KB", max: 1024 },
  { name: "1–10 KB", max: 10 * 1024 },
  { name: "10–100 KB", max: 100 * 1024 },
  { name: "100 KB–1 MB", max: 1024 * 1024 },
  { name: "> 1 MB", max: Infinity },
];

export function bucket(bytes: number): string {
  return BUCKETS.find(({ max }) => bytes < max)!.name;
}

/**
 * Times each run, a size bucket at a time from the smallest, each bucket warmed up before it is
 * timed. A parser whose buffers keep the size of the largest source it has seen, as css-tree's
 * do, then works on buffers the size of the bucket's largest file, not of the largest overall.
 */
export function measure(runs: { bytes: number; run: () => void }[], budget: number, least?: number): Timing[] {
  const timings = new Array<Timing>(runs.length);
  let warmup = 1000;
  for (const { name } of BUCKETS) {
    const chosen = runs.flatMap((run, index) => (bucket(run.bytes) === name ? [{ ...run, index }] : []));
    if (!chosen.length) continue;
    warm(chosen.map(({ run }) => run), warmup);
    warmup = 200;
    for (const { run, index } of chosen) timings[index] = sample(run, budget, least);
  }
  return timings;
}

/** Runs every function in turn, twice and for at least `ms`, so the JIT has compiled the hot paths. */
export function warm(runs: (() => void)[], ms = 1000): void {
  const start = performance.now();
  for (let pass = 0; pass < 2 || performance.now() - start < ms; pass++) for (const run of runs) run();
}

export function quantile(values: number[], q: number): number {
  const sorted = values.toSorted((a, b) => a - b);
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  return sorted[low]! + (sorted[Math.ceil(at)]! - sorted[low]!) * (at - low);
}
