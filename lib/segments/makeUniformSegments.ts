export type TimeSegment = { startSec: number; endSec: number };

/**
 * Create n uniform segments spanning [startSec, endSec].
 * Each segment gets an equal share of the time range.
 */
export function makeUniformSegments(
  startSec: number,
  endSec: number,
  n: number
): TimeSegment[] {
  if (n <= 0) return [];
  const duration = Math.max(0, endSec - startSec);
  const step = duration / n;
  const result: TimeSegment[] = [];
  for (let i = 0; i < n; i++) {
    result.push({
      startSec: startSec + i * step,
      endSec: startSec + (i + 1) * step,
    });
  }
  return result;
}
