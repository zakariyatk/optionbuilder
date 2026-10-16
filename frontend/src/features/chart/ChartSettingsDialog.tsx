import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Bell, ChartCandlestick, ChevronDown, PaintBucket, Ruler, Trash2, Type, X } from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  effectiveSettings,
  themeColors,
  useChartSettings,
  type ButtonsMode,
  type ChartSettings,
  type ChartStyle,
  type ScaleMode,
} from './chartSettingsStore';
import { formatColor, parseColor, toHex } from './colors';

type Section = 'symbol' | 'status' | 'scales' | 'canvas' | 'alerts';

const SECTIONS: { id: Section; label: string; icon: ReactNode }[] = [
  { id: 'symbol', label: 'Symbol', icon: <ChartCandlestick size={18} aria-hidden="true" /> },
  { id: 'status', label: 'Status line', icon: <Type size={18} aria-hidden="true" /> },
  { id: 'scales', label: 'Scales and lines', icon: <Ruler size={18} aria-hidden="true" /> },
  { id: 'canvas', label: 'Canvas', icon: <PaintBucket size={18} aria-hidden="true" /> },
  { id: 'alerts', label: 'Alerts', icon: <Bell size={18} aria-hidden="true" /> },
];

/** TradingView's colour palette: greys, then hues from light to dark. */
const PALETTE = [
  ['#FFFFFF', '#D1D4DC', '#B2B5BE', '#9598A1', '#787B86', '#5D606B', '#434651', '#2A2E39', '#131722', '#000000'],
  ['#F23645', '#FF9800', '#FFEB3B', '#4CAF50', '#089981', '#00BCD4', '#2962FF', '#673AB7', '#9C27B0', '#E91E63'],
  ['#FCCBCD', '#FFE0B2', '#FFF9C4', '#C8E6C9', '#ACE5DC', '#B2EBF2', '#BBD9FB', '#D1C4E9', '#E1BEE7', '#F8BBD0'],
  ['#F7525F', '#FFB74D', '#FFF176', '#81C784', '#42BDA8', '#4DD0E1', '#5B9CF6', '#9575CD', '#BA68C8', '#F06292'],
  ['#B22833', '#F57C00', '#FBC02D', '#388E3C', '#056656', '#0097A7', '#1848CC', '#512DA8', '#7B1FA2', '#C2185B'],
];

/** A colour swatch that opens TradingView's palette, with opacity and a custom colour. `null` = the theme's colour. */
function ColorField({
  label,
  value,
  themeValue,
  onChange,
}: {
  label: string;
  value: string | null;
  /** The theme's colour, when the setting may follow the theme. */
  themeValue?: string;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const shown = value ?? themeValue ?? '#000000';
  const rgba = parseColor(shown) ?? { r: 0, g: 0, b: 0, a: 1 };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const pick = (hex: string) => {
    const c = parseColor(hex);
    if (c) onChange(formatColor({ ...c, a: rgba.a }));
  };
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={`${label} colour`}
        aria-expanded={open}
        title={value === null && themeValue ? 'Follows the theme' : shown}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-strong)] hover:border-[var(--text-secondary)]"
        style={{ backgroundImage: 'repeating-conic-gradient(#8884 0% 25%, transparent 0% 50%)', backgroundSize: '8px 8px' }}
      >
        <span className="h-5 w-5 rounded-sm border border-black/10" style={{ background: shown }} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`${label} colour`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          className="absolute top-10 right-0 z-20 w-[244px] rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] p-3 shadow-2xl"
        >
          <div className="grid grid-cols-10 gap-1">
            {PALETTE.flat().map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => pick(c)}
                className={`h-5 w-5 rounded-sm border ${toHex(rgba).toUpperCase() === c ? 'border-[var(--series-blue)] ring-1 ring-[var(--series-blue)]' : 'border-black/10'}`}
                style={{ background: c }}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-[var(--border)] pt-3">
            <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]" title="Custom colour">
              <input type="color" value={toHex(rgba)} onChange={(e) => pick(e.target.value)} className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0" />
              Custom
            </label>
            {themeValue !== undefined && (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                disabled={value === null}
                className="ml-auto rounded px-2 py-1 text-xs text-[var(--series-blue)] hover:bg-[var(--surface-sunken)] disabled:text-[var(--text-muted)] disabled:hover:bg-transparent"
              >
                Theme default
              </button>
            )}
          </div>
          <label className="mt-3 block text-xs text-[var(--text-secondary)]">
            <span className="flex justify-between">
              Opacity <span className="tabular-nums">{Math.round(rgba.a * 100)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(rgba.a * 100)}
              onChange={(e) => onChange(formatColor({ ...rgba, a: Number(e.target.value) / 100 }))}
              className="mt-1 w-full accent-[var(--series-blue)]"
              aria-label={`${label} opacity`}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex min-h-8 cursor-pointer items-center gap-2.5 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--series-blue)]" />
      {label}
    </label>
  );
}

