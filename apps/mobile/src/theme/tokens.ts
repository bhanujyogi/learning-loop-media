/** Learning Loop design tokens — one visual language for every screen. */
export const palette = {
  light: {
    bg: '#F7F7FB',
    surface: '#FFFFFF',
    surfaceAlt: '#EFEFF8',
    text: '#14142B',
    textMuted: '#5A5A78',
    border: '#DCDCEB',
    primary: '#4F46E5',
    onPrimary: '#FFFFFF',
    accent: '#F59E0B',
    success: '#15803D',
    successBg: '#DCFCE7',
    danger: '#B91C1C',
    dangerBg: '#FEE2E2',
    focus: '#1D4ED8',
  },
  dark: {
    bg: '#0E0E1A',
    surface: '#181829',
    surfaceAlt: '#222238',
    text: '#F4F4FF',
    textMuted: '#A5A5C4',
    border: '#33334F',
    primary: '#8B85FF',
    onPrimary: '#0E0E1A',
    accent: '#FBBF24',
    success: '#4ADE80',
    successBg: '#12301D',
    danger: '#F87171',
    dangerBg: '#3B1717',
    focus: '#93C5FD',
  },
} as const;
export type Colors = { [K in keyof (typeof palette)['light']]: string };
/**
 * Content-kind accents: each kind of learning content has its own colour so the feed is scannable at a glance. The kind is
 * ALWAYS also conveyed by a text label (never colour alone). Pairs are checked for >= 4.5:1 contrast in tokens.test.ts.
 */
export type Kind = 'question' | 'note' | 'video' | 'flashcard' | 'interactive' | 'other';
export const kindPalette = {
  light: {
    question: { fg: '#4338CA', bg: '#ECEEFF' },
    note: { fg: '#0F766E', bg: '#D8F5F0' },
    video: { fg: '#BE185D', bg: '#FCE7F1' },
    flashcard: { fg: '#9A4A06', bg: '#FDEFD3' },
    interactive: { fg: '#166534', bg: '#DAF6E3' },
    other: { fg: '#4F46E5', bg: '#EFEFF8' },
  },
  dark: {
    question: { fg: '#B7BFFF', bg: '#1F1F4A' },
    note: { fg: '#6EE7D3', bg: '#0F2E2B' },
    video: { fg: '#F9A8D4', bg: '#3A1226' },
    flashcard: { fg: '#FCD34D', bg: '#35260A' },
    interactive: { fg: '#86EFAC', bg: '#12301D' },
    other: { fg: '#8B85FF', bg: '#222238' },
  },
} as const;
export const kindOf = (type: string, format?: string | null): Kind =>
  type === 'question' || format === 'challenge'
    ? 'question'
    : type === 'note' || type === 'video' || type === 'flashcard' || type === 'interactive'
      ? type
      : 'other';

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 14, lg: 22, xl: 30, pill: 999 } as const;
/**
 * Line heights are >= 1.4x the font size on purpose: Devanagari (Hindi) has marks above and below the line and is visibly
 * clipped on Android at the ~1.25x typical of Latin-only scales (guarded by tokens.test.ts).
 */
export const type = {
  title: { fontSize: 28, fontWeight: '800' as const, lineHeight: 40 },
  heading: { fontSize: 20, fontWeight: '700' as const, lineHeight: 29 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  label: { fontSize: 14, fontWeight: '600' as const, lineHeight: 20 },
  caption: { fontSize: 12, fontWeight: '500' as const, lineHeight: 18 },
  /** Big on-card question/prompt text: readable at arm's length, one idea per screen. */
  display: { fontSize: 26, fontWeight: '800' as const, lineHeight: 38 },
  prompt: { fontSize: 21, fontWeight: '700' as const, lineHeight: 31 },
} as const;
/** Minimum touch target (accessibility). */
export const HIT = 48;
