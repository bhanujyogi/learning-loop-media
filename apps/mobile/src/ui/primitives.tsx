import {
  ActivityIndicator,
  Pressable,
  Text as RNText,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { HIT, radius, space, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

export function Text({
  variant = 'body',
  muted,
  style,
  ...p
}: TextProps & { variant?: keyof typeof type; muted?: boolean }) {
  const { colors } = useTheme();
  return (
    <RNText
      {...p}
      style={[
        type[variant],
        { color: muted ? colors.textMuted : colors.text },
        style as StyleProp<TextStyle>,
      ]}
    />
  );
}

export function Card({ style, ...p }: React.ComponentProps<typeof View>) {
  const { colors } = useTheme();
  return (
    <View
      {...p}
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          padding: space.lg,
          borderWidth: 1,
          borderColor: colors.border,
        },
        style as StyleProp<ViewStyle>,
      ]}
    />
  );
}

type ButtonProps = Omit<PressableProps, 'children'> & {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
};
export function Button({
  label,
  variant = 'primary',
  loading,
  disabled,
  style,
  ...p
}: ButtonProps) {
  const { colors } = useTheme();
  const bg =
    variant === 'primary'
      ? colors.primary
      : variant === 'secondary'
        ? colors.surfaceAlt
        : 'transparent';
  const fg = variant === 'primary' ? colors.onPrimary : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      disabled={disabled || loading}
      hitSlop={8}
      style={(s) =>
        [
          {
            minHeight: HIT,
            paddingHorizontal: space.xl,
            borderRadius: radius.pill,
            backgroundColor: bg,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: disabled ? 0.5 : s.pressed ? 0.85 : 1,
            flexDirection: 'row',
            gap: space.sm,
          },
          typeof style === 'function' ? style(s) : style,
        ] as StyleProp<ViewStyle>
      }
      {...p}
    >
      {loading ? <ActivityIndicator color={fg} /> : null}
      <RNText style={[type.label, { color: fg }]}>{label}</RNText>
    </Pressable>
  );
}

/** Selectable chip: state is conveyed by a check mark + border, not by colour alone. */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        minHeight: HIT,
        paddingHorizontal: space.lg,
        borderRadius: radius.pill,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.surfaceAlt : colors.surface,
        justifyContent: 'center',
      }}
    >
      <RNText style={[type.label, { color: colors.text }]}>
        {selected ? '✓ ' : ''}
        {label}
      </RNText>
    </Pressable>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={{
        height: 8,
        borderRadius: radius.pill,
        backgroundColor: colors.surfaceAlt,
        overflow: 'hidden',
      }}
    >
      <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: colors.primary }} />
    </View>
  );
}

/** Standard async states so no screen shows a blank page or a raw exception. */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.md,
        padding: space.xl,
      }}
    >
      <ActivityIndicator />
      <Text muted>{label}</Text>
    </View>
  );
}
export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.md,
        padding: space.xl,
      }}
    >
      <Text variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      <Text muted style={{ textAlign: 'center' }}>
        {message}
      </Text>
      {action ? <Button label={action.label} variant="secondary" onPress={action.onPress} /> : null}
    </View>
  );
}
export function ErrorState({
  message,
  offline,
  onRetry,
}: {
  message?: string;
  offline?: boolean;
  onRetry: () => void;
}) {
  return (
    <View
      accessibilityRole="alert"
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.md,
        padding: space.xl,
      }}
    >
      <Text variant="heading" style={{ textAlign: 'center' }}>
        {offline ? "You're offline" : 'Something went wrong'}
      </Text>
      <Text muted style={{ textAlign: 'center' }}>
        {message ??
          (offline ? 'Check your connection and try again.' : 'Please try again in a moment.')}
      </Text>
      <Button label="Try again" onPress={onRetry} />
    </View>
  );
}
