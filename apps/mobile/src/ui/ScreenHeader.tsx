import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useI18n } from '../i18n/I18nProvider';
import { space } from '../theme/tokens';
import { Button, Text } from './primitives';

/** Back that never dead-ends: history if there is any, otherwise Home (e.g. the screen was opened from a link). */
export function useGoBack() {
  const router = useRouter();
  return () => (router.canGoBack() ? router.back() : router.replace('/'));
}

/**
 * Header for pushed screens (content, saved, public profile): one consistent back control + optional title.
 * Back falls back to Home when there is no history (e.g. the screen was opened from a link), so it never dead-ends.
 */
export function ScreenHeader({ title }: { title?: string }) {
  const goBack = useGoBack();
  const { t } = useI18n();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
      <Button variant="ghost" label={`‹ ${t('common.back')}`} onPress={goBack} />
      {title ? (
        <Text variant="heading" accessibilityRole="header">
          {title}
        </Text>
      ) : null}
    </View>
  );
}
