import { describe, expect, it } from 'vitest';
import { candleCloseMs, CRYPTO_SESSION, ROUND_CLOCK_SESSION, TSE_SESSION, XETRA_SESSION, fmtLeft, marketOpen, nseCloseMs, nseOpen, sessionFor, US_SESSION } from './nse';

const utc = (iso: string) => Date.parse(iso);

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

describe('US session', () => {
  // 2026-10-16 is a Friday; New York is on EDT (UTC−4) until 1 Nov 2026.

  it('is open 09:30–16:00 New York time, i.e. 19:00–01:30 IST in summer', () => {
    expect(marketOpen(US_SESSION, new Date(utc('2026-10-16T13:29:00Z')))).toBe(false);
    expect(marketOpen(US_SESSION, new Date(utc('2026-10-16T13:30:00Z')))).toBe(true);
    expect(marketOpen(US_SESSION, new Date(utc('2026-10-16T19:59:00Z')))).toBe(true);
    expect(marketOpen(US_SESSION, new Date(utc('2026-10-16T20:00:00Z')))).toBe(false);
  });

  it('follows daylight saving: 09:30 New York is 14:30 UTC in winter', () => {
    expect(marketOpen(US_SESSION, new Date(utc('2026-11-16T14:29:00Z')))).toBe(false);
    expect(marketOpen(US_SESSION, new Date(utc('2026-11-16T14:30:00Z')))).toBe(true);
  });

  it('times candles from the US open and close', () => {
    const now = utc('2026-10-16T14:02:00Z'); // 10:02 New York
    expect(candleCloseMs('minute', 15, now, US_SESSION)).toBe(utc('2026-10-16T14:15:00Z'));
    expect(candleCloseMs('hour', 1, now, US_SESSION)).toBe(utc('2026-10-16T14:30:00Z'));
    expect(candleCloseMs('day', 1, now, US_SESSION)).toBe(utc('2026-10-16T20:00:00Z'));
    // Friday after the close → Monday's first 5-minute bar.
    expect(candleCloseMs('minute', 5, utc('2026-10-16T21:00:00Z'), US_SESSION)).toBe(utc('2026-10-19T13:35:00Z'));
  });

  it('picks the session from the symbol', () => {
    expect(sessionFor('US:AAPL')).toBe(US_SESSION);
    expect(sessionFor('NIFTY').name).toBe('NSE');
    expect(sessionFor('US:XAGUSD')).toBe(ROUND_CLOCK_SESSION);
    // Gold charts PAXG on Binance, which trades every day.
    expect(sessionFor('US:XAUUSD')).toBe(CRYPTO_SESSION);
    expect(sessionFor('US:EURUSD')).toBe(ROUND_CLOCK_SESSION);
    expect(sessionFor('US:BTCUSD')).toBe(CRYPTO_SESSION);
    expect(sessionFor('US:SPX')).toBe(US_SESSION);
    expect(sessionFor('US:GER40')).toBe(XETRA_SESSION);
    expect(sessionFor('US:JP225')).toBe(TSE_SESSION);
  });
});

describe('global market sessions', () => {
  it('keeps crypto open every day, weekends included', () => {
    // 2026-10-17 is a Saturday.
    expect(marketOpen(CRYPTO_SESSION, new Date(utc('2026-10-17T03:00:00Z')))).toBe(true);
    expect(candleCloseMs('minute', 15, utc('2026-10-17T03:07:00Z'), CRYPTO_SESSION)).toBe(utc('2026-10-17T03:15:00Z'));
    expect(candleCloseMs('day', 1, utc('2026-10-17T03:07:00Z'), CRYPTO_SESSION)).toBe(utc('2026-10-18T00:00:00Z'));
    expect(candleCloseMs('week', 1, utc('2026-10-17T03:07:00Z'), CRYPTO_SESSION)).toBe(utc('2026-10-19T00:00:00Z'));
    expect(candleCloseMs('month', 1, utc('2026-10-17T03:07:00Z'), CRYPTO_SESSION)).toBe(utc('2026-11-01T00:00:00Z'));
  });

  it('keeps forex, metals and energy open round the clock on weekdays only', () => {
    expect(marketOpen(ROUND_CLOCK_SESSION, new Date(utc('2026-10-16T03:00:00Z')))).toBe(true);
    expect(marketOpen(ROUND_CLOCK_SESSION, new Date(utc('2026-10-17T15:00:00Z')))).toBe(false);
  });

  it('follows Frankfurt and Tokyo hours for the DAX and Nikkei', () => {
    // 2026-10-16 is a Friday; Berlin is UTC+2 (summer time), Tokyo UTC+9.
    expect(marketOpen(XETRA_SESSION, new Date(utc('2026-10-16T06:59:00Z')))).toBe(false);
    expect(marketOpen(XETRA_SESSION, new Date(utc('2026-10-16T07:00:00Z')))).toBe(true);
    expect(marketOpen(XETRA_SESSION, new Date(utc('2026-10-16T15:30:00Z')))).toBe(false);
    expect(marketOpen(TSE_SESSION, new Date(utc('2026-10-16T00:00:00Z')))).toBe(true);
    expect(marketOpen(TSE_SESSION, new Date(utc('2026-10-16T06:30:00Z')))).toBe(false);
  });
});
