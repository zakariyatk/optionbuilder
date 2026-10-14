import { describe, expect, it } from 'vitest';
import { nseCloseMs, nseOpen } from './nse';

// 2026-10-14 is a Wednesday. IST = UTC + 5:30.
const ist = (hh: number, mm: number, day = 14) => new Date(Date.UTC(2026, 9, day, hh, mm) - 330 * 60_000);

describe('nseOpen', () => {
  it('follows the 09:15–15:30 IST weekday session', () => {
    expect(nseOpen(ist(9, 14))).toBe(false);
    expect(nseOpen(ist(9, 15))).toBe(true);
    expect(nseOpen(ist(15, 29))).toBe(true);
    expect(nseOpen(ist(15, 30))).toBe(false);
  });
  it('is closed at weekends', () => {
    expect(nseOpen(ist(11, 0, 17))).toBe(false); // Saturday
  });
});

describe('nseCloseMs', () => {
  it('is 15:30 IST on the same day', () => {
    expect(nseCloseMs(ist(13, 58))).toBe(ist(15, 30).getTime());
  });
});
