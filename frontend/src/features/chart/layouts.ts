/**
 * Multi-chart layouts, as in TradingView's "Layout setup". Each layout is a
 * CSS grid: `areas` names one letter per chart (a = chart 1, b = chart 2, …)
 * and the same strings draw its icon.
 */
export interface ChartLayout {
  id: string;
  label: string;
  /** grid-template-areas rows, e.g. ['a b', 'a c']. */
  areas: string[];
}

export const LAYOUTS: ChartLayout[] = [
  { id: '1', label: 'One chart', areas: ['a'] },
  { id: '2v', label: 'Two charts side by side', areas: ['a b'] },
  { id: '2h', label: 'Two charts stacked', areas: ['a', 'b'] },
  { id: '3v', label: 'Three charts side by side', areas: ['a b c'] },
  { id: '3h', label: 'Three charts stacked', areas: ['a', 'b', 'c'] },
  { id: '3l', label: 'One large left, two stacked right', areas: ['a b', 'a c'] },
  { id: '3r', label: 'Two stacked left, one large right', areas: ['a c', 'b c'] },
  { id: '3t', label: 'Two on top, one below', areas: ['a b', 'c c'] },
  { id: '3b', label: 'One on top, two below', areas: ['a a', 'b c'] },
  { id: '4g', label: 'Four charts in a grid', areas: ['a b', 'c d'] },
  { id: '4v', label: 'Four charts side by side', areas: ['a b c d'] },
  { id: '4h', label: 'Four charts stacked', areas: ['a', 'b', 'c', 'd'] },
];

export const MAX_CHARTS = 4;
export const CELL_NAMES = ['a', 'b', 'c', 'd'] as const;

export const layoutById = (id: string): ChartLayout => LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0];

/** How many charts a layout shows. */
export const chartCount = (l: ChartLayout) => new Set(l.areas.join(' ').split(/\s+/)).size;

/** Each chart's box within a unit square: x / y / w / h as fractions, in chart order. */
export function cellRects(l: ChartLayout): { x: number; y: number; w: number; h: number }[] {
  const grid = l.areas.map((row) => row.trim().split(/\s+/));
  const rows = grid.length;
  const cols = grid[0].length;
  return CELL_NAMES.slice(0, chartCount(l)).map((name) => {
    let r0 = rows,
      r1 = -1,
      c0 = cols,
      c1 = -1;
    grid.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (cell !== name) return;
        r0 = Math.min(r0, r);
        r1 = Math.max(r1, r);
        c0 = Math.min(c0, c);
        c1 = Math.max(c1, c);
      }),
    );
    return { x: c0 / cols, y: r0 / rows, w: (c1 - c0 + 1) / cols, h: (r1 - r0 + 1) / rows };
  });
}

/** CSS for the layout's grid. */
export function gridStyle(l: ChartLayout) {
  const cols = l.areas[0].trim().split(/\s+/).length;
  return {
    gridTemplateAreas: l.areas.map((r) => `"${r}"`).join(' '),
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${l.areas.length}, minmax(0, 1fr))`,
  };
}
