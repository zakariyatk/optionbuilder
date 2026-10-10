const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export const inr = (v: number) => inrFormatter.format(v);
export const signedInr = (v: number) => `${v > 0 ? '+' : ''}${inr(v)}`;

/** Fixed decimals with Indian digit grouping; "—" for missing values. */
export function num(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export const int = (v: number) => v.toLocaleString('en-IN');

export const signedPct = (v: number, digits = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;

/** Indian lakh/crore shorthand for large counts such as open interest. */
export function compactIndian(v: number, digits = 2): string {
  const a = Math.abs(v);
  if (a >= 1e7) return `${(v / 1e7).toFixed(digits)} Cr`;
  if (a >= 1e5) return `${(v / 1e5).toFixed(digits)} L`;
  return v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

/** Axis-friendly variant: 1.2Cr, 3.4L, 12k. */
export function axisIndian(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
  return v.toFixed(0);
}
