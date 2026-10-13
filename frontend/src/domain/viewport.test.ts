import { describe, expect, it } from 'vitest';
import { clampRange, niceStep, panRange, rangeBetween, zoomRange } from './viewport';

const bounds = { min: 0, max: 1000 };

describe('clampRange', () => {
  it('leaves a range inside the bounds alone', () => {
    expect(clampRange({ min: 100, max: 200 }, bounds)).toEqual({ min: 100, max: 200 });
  });
  it('slides a range back inside without changing its span', () => {
    expect(clampRange({ min: -50, max: 50 }, bounds)).toEqual({ min: 0, max: 100 });
    expect(clampRange({ min: 950, max: 1100 }, bounds)).toEqual({ min: 850, max: 1000 });
  });
  it('fits a range wider than the bounds', () => {
    expect(clampRange({ min: -10, max: 2000 }, bounds)).toEqual(bounds);
  });
});

describe('zoomRange', () => {
  it('zooms in around the anchor, keeping it fixed on screen', () => {
    const r = zoomRange({ min: 0, max: 400 }, 0.5, 100, bounds, 10);
    expect(r).toEqual({ min: 50, max: 250 });
    // The anchor was 25% across before and after.
    expect((100 - r.min) / (r.max - r.min)).toBeCloseTo(0.25);
  });
  it('respects the minimum span', () => {
    const r = zoomRange({ min: 100, max: 120 }, 0.01, 110, bounds, 10);
    expect(r.max - r.min).toBeCloseTo(10);
  });
  it('never zooms out past the bounds', () => {
    expect(zoomRange({ min: 100, max: 900 }, 5, 500, bounds, 10)).toEqual(bounds);
  });
  it('ignores non-finite input', () => {
    const r = { min: 1, max: 2 };
    expect(zoomRange(r, NaN, 1, bounds, 0.1)).toBe(r);
  });
});

describe('panRange', () => {
  it('shifts and stops at the edges', () => {
    expect(panRange({ min: 100, max: 200 }, 50, bounds)).toEqual({ min: 150, max: 250 });
    expect(panRange({ min: 100, max: 200 }, -500, bounds)).toEqual({ min: 0, max: 100 });
  });
});

describe('rangeBetween', () => {
  it('orders the ends and rejects tiny selections', () => {
    expect(rangeBetween(300, 100, 5)).toEqual({ min: 100, max: 300 });
    expect(rangeBetween(100, 102, 5)).toBeNull();
  });
});

describe('niceStep', () => {
  it('rounds down to 1 / 2 / 5 × 10ⁿ', () => {
    expect(niceStep(22.7)).toBe(20);
    expect(niceStep(0.7)).toBe(0.5);
    expect(niceStep(130)).toBe(100);
    expect(niceStep(0)).toBe(1);
  });
});
