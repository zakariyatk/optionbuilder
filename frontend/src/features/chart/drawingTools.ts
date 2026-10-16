import { init, registerOverlay, type Chart, type Overlay, type OverlayEvent, type OverlayFigure, type OverlayTemplate, type Point } from 'klinecharts';

/**
 * Extra drawing tools for the KLineChart Pro toolbar, TradingView-style:
 * a one-click horizontal ray, and long / short position boxes with target,
 * stop and risk/reward. KLineChart Pro hard-codes its toolbar, so the buttons
 * are added to its drawing bar here.
 */

/** KLineChart Pro's group for drawings — its lock / hide / remove-all buttons act on it. */
const DRAWING_GROUP = 'drawing_tools';

const GOOD = '#089981';
const BAD = '#f23645';
const GOOD_FILL = 'rgba(8, 153, 129, 0.18)';
const BAD_FILL = 'rgba(242, 54, 69, 0.18)';
const NEUTRAL = '#787b86';

/** klinecharts' `currentStep` once an overlay is fully drawn. */
const OVERLAY_DRAW_STEP_FINISHED = -1;

type Side = 'long' | 'short';
interface PositionData {
  side: Side;
  /** Price distance from entry to stop when placed; the target starts at twice that. */
  risk: number;
  /** Width of the box in bars when placed. */
  bars: number;
}

const label = (color: string): Record<string, unknown> => ({
  color: '#ffffff',
  backgroundColor: color,
  borderColor: color,
  borderRadius: 3,
  paddingLeft: 6,
  paddingRight: 6,
  paddingTop: 4,
  paddingBottom: 4,
  size: 12,
});

/** A line from where you click, running to the right edge. */
const horizontalRay: OverlayTemplate = {
  name: 'obHorizontalRay',
  totalStep: 2,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates, bounding }) => {
    const [p] = coordinates;
    return p ? [{ type: 'line', attrs: { coordinates: [p, { x: bounding.width, y: p.y }] } }] : [];
  },
};

/**
 * Points: [entry, target, stop, right edge]. Entry, target and stop share the
 * entry's bar (their handles sit on the box's left edge); the right edge sits
 * on the entry price.
 */
function syncPosition(points: Partial<Point>[]) {
  const [entry, target, stop, end] = points;
  if (!entry || !target || !stop || !end) return;
  for (const p of [target, stop]) {
    p.dataIndex = entry.dataIndex;
    p.timestamp = entry.timestamp;
  }
  end.value = entry.value;
  if ((end.dataIndex ?? 0) <= (entry.dataIndex ?? 0)) {
    end.dataIndex = (entry.dataIndex ?? 0) + 1;
    end.timestamp = undefined;
  }
}

/**
 * Position boxes whose labels are showing: TradingView shows the target, stop
 * and risk/reward only on the box you're hovering or have selected.
 */
const hovered = new Set<string>();
const selected = new Set<string>();
const track = (set: Set<string>, on: boolean) => ({ overlay }: OverlayEvent) => {
  if (on) set.add(overlay.id);
  else set.delete(overlay.id);
  return false;
};

