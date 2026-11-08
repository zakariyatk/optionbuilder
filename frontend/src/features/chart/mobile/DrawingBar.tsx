import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRightFromLine,
  ArrowUpRight,
  Circle,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Magnet,
  Minus,
  MoveUpRight,
  Repeat,
  SeparatorVertical,
  Slash,
  Square,
  Trash2,
  TrendingDown,
  TrendingUp,
  Triangle,
  X,
} from 'lucide-react';
import { OverlayMode, type Chart } from 'klinecharts';
import { DRAWING_GROUP, positionDefaults, registerTools, selectedOverlay } from '../drawingTools';
import { useMobilePrefs, type Magnet as MagnetMode } from './mobilePrefs';

interface Tool {
  name: string;
  label: string;
  /** Taps it takes to place. */
  taps: number;
  icon: ReactNode;
  side?: 'long' | 'short';
}

const Glyph = ({ text }: { text: string }) => <span className="text-[11px] leading-none font-bold tracking-tight">{text}</span>;

/** Two parallel lines: a channel. */
const ChannelIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M2 13 14 3M6 17 18 7" />
  </svg>
);

const TOOLS: Tool[] = [
  { name: 'segment', label: 'Trend line', taps: 2, icon: <Slash size={20} aria-hidden="true" /> },
  { name: 'rayLine', label: 'Ray', taps: 2, icon: <MoveUpRight size={20} aria-hidden="true" /> },
  { name: 'horizontalStraightLine', label: 'Horizontal line', taps: 1, icon: <Minus size={20} aria-hidden="true" /> },
  { name: 'obHorizontalRay', label: 'Horizontal ray', taps: 1, icon: <ArrowRightFromLine size={20} aria-hidden="true" /> },
  { name: 'verticalStraightLine', label: 'Vertical line', taps: 1, icon: <SeparatorVertical size={20} aria-hidden="true" /> },
  { name: 'parallelStraightLine', label: 'Parallel channel', taps: 3, icon: <ChannelIcon /> },
  { name: 'fibonacciLine', label: 'Fib retracement', taps: 2, icon: <Glyph text="Fib" /> },
  { name: 'fibonacciExtension', label: 'Fib extension', taps: 3, icon: <Glyph text="FibX" /> },
  { name: 'rect', label: 'Rectangle', taps: 2, icon: <Square size={19} aria-hidden="true" /> },
  { name: 'circle', label: 'Circle', taps: 2, icon: <Circle size={19} aria-hidden="true" /> },
  { name: 'triangle', label: 'Triangle', taps: 3, icon: <Triangle size={19} aria-hidden="true" /> },
  { name: 'arrow', label: 'Arrow', taps: 2, icon: <ArrowUpRight size={20} aria-hidden="true" /> },
  { name: 'obLongPosition', label: 'Long position', taps: 1, icon: <TrendingUp size={20} aria-hidden="true" />, side: 'long' },
  { name: 'obShortPosition', label: 'Short position', taps: 1, icon: <TrendingDown size={20} aria-hidden="true" />, side: 'short' },
];

const MODE: Record<MagnetMode, OverlayMode> = { off: OverlayMode.Normal, weak: OverlayMode.WeakMagnet, strong: OverlayMode.StrongMagnet };
const MAGNET_NEXT: Record<MagnetMode, MagnetMode> = { off: 'weak', weak: 'strong', strong: 'off' };
const MAGNET_LABEL: Record<MagnetMode, string> = { off: 'Magnet off', weak: 'Weak magnet', strong: 'Strong magnet' };

/**
 * Finger-sized drawing tools over the bottom of the chart: pick a tool, tap
 * its points on the chart; drag a drawn point to adjust it. Magnet snaps
 * points to the bar's prices. Below the tools: lock, hide, delete the drawing
 * last tapped, and clear all.
 */
