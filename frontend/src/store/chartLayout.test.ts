import { beforeEach, describe, expect, it } from 'vitest';
import { cellRects, chartCount, gridStyle, LAYOUTS, layoutById } from '../features/chart/layouts';
import { useChartLayout } from './chartLayout';

const state = () => useChartLayout.getState();

describe('chart layouts', () => {
  it('count their charts and place each in a box', () => {
    expect(LAYOUTS.map((l) => chartCount(l))).toEqual([1, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4]);
    expect(cellRects(layoutById('3l'))).toEqual([
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ]);
    expect(gridStyle(layoutById('3b'))).toEqual({
      gridTemplateAreas: '"a a" "b c"',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
    });
    expect(layoutById('nope').id).toBe('1');
  });
});

describe('chart layout store', () => {
  beforeEach(() => useChartLayout.setState({ layoutId: '4g', symbols: ['NIFTY', 'BANKNIFTY', 'RELIANCE', 'HDFCBANK'], active: 0 }));

  it('changes the active chart symbol, or a given one', () => {
    state().setActive(2);
    state().setSymbol('TCS');
    expect(state().symbols).toEqual(['NIFTY', 'BANKNIFTY', 'TCS', 'HDFCBANK']);
    state().setSymbol('INFY', 0);
    expect(state().symbols[0]).toBe('INFY');
  });

  it('keeps the active chart inside a smaller layout, and the hidden charts symbols', () => {
    state().setActive(3);
    state().setLayout('2v');
    expect(state().active).toBe(1);
    expect(state().symbols[3]).toBe('HDFCBANK');
    state().setActive(5);
    expect(state().active).toBe(1);
  });
});
