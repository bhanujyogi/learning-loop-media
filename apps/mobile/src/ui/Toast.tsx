import { View } from 'react-native';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Animated, enter } from './motion';
import { Text } from './primitives';

export function Toast({ message }: { message: string | null }) {
  const { colors } = useTheme();
  if (!message) return null;
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: space.lg, right: space.lg, bottom: space.lg }}
    >
      <Animated.View
        entering={enter()}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={{
          padding: space.md,
          borderRadius: radius.lg,
          backgroundColor: colors.text,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: colors.bg, fontWeight: '600', textAlign: 'center' }}>{message}</Text>
      </Animated.View>
    </View>
  );
}
