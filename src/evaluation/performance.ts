export interface TrialSummary {
  count: number;
  min: number;
  median: number;
  p95: number;
  p99: number;
  max: number;
}

export function summarizeTrials(samples: number[]): TrialSummary {
  if (
    samples.length === 0 ||
    samples.some((sample) => !Number.isFinite(sample) || sample < 0)
  ) {
    throw new TypeError("Performance samples must be finite non-negative numbers");
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  const p99Index = Math.max(0, Math.ceil(sorted.length * 0.99) - 1);
  return {
    count: sorted.length,
    min: sorted[0]!,
    median,
    p95: sorted[p95Index]!,
    p99: sorted[p99Index]!,
    max: sorted.at(-1)!,
  };
}
