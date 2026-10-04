import { useColorScheme } from 'react-native';
import { kindPalette, palette, type Colors, type Kind } from './tokens';

export function useTheme(): {
  colors: Colors;
  dark: boolean;
  kind: (k: Kind) => { fg: string; bg: string };
} {
  const dark = useColorScheme() === 'dark';
  const kinds = dark ? kindPalette.dark : kindPalette.light;
  return { colors: dark ? palette.dark : palette.light, dark, kind: (k) => kinds[k] };
}