function positionTool(side: Side): OverlayTemplate {
  return {
    name: side === 'long' ? 'obLongPosition' : 'obShortPosition',
    // One click places the whole box; its other points follow the cursor while placing.
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: true,
    performEventMoveForDrawing(this: Overlay, { points }) {
      const entry = points[0];
      const { risk, bars } = (this.extendData ?? { risk: 0, bars: 20 }) as PositionData;
      const price = entry?.value;
      if (!entry || price === undefined) return;
      const dir = side === 'long' ? 1 : -1;
      points[1] = { dataIndex: entry.dataIndex, timestamp: entry.timestamp, value: price + dir * risk * 2 };
      points[2] = { dataIndex: entry.dataIndex, timestamp: entry.timestamp, value: price - dir * risk };
      points[3] = { dataIndex: (entry.dataIndex ?? 0) + bars, value: price };
    },
    performEventPressedMove: ({ points }) => syncPosition(points),
    onMouseEnter: track(hovered, true),
    onMouseLeave: track(hovered, false),
    onSelected: track(selected, true),
    onDeselected: track(selected, false),
    onRemoved: ({ overlay }) => {
      hovered.delete(overlay.id);
      selected.delete(overlay.id);
      return false;
    },
    createPointFigures: ({ coordinates, overlay, precision }) => {
      if (coordinates.length < 4) return [];
      const [e, t, s, r] = coordinates;
      const [entry, target, stop] = overlay.points.map((p) => p.value ?? 0);
      const x = Math.min(e.x, r.x);
      const width = Math.max(Math.abs(r.x - e.x), 1);
      const mid = x + width / 2;
      const fmt = (v: number) => v.toLocaleString('en-IN', { minimumFractionDigits: precision.price, maximumFractionDigits: precision.price });
      const pct = (v: number) => (entry ? ((Math.abs(v - entry) / entry) * 100).toFixed(3) : '0');
      const reward = Math.abs(target - entry);
      const riskAmt = Math.abs(entry - stop);
      const rr = riskAmt ? (reward / riskAmt).toFixed(2) : '—';
      // A label sits just outside its edge of the box: above the upper edge, below the lower one.
      const edge = (y: number) => (y <= e.y ? { y: y - 4, baseline: 'bottom' } : { y: y + 4, baseline: 'top' });
      const figures: OverlayFigure[] = [
        { type: 'rect', attrs: { x, y: Math.min(e.y, t.y), width, height: Math.abs(t.y - e.y) }, styles: { style: 'fill', color: GOOD_FILL } },
        { type: 'rect', attrs: { x, y: Math.min(e.y, s.y), width, height: Math.abs(s.y - e.y) }, styles: { style: 'fill', color: BAD_FILL } },
        { type: 'line', attrs: { coordinates: [{ x, y: e.y }, { x: x + width, y: e.y }] }, styles: { color: NEUTRAL } },
        {
          type: 'text',
          ignoreEvent: true,
          attrs: { x: mid, ...edge(t.y), align: 'center', text: `Target: ${fmt(reward)} (${pct(target)}%) · ${fmt(target)}` },
          styles: label(GOOD),
        },
        {
          type: 'text',
          ignoreEvent: true,
          attrs: { x: mid, ...edge(s.y), align: 'center', text: `Stop: ${fmt(riskAmt)} (${pct(stop)}%) · ${fmt(stop)}` },
          styles: label(BAD),
        },
        {
          type: 'text',
          ignoreEvent: true,
          attrs: { x: mid, y: e.y, align: 'center', baseline: 'middle', text: `${side === 'long' ? 'Long' : 'Short'} ${fmt(entry)} · Risk/reward ${rr}` },
          styles: label(side === 'long' ? GOOD : BAD),
        },
      ];
      const active = overlay.currentStep !== OVERLAY_DRAW_STEP_FINISHED || hovered.has(overlay.id) || selected.has(overlay.id);
      return active ? figures : figures.slice(0, 3);
    },
  };
}

let registered = false;
function registerTools() {
  if (registered) return;
  registered = true;
  registerOverlay(horizontalRay);
  registerOverlay(positionTool('long'));
  registerOverlay(positionTool('short'));
}

/** Starting size of a position box: a slice of what's on screen. */
function positionDefaults(chart: Chart, side: Side): PositionData {
  const data = chart.getDataList();
  const { from, to } = chart.getVisibleRange();
  const visible = data.slice(Math.max(0, from), Math.max(from + 1, to));
  const high = Math.max(...visible.map((d) => d.high));
  const low = Math.min(...visible.map((d) => d.low));
  const span = Number.isFinite(high - low) && high > low ? high - low : (data.at(-1)?.close ?? 100) * 0.01;
  return { side, risk: span * 0.1, bars: Math.max(5, Math.round((to - from) * 0.15)) };
}

/**
 * TradingView's position icon: target and stop lines with their handles,
 * and the entry tag lettered L or S between them. Drawn in the toolbar's
 * current colour so it follows hover, selection and the theme.
 */