function Select<T extends string | number>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <select
      aria-label={label}
      value={String(value)}
      onChange={(e) => onChange(options.find((o) => String(o.v) === e.target.value)!.v)}
      className="h-8 min-w-36 rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 text-sm"
    >
      {options.map((o) => (
        <option key={String(o.v)} value={String(o.v)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function NumberField({ value, onChange, label, min, max, suffix }: { value: number; onChange: (v: number) => void; label: string; min: number; max: number; suffix?: string }) {
  return (
    <span className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
      <input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))));
        }}
        className="h-8 w-16 rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 text-[var(--text-primary)] tabular-nums"
      />
      {suffix}
    </span>
  );
}

/** One line of the dialog: the label (or a checkbox) on the left, its controls on the right. */
function Row({ label, children }: { label: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-1">
      <div className="min-w-0 text-sm">{label}</div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

const Heading = ({ children }: { children: ReactNode }) => (
  <h3 className="mt-5 mb-1 text-[11px] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase first:mt-0">{children}</h3>
);

/** Template ▾: save the current setup by name, switch to a saved one, or go back to the defaults. */
function TemplateMenu({ current, onApply }: { current: ChartSettings; onApply: (s: ChartSettings) => void }) {
  const templates = useChartSettings((s) => s.templates);
  const save = useChartSettings((s) => s.saveTemplate);
  const remove = useChartSettings((s) => s.removeTemplate);
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const close = () => {
    setOpen(false);
    setNaming(false);
    setName('');
  };
  const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surface-sunken)]';
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--border-strong)] px-3 text-sm hover:bg-[var(--surface-sunken)]"
      >
        Template <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            }
          }}
          className="absolute bottom-11 left-0 z-20 w-64 overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] py-1 shadow-2xl"
        >
          {naming ? (
            <form
              className="flex gap-2 p-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                save(name, current);
                close();
              }}
            >
              <input
                autoFocus
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                placeholder="Template name"
                aria-label="Template name"
                className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--surface-card)] px-2 text-sm"
              />
              <button type="submit" disabled={!name.trim()} className="rounded-md bg-[var(--series-blue)] px-3 text-sm font-medium text-white disabled:opacity-50">
                Save
              </button>
            </form>
          ) : (
            <button type="button" className={item} onClick={() => setNaming(true)}>
              Save as…
            </button>
          )}
          <button
            type="button"
            className={item}
            onClick={() => {
              onApply(DEFAULT_SETTINGS);
              close();
            }}
          >
            Reset to defaults
          </button>
          {templates.length > 0 && <div className="my-1 border-t border-[var(--border)]" />}
          {templates.map((t) => (
            <div key={t.name} className="flex items-center hover:bg-[var(--surface-sunken)]">
              <button
                type="button"
                className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm"
                onClick={() => {
                  onApply(t.settings);
                  close();
                }}
              >
                {t.name}
              </button>
              <button
                type="button"
                aria-label={`Delete template ${t.name}`}
                onClick={() => remove(t.name)}
                className="mr-1 rounded p-1.5 text-[var(--text-muted)] hover:text-[var(--danger,#f23645)]"
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * TradingView's chart Settings: Symbol, Status line, Scales and lines,
 * Canvas and Alerts. Every change shows on the charts straight away; Ok keeps
 * it (for every chart, in this browser), Cancel or Escape puts it back.
 */
export function ChartSettingsDialog({ theme, onClose }: { theme: 'light' | 'dark'; onClose: () => void }) {
  const s = useChartSettings(effectiveSettings);
  const edit = useChartSettings((st) => st.edit);
  const previewAll = useChartSettings((st) => st.previewAll);
  const [section, setSection] = useState<Section>('symbol');
  const t = themeColors(theme);
  const dialog = useRef<HTMLDivElement>(null);

  // Closing any way but Ok drops the preview (after Ok there is none left to drop).
  useEffect(() => {
    const returnTo = document.activeElement;
    dialog.current?.focus();
    return () => {
      useChartSettings.getState().revert();
      if (returnTo instanceof HTMLElement) returnTo.focus();
    };
  }, []);

  const cancel = () => {
    useChartSettings.getState().revert();
    onClose();
  };
  const ok = () => {
    useChartSettings.getState().commit();
    onClose();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  const set = <K extends keyof ChartSettings>(k: K) => (v: ChartSettings[K]) => edit({ [k]: v } as Partial<ChartSettings>);
  const check = (k: keyof ChartSettings & string, label: string) => <Check label={label} checked={s[k] as boolean} onChange={set(k) as (v: boolean) => void} />;
  /** Up / down colour pair for a candle part. */
  const pair = (up: 'upBody' | 'upBorder' | 'upWick', down: 'downBody' | 'downBorder' | 'downWick', label: string) => (
    <>
      <ColorField label={`${label} up`} value={s[up]} onChange={(v) => edit({ [up]: v ?? DEFAULT_SETTINGS[up] })} />
      <ColorField label={`${label} down`} value={s[down]} onChange={(v) => edit({ [down]: v ?? DEFAULT_SETTINGS[down] })} />
    </>
  );

  const body: Record<Section, ReactNode> = {
    symbol: (
      <>
        <Heading>Chart style</Heading>
        <Row label="Style">
          <Select<ChartStyle>
            label="Chart style"
            value={s.chartStyle}
            onChange={set('chartStyle')}
            options={[
              { v: 'candles', label: 'Candles' },
              { v: 'hollow', label: 'Hollow candles' },
              { v: 'bars', label: 'Bars (OHLC)' },
              { v: 'area', label: 'Area' },
            ]}
          />
        </Row>
        <Heading>Candles</Heading>
        <Row label={check('body', 'Body')}>{pair('upBody', 'downBody', 'Body')}</Row>
        <Row label={check('borders', 'Borders')}>{pair('upBorder', 'downBorder', 'Border')}</Row>
        <Row label={check('wick', 'Wick')}>{pair('upWick', 'downWick', 'Wick')}</Row>
        <Heading>Price lines</Heading>
        <Row label={check('lastPriceLine', 'Last price line')} />
        <Row label={check('highLowMarks', 'High and low price marks')} />
      </>
    ),
    status: (
      <>
        <Heading>Symbol</Heading>
        <Row label={check('legendTitle', 'Title (name · interval · exchange)')} />
        <Row label={check('legendOhlc', 'Open, high, low and close values')} />
        <Row label={check('legendChange', 'Bar change values')} />
        <Row label={check('legendVolume', 'Volume')} />
        <Heading>Indicators</Heading>
        <Row label={check('indicatorLegend', 'Indicator titles and values')} />
        <Row label={check('indicatorArgs', 'Indicator arguments')} />
      </>
    ),
    scales: (
      <>
        <Heading>Price scale</Heading>
        <Row label="Scale mode">
          <Select<ScaleMode>
            label="Scale mode"
            value={s.scaleMode}
            onChange={set('scaleMode')}
            options={[
              { v: 'normal', label: 'Regular' },
              { v: 'percent', label: 'Percent' },
              { v: 'log', label: 'Logarithmic' },
            ]}
          />
        </Row>
        <Row label="Placement">
          <Select
            label="Price scale placement"
            value={s.scalePosition}
            onChange={set('scalePosition')}
            options={[
              { v: 'right', label: 'Right' },
              { v: 'left', label: 'Left' },
            ]}
          />
        </Row>
        <Row label={check('lastPriceLabel', 'Last price label')} />
        <Row label={<span className={s.lastPriceLabel ? '' : 'opacity-50'}>{check('countdown', 'Countdown to bar close')}</span>} />
      </>
    ),
    canvas: (
      <>
        <Heading>Chart basic styles</Heading>
        <Row label="Background">
          <ColorField label="Background" value={s.background} themeValue={t.background} onChange={set('background')} />
        </Row>
        <Row label={check('vertGrid', 'Vert grid lines')}>
          <ColorField label="Vertical grid lines" value={s.vertGridColor} themeValue={t.grid} onChange={set('vertGridColor')} />
        </Row>
        <Row label={check('horzGrid', 'Horz grid lines')}>
          <ColorField label="Horizontal grid lines" value={s.horzGridColor} themeValue={t.grid} onChange={set('horzGridColor')} />
        </Row>
        <Row label="Crosshair">
          <ColorField label="Crosshair" value={s.crosshairColor} themeValue={t.crosshair} onChange={set('crosshairColor')} />
          <Select
            label="Crosshair line"
            value={s.crosshairDashed ? 'dashed' : 'solid'}
            onChange={(v) => edit({ crosshairDashed: v === 'dashed' })}
            options={[
              { v: 'dashed', label: 'Dashed' },
              { v: 'solid', label: 'Solid' },
            ]}
          />
        </Row>
        <Row label={check('watermark', 'Replay watermark')}>
          <ColorField label="Replay watermark" value={s.watermarkColor} themeValue={t.watermark} onChange={set('watermarkColor')} />
        </Row>
        <Heading>Scales</Heading>
        <Row label="Text">
          <ColorField label="Scale text" value={s.scaleTextColor} themeValue={t.scaleText} onChange={set('scaleTextColor')} />
          <Select<number>
            label="Scale text size"
            value={s.scaleTextSize}
            onChange={set('scaleTextSize')}
            options={[10, 11, 12, 13, 14, 16].map((n) => ({ v: n, label: String(n) }))}
          />
        </Row>
        <Row label="Lines">
          <ColorField label="Scale lines" value={s.scaleLineColor} themeValue={t.scaleLine} onChange={set('scaleLineColor')} />
        </Row>
        <Heading>Buttons</Heading>
        <Row label="Price scale buttons (A / L)">
          <Select<ButtonsMode>
            label="Price scale buttons"
            value={s.buttons}
            onChange={set('buttons')}
            options={[
              { v: 'always', label: 'Always visible' },
              { v: 'hover', label: 'Visible on mouse over' },
              { v: 'never', label: 'Hidden' },
            ]}
          />
        </Row>
        <Heading>Margins</Heading>
        <Row label="Top">
          <NumberField label="Top margin" value={s.marginTop} onChange={set('marginTop')} min={0} max={40} suffix="%" />
        </Row>
        <Row label="Bottom">
          <NumberField label="Bottom margin" value={s.marginBottom} onChange={set('marginBottom')} min={0} max={40} suffix="%" />
        </Row>
      </>
    ),
    alerts: (
      <>
        <Heading>On the chart</Heading>
        <Row label={check('alertLines', 'Show alert lines')}>
          <ColorField label="Alert lines" value={s.alertColor} themeValue={t.alert} onChange={set('alertColor')} />
        </Row>
        <Row label={check('alertAxisLabel', 'Alert label on the price scale')} />
        <Heading>When an alert fires</Heading>
        <Row label={check('alertSound', 'Play a sound')} />
        <Row label={check('alertPopup', 'Show a popup')} />
      </>
    ),
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 sm:p-6 sm:pt-[8vh]">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chart-settings-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="flex h-full w-full flex-col overflow-hidden border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-2xl outline-none sm:h-[min(80vh,640px)] sm:max-w-3xl sm:rounded-xl sm:border"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5 max-sm:px-3">
          <h2 id="chart-settings-title" className="text-lg font-semibold">
            Settings
          </h2>
          <button type="button" onClick={cancel} aria-label="Close" className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]">
            <X size={20} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 max-sm:flex-col">
          <nav aria-label="Settings sections" className="flex shrink-0 border-[var(--border)] sm:w-52 sm:flex-col sm:border-r sm:py-2 max-sm:overflow-x-auto max-sm:border-b">
            {SECTIONS.map((x) => (
              <button
                key={x.id}
                type="button"
                aria-current={section === x.id ? 'page' : undefined}
                onClick={() => setSection(x.id)}
                className={`flex shrink-0 items-center gap-3 px-5 py-2.5 text-left text-sm whitespace-nowrap max-sm:px-3 ${
                  section === x.id
                    ? 'bg-[var(--surface-sunken)] font-semibold text-[var(--text-primary)] sm:shadow-[inset_3px_0_0_var(--series-blue)] max-sm:shadow-[inset_0_-2px_0_var(--series-blue)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]'
                }`}
              >
                {x.icon}
                {x.label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 py-4 max-sm:px-4">{body[section]}</div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-5 py-3 max-sm:px-3">
          <TemplateMenu current={s} onApply={previewAll} />
          <div className="flex gap-2">
            <button type="button" onClick={cancel} className="h-9 rounded-md border border-[var(--border-strong)] px-4 text-sm hover:bg-[var(--surface-sunken)]">
              Cancel
            </button>
            <button type="button" onClick={ok} className="h-9 rounded-md bg-[var(--series-blue)] px-5 text-sm font-medium text-white hover:brightness-110">
              Ok
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
