import { SUPPORTED_LOCALES, type Locale } from '@learning-loop/shared';
import { View } from 'react-native';
import { useI18n } from '../i18n/I18nProvider';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { PressableScale } from './motion';
import { Text } from './primitives';

/** Endonyms: each language is always shown in itself, so a learner can find theirs whatever the UI language is. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', hi: 'हिन्दी' };

export function LanguageSwitch({
  value,
  onChange,
}: {
  value?: Locale;
  onChange?: (l: Locale) => void;
}) {
  const { colors } = useTheme();
  const { locale, setLocale, t } = useI18n();
  const current = value ?? locale;
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('common.language')}
      style={{
        flexDirection: 'row',
        padding: 4,
        borderRadius: radius.pill,
        backgroundColor: colors.surfaceAlt,
        gap: 4,
      }}
    >
      {SUPPORTED_LOCALES.map((l) => {
        const on = l === current;
        return (
          <PressableScale
            key={l}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={LOCALE_NAMES[l]}
            onPress={() => (onChange ? onChange(l) : void setLocale(l))}
            style={{
              flex: 1,
              minHeight: 44,
              paddingHorizontal: space.lg,
              borderRadius: radius.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: on ? colors.primary : 'transparent',
            }}
          >
            <Text
              variant="label"
              style={{ color: on ? colors.onPrimary : colors.text, fontSize: 16 }}
            >
              {LOCALE_NAMES[l]}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
