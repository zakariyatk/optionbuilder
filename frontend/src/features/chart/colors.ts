/** Small colour helpers for the chart settings (hex / rgb[a] strings only). */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(s)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    if (full.length !== 6 && full.length !== 8) return null;
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? Math.round((n(6) / 255) * 100) / 100 : 1 };
  }
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { r: +m[1], g: +m[2], b: +m[3], a: Math.min(1, Math.max(0, a)) };
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');

export const toHex = ({ r, g, b }: Rgba) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

export function formatColor(c: Rgba): string {
  return c.a >= 1 ? toHex(c).toUpperCase() : `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(c.a * 100) / 100})`;
}

/** `color` at opacity `a` (0–1); unknown formats come back unchanged. */
export function withAlpha(color: string, a: number): string {
  const c = parseColor(color);
  return c ? formatColor({ ...c, a }) : color;
}
