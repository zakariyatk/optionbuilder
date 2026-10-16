import { describe, expect, it } from 'vitest';
import { replayLabel } from './replay';

describe('replay label', () => {
  it('reads like TradingView, in IST', () => {
    // 15 Oct 2026 10:45 IST = 05:15 UTC
    expect(replayLabel(Date.UTC(2026, 9, 15, 5, 15))).toBe("Thu 15 Oct '26 10:45 AM");
  });
});
