import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** TradingView's candle colours (as tvStyle.ts; kept here so this module stays free of the chart library). */
const TV_UP = '#089981';
const TV_DOWN = '#F23645';

/**
 * The chart's Settings dialog (TradingView's): how candles, the legend,
 * scales, canvas and alerts look on every chart, saved in this browser.
 * A colour left at `null` follows the light / dark theme. No chart-library
 * imports here: the alert popups (main bundle) read these settings too.
 */

export type ChartStyle = 'candles' | 'hollow' | 'bars' | 'area';
export type ScaleMode = 'normal' | 'percent' | 'log';
export type ButtonsMode = 'always' | 'hover' | 'never';

export interface ChartSettings {
  // Symbol
  chartStyle: ChartStyle;
  body: boolean;
  upBody: string;
  downBody: string;
  borders: boolean;
  upBorder: string;
  downBorder: string;
  wick: boolean;
  upWick: string;
  downWick: string;
  lastPriceLine: boolean;
  highLowMarks: boolean;
  // Status line
  legendTitle: boolean;
  legendOhlc: boolean;
  legendChange: boolean;
  legendVolume: boolean;
  indicatorLegend: boolean;
  indicatorArgs: boolean;
  // Scales and lines
  scaleMode: ScaleMode;
  scalePosition: 'right' | 'left';
  lastPriceLabel: boolean;
  countdown: boolean;
  // Canvas
  background: string | null;
  vertGrid: boolean;
  vertGridColor: string | null;
  horzGrid: boolean;
  horzGridColor: string | null;
  crosshairColor: string | null;
  crosshairDashed: boolean;
  watermark: boolean;
  watermarkColor: string | null;
  scaleTextColor: string | null;
  scaleTextSize: number;
  scaleLineColor: string | null;
  buttons: ButtonsMode;
  /** Space above / below the candles, in % of the pane. */
  marginTop: number;
  marginBottom: number;
  // Alerts
  alertLines: boolean;
  alertColor: string | null;
  alertAxisLabel: boolean;
  alertSound: boolean;
  alertPopup: boolean;
}

/** Before this dialog the L button kept the log scale under its own key; carry it over once. */
const legacyLog = () => {
  try {
    return localStorage.getItem('option-builder-chart-log') === '1';
  } catch {
    return false;
  }
};

export const DEFAULT_SETTINGS: ChartSettings = {
  chartStyle: 'candles',
  body: true,
  upBody: TV_UP,
  downBody: TV_DOWN,
  borders: true,
  upBorder: TV_UP,
  downBorder: TV_DOWN,
  wick: true,
  upWick: TV_UP,
  downWick: TV_DOWN,
  lastPriceLine: true,
  highLowMarks: true,
  legendTitle: true,
  legendOhlc: true,
  legendChange: true,
  legendVolume: false,
  indicatorLegend: true,
  indicatorArgs: true,
  scaleMode: 'normal',
  scalePosition: 'right',
  lastPriceLabel: true,
  countdown: true,
  background: null,
  vertGrid: true,
  vertGridColor: null,
  horzGrid: true,
  horzGridColor: null,
  crosshairColor: null,
  crosshairDashed: true,
  watermark: true,
  watermarkColor: null,
  scaleTextColor: null,
  scaleTextSize: 12,
  scaleLineColor: null,
  buttons: 'hover',
  marginTop: 10,
  marginBottom: 8,
  alertLines: true,
  alertColor: null,
  alertAxisLabel: true,
  alertSound: true,
  alertPopup: true,
};

/** What the `null` colours mean in each theme (matches tvStyle.ts and index.css). */
export function themeColors(theme: 'light' | 'dark') {
  const dark = theme === 'dark';
  const cssVar = (name: string, fallback: string) =>
    (typeof document !== 'undefined' && getComputedStyle(document.documentElement).getPropertyValue(name).trim()) || fallback;
  return {
    background: dark ? '#0d0d0d' : '#ffffff',
    grid: dark ? 'rgba(242, 242, 242, 0.06)' : 'rgba(42, 46, 57, 0.06)',
    crosshair: '#9598A1',
    watermark: dark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)',
    scaleText: dark ? '#B2B5BE' : '#131722',
    scaleLine: dark ? 'rgba(242, 242, 242, 0.06)' : 'rgba(42, 46, 57, 0.06)',
    alert: cssVar('--text-secondary', dark ? '#cfcfcf' : '#52514e'),
  };
}

export interface ChartTemplate {
  name: string;
  settings: ChartSettings;
}

interface ChartSettingsState {
  /** Saved settings: what every chart shows. */
  settings: ChartSettings;
  /** The dialog's unsaved edits, shown live on the charts until Ok or Cancel. */
  preview: ChartSettings | null;
  templates: ChartTemplate[];
  /** Live-preview a change (opens a preview if none). */
  edit: (patch: Partial<ChartSettings>) => void;
  /** Preview a whole set (a template, the defaults). */
  previewAll: (s: ChartSettings) => void;
  /** Ok: keep the preview. */
  commit: () => void;
  /** Cancel: drop the preview. */
  revert: () => void;
  /** Change saved settings straight away (the price axis' L button). */
  set: (patch: Partial<ChartSettings>) => void;
  saveTemplate: (name: string, s: ChartSettings) => void;
  removeTemplate: (name: string) => void;
}

const MAX_TEMPLATES = 20;

export const useChartSettings = create<ChartSettingsState>()(
  persist(
    (set) => ({
      settings: { ...DEFAULT_SETTINGS, scaleMode: legacyLog() ? 'log' : 'normal' },
      preview: null,
      templates: [],
      edit: (patch) => set((s) => ({ preview: { ...(s.preview ?? s.settings), ...patch } })),
      previewAll: (next) => set({ preview: { ...next } }),
      commit: () => set((s) => (s.preview ? { settings: s.preview, preview: null } : {})),
      revert: () => set({ preview: null }),
      set: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch }, preview: s.preview ? { ...s.preview, ...patch } : null })),
      saveTemplate: (name, settings) =>
        set((s) => {
          const n = name.trim().slice(0, 40);
          if (!n) return {};
          const rest = s.templates.filter((t) => t.name.toLowerCase() !== n.toLowerCase());
          return { templates: [...rest, { name: n, settings: { ...settings } }].slice(-MAX_TEMPLATES) };
        }),
      removeTemplate: (name) => set((s) => ({ templates: s.templates.filter((t) => t.name !== name) })),
    }),
    {
      name: 'option-builder-chart-settings',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      // v2: the A / L buttons moved to "on price scale hover" by default; carry that over the old default.
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<ChartSettingsState>;
        if (version < 2 && p.settings?.buttons === 'always') p.settings = { ...p.settings, buttons: 'hover' };
        return p as ChartSettingsState;
      },
      partialize: (s) => ({ settings: s.settings, templates: s.templates }),
      // Settings added in later versions take their defaults.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ChartSettingsState>;
        return {
          ...current,
          settings: { ...current.settings, ...(p.settings ?? {}) },
          templates: (p.templates ?? []).map((t) => ({ ...t, settings: { ...DEFAULT_SETTINGS, ...t.settings } })),
        };
      },
    },
  ),
);

/** The settings the charts show now: the dialog's preview while it's open. */
export const effectiveSettings = (s: Pick<ChartSettingsState, 'settings' | 'preview'>) => s.preview ?? s.settings;

