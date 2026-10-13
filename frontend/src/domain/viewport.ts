/** Pure range math behind the payoff chart's zoom and pan. */

export interface Range {
  min: number;
  max: number;
}

/** Shifts `r` into `bounds` without changing its span (or fits it when wider). */
export function clampRange(r: Range, bounds: Range): Range {
  const span = r.max - r.min;
  if (span >= bounds.max - bounds.min) return { ...bounds };
  if (r.min < bounds.min) return { min: bounds.min, max: bounds.min + span };
  if (r.max > bounds.max) return { min: bounds.max - span, max: bounds.max };
  return r;
}

/**
 * Scales `r` by `factor` (<1 zooms in) keeping `anchor` at the same screen
 * position, with the span limited to [minSpan, bounds span].
 */
export function zoomRange(r: Range, factor: number, anchor: number, bounds: Range, minSpan: number): Range {
  const span = r.max - r.min;
  if (!(span > 0) || !Number.isFinite(factor) || !Number.isFinite(anchor)) return r;
  const next = Math.min(Math.max(span * factor, minSpan), bounds.max - bounds.min);
  const min = anchor - ((anchor - r.min) / span) * next;
  return clampRange({ min, max: min + next }, bounds);
}

/** Moves `r` by `shift` value units, staying inside `bounds`. */
export function panRange(r: Range, shift: number, bounds: Range): Range {
  if (!Number.isFinite(shift)) return r;
  return clampRange({ min: r.min + shift, max: r.max + shift }, bounds);
}

/** The range between two values in either order, or null when it is narrower than `minSpan`. */
export function rangeBetween(a: number, b: number, minSpan: number): Range | null {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return max - min >= minSpan ? { min, max } : null;
}

/** A round step near `raw`: 1, 2, 5 × 10ⁿ (e.g. 22.7 → 20). */
export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const r = raw / mag;
  return (r >= 5 ? 5 : r >= 2 ? 2 : 1) * mag;
}