const positionIcon = (letter: 'L' | 'S') =>
  '<g fill="none" stroke-width="1.2">' +
  '<circle cx="6.5" cy="7.5" r="2"/><path d="M8.5 7.5H26"/>' +
  '<path d="M4.5 16H12M20 16H26"/><rect x="12" y="12" width="8" height="8" rx="1"/>' +
  '<circle cx="6.5" cy="24.5" r="2"/><path d="M8.5 24.5H26"/>' +
  '</g>' +
  `<text x="16" y="18.6" text-anchor="middle" font-size="7.5" font-weight="600" font-family="system-ui, sans-serif" stroke="none">${letter}</text>`;

const ICONS: Record<string, string> = {
  obHorizontalRay: '<circle cx="8" cy="16" r="2.5" fill="none" stroke-width="1.5"/><path d="M10.5 16H26" stroke-width="1.5" fill="none"/>',
  obLongPosition: positionIcon('L'),
  obShortPosition: positionIcon('S'),
};

const TOOLS: { name: keyof typeof ICONS & string; title: string; side?: Side }[] = [
  { name: 'obHorizontalRay', title: 'Horizontal ray (Alt + J)' },
  { name: 'obLongPosition', title: 'Long position', side: 'long' },
  { name: 'obShortPosition', title: 'Short position', side: 'short' },
];

/** KLineChart Pro doesn't expose its chart; klinecharts hands back the instance already on an element. */
function innerChart(widget: HTMLElement): Chart | null {
  const id = widget.getAttribute('k-line-chart-id');
  if (!id) return null;
  const prev = widget.id;
  widget.id = id;
  try {
    return init(widget);
  } finally {
    widget.id = prev;
  }
}

/**
 * Adds the tools to the Pro chart's drawing bar inside `container`, and keeps
 * them there if the bar re-renders. Returns a cleanup.
 */
export function installDrawingTools(container: HTMLElement): () => void {
  registerTools();
  let chart: Chart | null = null;
  const buttons: HTMLElement[] = [];

  const start = (tool: (typeof TOOLS)[number]) => {
    const widget = container.querySelector<HTMLElement>('.klinecharts-pro-widget');
    chart ??= widget ? innerChart(widget) : null;
    if (!chart) return;
    const icon = buttons.find((b) => b.dataset.tool === tool.name)?.querySelector('.icon-overlay');
    buttons.forEach((b) => b.querySelector('.icon-overlay')?.classList.remove('selected'));
    icon?.classList.add('selected');
    chart.createOverlay({
      name: tool.name,
      groupId: DRAWING_GROUP,
      extendData: tool.side ? positionDefaults(chart, tool.side) : undefined,
      onDrawEnd: () => {
        icon?.classList.remove('selected');
        return false;
      },
    });
  };

  const mount = () => {
    const bar = container.querySelector<HTMLElement>('.klinecharts-pro-drawing-bar');
    if (!bar || bar.querySelector('[data-tool]')) return;
    // Before the magnet / lock / visibility group, after the built-in tools.
    const anchor = bar.querySelectorAll(':scope > .split-line')[1] ?? null;
    buttons.length = 0;
    for (const tool of TOOLS) {
      const item = document.createElement('div');
      item.className = 'item';
      item.tabIndex = 0;
      item.dataset.tool = tool.name;
      item.title = tool.title;
      item.setAttribute('role', 'button');
      item.setAttribute('aria-label', tool.title);
      item.innerHTML = `<span style="width:32px;height:32px"><svg class="icon-overlay" viewBox="0 0 32 32">${ICONS[tool.name]}</svg></span>`;
      item.addEventListener('click', () => start(tool));
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          start(tool);
        }
      });
      bar.insertBefore(item, anchor);
      buttons.push(item);
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.altKey && e.code === 'KeyJ' && container.isConnected) {
      e.preventDefault();
      start(TOOLS[0]);
    }
  };

  mount();
  const observer = new MutationObserver(mount);
  observer.observe(container, { childList: true, subtree: true });
  window.addEventListener('keydown', onKey);
  return () => {
    observer.disconnect();
    window.removeEventListener('keydown', onKey);
    buttons.forEach((b) => b.remove());
  };
}
