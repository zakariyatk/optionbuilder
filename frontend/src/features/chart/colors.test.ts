import { describe, expect, it } from 'vitest';
import { formatColor, parseColor, withAlpha } from './colors';

describe('colours', () => {
  it('parses hex and rgba', () => {
    expect(parseColor('#089981')).toEqual({ r: 8, g: 153, b: 129, a: 1 });
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('rgba(242, 242, 242, 0.06)')).toEqual({ r: 242, g: 242, b: 242, a: 0.06 });
    expect(parseColor('nonsense')).toBeNull();
  });
  it('formats opaque as hex and translucent as rgba', () => {
    expect(formatColor({ r: 8, g: 153, b: 129, a: 1 })).toBe('#089981');
    expect(withAlpha('#089981', 0.25)).toBe('rgba(8, 153, 129, 0.25)');
  });
});
