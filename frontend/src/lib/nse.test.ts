import { describe, expect, it } from 'vitest';
import { candleCloseMs, fmtLeft, nseCloseMs, nseOpen } from './nse';

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

describe('candleCloseMs', () => {
  const at = (hh: number, mm: number, day = 14) => ist(hh, mm, day).getTime();
  // 2026-10-14 Wed; 16 Fri; 17 Sat; 19 Mon; 30 Fri (last weekday of October).

  it('counts minute and hour bars from the 09:15 open, cut at 15:30', () => {
    expect(candleCloseMs('minute', 1, at(13, 58) + 20_000)).toBe(at(13, 59));
    expect(candleCloseMs('minute', 15, at(13, 58))).toBe(at(14, 0));
    expect(candleCloseMs('minute', 3, at(9, 15))).toBe(at(9, 18));
    expect(candleCloseMs('hour', 1, at(13, 58))).toBe(at(14, 15));
    expect(candleCloseMs('hour', 4, at(13, 58))).toBe(at(15, 30));
  });

  it('points at the next session outside market hours', () => {
    expect(candleCloseMs('minute', 5, at(8, 0))).toBe(at(9, 20));
    expect(candleCloseMs('minute', 15, at(16, 0))).toBe(at(9, 30, 15));
    expect(candleCloseMs('hour', 1, at(16, 0, 16))).toBe(at(10, 15, 19)); // Friday evening → Monday
    expect(candleCloseMs('minute', 1, at(11, 0, 17))).toBe(at(9, 16, 19)); // Saturday → Monday
  });

  it('closes D at 15:30, W on Friday, M on the last weekday', () => {
    expect(candleCloseMs('day', 1, at(13, 58))).toBe(at(15, 30));
    expect(candleCloseMs('day', 1, at(16, 0, 16))).toBe(at(15, 30, 19));
    expect(candleCloseMs('week', 1, at(13, 58))).toBe(at(15, 30, 16));
    expect(candleCloseMs('week', 1, at(16, 0, 16))).toBe(at(15, 30, 23));
    expect(candleCloseMs('month', 1, at(13, 58))).toBe(at(15, 30, 30));
  });
});

describe('fmtLeft', () => {
  it('shortens by size', () => {
    expect(fmtLeft(104_000)).toBe('01:44');
    expect(fmtLeft(4 * 86_400_000 + 16 * 3600_000 + 59_000)).toBe('4d 16h');
    expect(fmtLeft(2 * 3600_000 + 15 * 60_000 + 30_000)).toBe('2:15:30');
    expect(fmtLeft(3 * 86_400_000 + 5 * 3600_000)).toBe('3d 5h');
  });
});
