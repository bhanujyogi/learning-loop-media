import { View } from 'react-native';
import { useI18n } from '../../i18n/I18nProvider';
import { useSessionStats } from '../../lib/session-stats';
import { radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { Text } from '../../ui/primitives';

/**
 * Honest session progress: one dot per graded answer this session (✓ / ✗) and a one-line summary. It reflects only
 * server-graded results — not time spent, swipes or opens — so it can't reward passive scrolling.
 */
export function SessionStrip() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const s = useSessionStats();
  const summary =
    s.answered === 0
      ? t('feed.session.empty')
      : t('feed.session.summary', { correct: s.correct, answered: s.answered, xp: s.xp });
  return (
    <View
      accessible
      accessibilityLabel={`${t('feed.session.title')}: ${summary}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingHorizontal: space.xl,
        paddingVertical: space.sm,
        minHeight: 40,
      }}
    >
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {s.results.map((ok, i) => (
          <View
            key={i}
            style={{
              width: 18,
              height: 18,
              borderRadius: radius.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: ok ? colors.successBg : colors.dangerBg,
              borderWidth: 1,
              borderColor: ok ? colors.success : colors.danger,
            }}
          >
            <Text
              style={{ fontSize: 10, lineHeight: 12, color: ok ? colors.success : colors.danger }}
            >
              {ok ? '✓' : '✗'}
            </Text>
          </View>
        ))}
      </View>
      <Text variant="caption" muted style={{ flexShrink: 1 }}>
        {summary}
      </Text>
    </View>
  );
}
