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
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 14, lg: 22, pill: 999 } as const;
export const type = {
  title: { fontSize: 28, fontWeight: '800' as const, lineHeight: 34 },
  heading: { fontSize: 20, fontWeight: '700' as const, lineHeight: 26 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 23 },
  label: { fontSize: 14, fontWeight: '600' as const, lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: '500' as const, lineHeight: 16 },
} as const;
/** Minimum touch target (accessibility). */
export const HIT = 48;
