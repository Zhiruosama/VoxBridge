import { describe, expect, it } from 'vitest';
import { sidebarDefault, sidebarLimit, sidebarWidth } from './sidebar-layout';

describe('sidebar layout bounds', () => {
  it('rejects corrupt preferences and clamps stored widths', () => {
    for (const value of [null, undefined, '300', NaN, Infinity, {}])
      expect(sidebarWidth(value)).toBe(sidebarDefault);
    expect(sidebarWidth(-200)).toBe(180);
    expect(sidebarWidth(500)).toBe(360);
  });
  it('preserves content room in the minimum desktop window without discarding wide preferences', () => {
    expect(sidebarLimit(1180)).toBe(360);
    expect(sidebarLimit(680)).toBe(258);
    expect(sidebarWidth(360, sidebarLimit(680))).toBe(258);
    expect(sidebarWidth(360, sidebarLimit(1180))).toBe(360);
    expect(sidebarLimit(360)).toBe(180);
  });
});
