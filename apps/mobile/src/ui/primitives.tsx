import { forwardRef } from 'react';
import {
  ActivityIndicator,
  Text as RNText,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useI18n } from '../i18n/I18nProvider';
import { HIT, radius, space, type } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { PressableScale } from './motion';

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
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      disabled={disabled || loading}
      hitSlop={8}
      style={
        [
          {
            minHeight: HIT,
            paddingHorizontal: space.xl,
            borderRadius: radius.pill,
            backgroundColor: bg,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: disabled ? 0.5 : 1,
            flexDirection: 'row',
            gap: space.sm,
          },
          typeof style === 'function' ? undefined : style,
        ] as StyleProp<ViewStyle>
      }
      {...p}
    >
      {loading ? <ActivityIndicator color={fg} /> : null}
      <RNText style={[type.label, { color: fg }]}>{label}</RNText>
    </PressableScale>
  );
}

/** Compact toggle for actions like Like/Save/Follow. The state is a glyph + label, never colour alone. */
export function ToggleButton({
  on,
  glyphOn,
  glyphOff,
  labelOn,
  labelOff,
  onPress,
  disabled,
}: {
  on: boolean;
  glyphOn: string;
  glyphOff: string;
  labelOn: string;
  labelOff: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const label = on ? labelOn : labelOff;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={{
        minHeight: HIT,
        minWidth: HIT,
        paddingHorizontal: space.lg,
        borderRadius: radius.pill,
        backgroundColor: on ? colors.primary : colors.surfaceAlt,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.xs,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <RNText style={[type.heading, { color: on ? colors.onPrimary : colors.text }]}>
        {on ? glyphOn : glyphOff}
      </RNText>
      <RNText style={[type.label, { color: on ? colors.onPrimary : colors.text }]}>{label}</RNText>
    </PressableScale>
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
    <PressableScale
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
    </PressableScale>
  );
}

export type ChoiceState = 'idle' | 'selected' | 'correct' | 'wrong' | 'missed';
/**
 * Large answer/option card. After grading, `correct` / `wrong` / `missed` are shown with a symbol AND text colour AND border,
 * so colour-blind users and screen readers get the same information (`accessibilityLabel` includes the state).
 */
export function ChoiceCard({
  label,
  description,
  state = 'idle',
  leading,
  stateLabel,
  disabled,
  onPress,
  role = 'radio',
}: {
  label: string;
  description?: string;
  state?: ChoiceState;
  leading?: string;
  /** Localized spoken/visible state text, e.g. "Correct". */
  stateLabel?: string;
  disabled?: boolean;
  onPress?: () => void;
  role?: 'radio' | 'checkbox' | 'button';
}) {
  const { colors } = useTheme();
  const palette = {
    idle: { border: colors.border, bg: colors.surface, mark: '' },
    selected: { border: colors.primary, bg: colors.surfaceAlt, mark: '●' },
    correct: { border: colors.success, bg: colors.successBg, mark: '✓' },
    wrong: { border: colors.danger, bg: colors.dangerBg, mark: '✗' },
    missed: { border: colors.success, bg: colors.surface, mark: '✓' },
  }[state];
  return (
    <PressableScale
      accessibilityRole={role}
      accessibilityState={{
        checked: state === 'selected',
        selected: state === 'selected',
        disabled: !!disabled,
      }}
      accessibilityLabel={[label, description, stateLabel].filter(Boolean).join('. ')}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
        borderRadius: radius.lg,
        borderWidth: state === 'idle' ? 1 : 2,
        borderColor: palette.border,
        backgroundColor: palette.bg,
      }}
    >
      {leading ? (
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: radius.pill,
            backgroundColor: colors.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <RNText style={[type.label, { color: colors.text }]}>{leading}</RNText>
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <RNText style={[type.body, { color: colors.text, fontWeight: '600' }]}>{label}</RNText>
        {description ? (
          <RNText style={[type.caption, { color: colors.textMuted }]}>{description}</RNText>
        ) : null}
      </View>
      {palette.mark ? (
        <RNText style={[type.heading, { color: palette.border }]}>{palette.mark}</RNText>
      ) : null}
    </PressableScale>
  );
}

/** Labelled text field with an inline, announced error. */
export const Field = forwardRef<
  TextInput,
  TextInputProps & { label: string; error?: string | null; trailing?: React.ReactNode }
>(function Field({ label, error, trailing, style, ...p }, ref) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="label" muted>
        {label}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 52,
          borderWidth: error ? 2 : 1,
          borderColor: error ? colors.danger : colors.border,
          borderRadius: radius.md,
          backgroundColor: colors.surface,
          paddingHorizontal: space.md,
        }}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={colors.textMuted}
          {...p}
          style={[{ flex: 1, minHeight: 48, fontSize: 16, color: colors.text }, style]}
        />
        {trailing}
      </View>
      {error ? (
        <Text accessibilityRole="alert" variant="caption" style={{ color: colors.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
});

export function Pill({
  label,
  fg,
  bg,
  accessibilityLabel,
}: {
  label: string;
  fg: string;
  bg: string;
  accessibilityLabel?: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? label}
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: space.md,
        paddingVertical: 6,
        borderRadius: radius.pill,
        backgroundColor: bg,
      }}
    >
      <RNText style={[type.caption, { color: fg, fontWeight: '700', letterSpacing: 0.4 }]}>
        {label}
      </RNText>
    </View>
  );
}

export function ProgressBar({
  value,
  label,
  color,
  height = 8,
}: {
  value: number;
  label: string;
  color?: string;
  height?: number;
}) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={{
        height,
        borderRadius: radius.pill,
        backgroundColor: colors.surfaceAlt,
        overflow: 'hidden',
      }}
    >
      <View
        style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: color ?? colors.primary }}
      />
    </View>
  );
}

/** Standard async states so no screen shows a blank page or a raw exception. */
export function LoadingState({ label }: { label?: string }) {
  const { t } = useI18n();
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
      <Text muted>{label ?? t('common.loading')}</Text>
    </View>
  );
}
export function EmptyState({
  title,
  message,
  glyph,
  action,
}: {
  title: string;
  message: string;
  glyph?: string;
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
      {glyph ? (
        <RNText accessibilityElementsHidden style={{ fontSize: 56 }}>
          {glyph}
        </RNText>
      ) : null}
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
  const { t } = useI18n();
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
      <RNText accessibilityElementsHidden style={{ fontSize: 48 }}>
        {offline ? '📡' : '⚠️'}
      </RNText>
      <Text variant="heading" style={{ textAlign: 'center' }}>
        {offline ? t('common.offline') : t('common.somethingWrong')}
      </Text>
      <Text muted style={{ textAlign: 'center' }}>
        {message ?? (offline ? t('common.offlineBody') : t('common.tryMoment'))}
      </Text>
      <Button label={t('common.retry')} onPress={onRetry} />
    </View>
  );
}
