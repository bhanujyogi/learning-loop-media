import { useColorScheme } from 'react-native';
import { palette, type Colors } from './tokens';

export function useTheme(): { colors: Colors; dark: boolean } {
  const dark = useColorScheme() === 'dark';
  return { colors: dark ? palette.dark : palette.light, dark };
}
