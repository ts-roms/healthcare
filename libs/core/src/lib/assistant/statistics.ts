/**
 * Small, dependency-free statistics for assistant rules. Each returns `null` when there is too little data, so a rule
 * says nothing rather than guessing from a handful of points.
 */

export function mean(values: readonly number[], minSample = 1): number | null {
  if (values.length < Math.max(1, minSample)) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function percentile(values: readonly number[], p: number, minSample = 1): number | null {
  if (values.length < Math.max(1, minSample)) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (rank - low);
}

export function median(values: readonly number[], minSample = 1): number | null {
  return percentile(values, 50, minSample);
}

/** Standard score of `value` against `history`; null with fewer than `minSample` points or no spread. */
export function zScore(value: number, history: readonly number[], minSample = 8): number | null {
  const m = mean(history, minSample);
  if (m === null) return null;
  const variance = history.reduce((sum, v) => sum + (v - m) ** 2, 0) / (history.length - 1 || 1);
  const sd = Math.sqrt(variance);
  return sd === 0 ? null : (value - m) / sd;
}
