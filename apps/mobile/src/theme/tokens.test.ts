import { describe, expect, it } from 'vitest';
import { HIT, kindOf, kindPalette, palette, type } from './tokens';

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('accessibility contrast (WCAG AA 4.5:1 for text)', () => {
  for (const mode of ['light', 'dark'] as const) {
    it(`kind accents on their tint (${mode})`, () => {
      for (const [k, v] of Object.entries(kindPalette[mode]))
        expect(contrast(v.fg, v.bg), `${mode}:${k}`).toBeGreaterThanOrEqual(4.5);
    });
    it(`body, muted and semantic text on the surfaces (${mode})`, () => {
      const p = palette[mode];
      expect(contrast(p.text, p.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.text, p.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.textMuted, p.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.onPrimary, p.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.success, p.successBg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.danger, p.dangerBg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('kindOf', () => {
  it('maps content types/formats to a kind', () => {
    expect(kindOf('question')).toBe('question');
    expect(kindOf('note', 'challenge')).toBe('question');
    expect(kindOf('video')).toBe('video');
    expect(kindOf('lesson')).toBe('other');
  });
});

describe('typography and touch targets', () => {
  it('every text style has Devanagari-safe line height (>= 1.4x) so Hindi is not clipped', () => {
    for (const [name, v] of Object.entries(type))
      expect(v.lineHeight / v.fontSize, name).toBeGreaterThanOrEqual(1.4);
  });
  it('the minimum touch target is at least 48dp', () => {
    expect(HIT).toBeGreaterThanOrEqual(48);
  });
});
