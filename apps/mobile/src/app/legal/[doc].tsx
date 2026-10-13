import { useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../i18n/I18nProvider';
import { isLegalDoc, renderLegal } from '../../lib/legal';
import { space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { EmptyState, Text } from '../../ui/primitives';
import { ScreenHeader } from '../../ui/ScreenHeader';

/** In-app Privacy policy / Terms / Community guidelines (the same text is published as web pages for the store listing). */
export default function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const { t } = useI18n();
  const { colors } = useTheme();
  const valid = isLegalDoc(doc);
  const d = valid ? renderLegal(doc) : null;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader />
      {d ? (
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md }}>
          <Text variant="display" accessibilityRole="header">
            {d.title}
          </Text>
          <Text variant="caption" muted>
            {d.updated} · {t('legal.englishOnly')}
          </Text>
          {d.sections.map((s) => (
            <View key={s.h} style={{ gap: space.sm }}>
              <Text variant="heading" accessibilityRole="header" style={{ marginTop: space.md }}>
                {s.h}
              </Text>
              {s.p.map((para, i) => (
                <Text key={i} style={{ fontSize: 16, lineHeight: 25 }}>
                  {para}
                </Text>
              ))}
            </View>
          ))}
        </ScrollView>
      ) : (
        <EmptyState glyph="📄" title={t('content.notFound')} message="" />
      )}
    </SafeAreaView>
  );
}