export function DrawingBar({ chart, onClose, notify }: { chart: Chart | null; onClose: () => void; notify: (msg: string) => void }) {
  const { magnet, keepDrawing, setMagnet, setKeepDrawing } = useMobilePrefs();
  const [tool, setTool] = useState<Tool | null>(null);
  const [locked, setLocked] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  /** The overlay being placed, so leaving the bar can cancel it. */
  const placing = useRef<string | null>(null);
  const keepRef = useRef(keepDrawing);
  keepRef.current = keepDrawing;
  const magnetRef = useRef(magnet);
  magnetRef.current = magnet;

  const cancel = () => {
    if (placing.current && chart) {
      const o = chart.getOverlayById(placing.current);
      // Still being placed (not every point tapped): take it off.
      if (o && o.currentStep !== -1) chart.removeOverlay(placing.current);
    }
    placing.current = null;
    setTool(null);
  };

  const start = (t: Tool) => {
    if (!chart) return;
    cancel();
    registerTools();
    setTool(t);
    const id = chart.createOverlay({
      name: t.name,
      groupId: DRAWING_GROUP,
      mode: MODE[magnetRef.current],
      lock: locked,
      extendData: t.side ? positionDefaults(chart, t.side) : undefined,
      onDrawEnd: () => {
        placing.current = null;
        if (keepRef.current) window.setTimeout(() => start(t), 0);
        else setTool(null);
        return false;
      },
    });
    placing.current = typeof id === 'string' ? id : null;
    if (hidden) {
      chart.overrideOverlay({ groupId: DRAWING_GROUP, visible: true });
      setHidden(false);
    }
  };

  // "Remove all?" asks only briefly; untouched, it goes back to "Clear all".
  useEffect(() => {
    if (!confirmClear) return;
    const t = window.setTimeout(() => setConfirmClear(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirmClear]);

  // Leaving drawing mode drops a drawing that was only half placed.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- on unmount only
  useEffect(() => () => cancel(), []);

  const action = (label: string, icon: ReactNode, onClick: () => void, active?: boolean) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-medium active:bg-[var(--surface-sunken)] ${
        active ? 'bg-[color-mix(in_srgb,var(--series-blue)_16%,transparent)] text-[var(--series-blue)]' : 'text-[var(--text-primary)]'
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div className="shrink-0 border-t border-[var(--border)] bg-[var(--surface-card)]" role="toolbar" aria-label="Drawing tools">
      <div className="flex h-7 items-center gap-2 px-3 text-[11px] text-[var(--text-muted)]" aria-live="polite">
        <span className="min-w-0 flex-1 truncate">
          {tool ? `${tool.label}: tap ${tool.taps === 1 ? 'the chart to place it' : `${tool.taps} points on the chart`}` : 'Pick a tool, then tap the chart. Drag a point to adjust.'}
        </span>
        {tool && (
          <button type="button" onClick={cancel} className="-my-2 h-11 shrink-0 px-1 font-semibold text-[var(--series-blue)]">
            Cancel
          </button>
        )}
      </div>
      <div className="ob-no-scrollbar flex gap-1 overflow-x-auto px-2 pb-1">
        {TOOLS.map((t) => (
          <button
            key={t.name}
            type="button"
            aria-label={t.label}
            title={t.label}
            aria-pressed={tool?.name === t.name}
            onClick={() => (tool?.name === t.name ? cancel() : start(t))}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg active:bg-[var(--surface-sunken)] ${
              tool?.name === t.name ? 'bg-[color-mix(in_srgb,var(--series-blue)_16%,transparent)] text-[var(--series-blue)]' : 'text-[var(--text-primary)]'
            }`}
          >
            {t.icon}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-0.5 border-t border-[var(--border)] px-1">
        {action(
          MAGNET_LABEL[magnet],
          <>
            <Magnet size={19} aria-hidden="true" />
            {magnet !== 'off' && <span>{magnet === 'weak' ? 'Weak' : 'Strong'}</span>}
          </>,
          () => {
            const next = MAGNET_NEXT[magnet];
            setMagnet(next);
            notify(MAGNET_LABEL[next]);
          },
          magnet !== 'off',
        )}
        {action('Keep drawing', <Repeat size={19} aria-hidden="true" />, () => {
          setKeepDrawing(!keepDrawing);
          notify(keepDrawing ? 'One drawing per tool' : 'Tool stays picked for more drawings');
        }, keepDrawing)}
        {action(locked ? 'Unlock drawings' : 'Lock drawings', locked ? <Lock size={19} aria-hidden="true" /> : <LockOpen size={19} aria-hidden="true" />, () => {
          chart?.overrideOverlay({ groupId: DRAWING_GROUP, lock: !locked });
          setLocked(!locked);
          notify(locked ? 'Drawings unlocked' : 'Drawings locked');
        }, locked)}
        {action(hidden ? 'Show drawings' : 'Hide drawings', hidden ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />, () => {
          chart?.overrideOverlay({ groupId: DRAWING_GROUP, visible: hidden });
          setHidden(!hidden);
        }, hidden)}
        {action('Delete selected drawing', <Trash2 size={19} aria-hidden="true" />, () => {
          const o = chart && selectedOverlay(chart);
          if (!chart || !o || o.groupId !== DRAWING_GROUP || !chart.getOverlayById(o.id)) {
            notify('Tap a drawing first, then delete');
            return;
          }
          chart.removeOverlay(o.id);
          notify('Drawing deleted');
        })}
        <span className="flex-1" />
        {confirmClear ? (
          <button
            type="button"
            onClick={() => {
              chart?.removeOverlay({ groupId: DRAWING_GROUP });
              setConfirmClear(false);
              notify('All drawings removed');
            }}
            className="h-9 shrink-0 rounded-lg bg-[var(--critical)] px-3 text-xs font-semibold text-white"
          >
            Remove all?
          </button>
        ) : (
          <button type="button" onClick={() => setConfirmClear(true)} className="h-11 shrink-0 px-2 text-xs font-medium text-[var(--text-secondary)]">
            Clear all
          </button>
        )}
        {action('Close drawing tools', <X size={19} aria-hidden="true" />, () => {
          cancel();
          onClose();
        })}
      </div>
    </div>
  );
}
