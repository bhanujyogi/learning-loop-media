import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useI18n } from '../../i18n/I18nProvider';
import { useTheme } from '../../theme/useTheme';

const icon = (glyph: string) =>
  function TabIcon({ focused }: { focused: boolean }) {
    return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.6 }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarIcon: icon('🏠') }} />
      <Tabs.Screen name="learn" options={{ title: t('tabs.learn'), tabBarIcon: icon('📈') }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarIcon: icon('👤') }} />
    </Tabs>
  );
}
