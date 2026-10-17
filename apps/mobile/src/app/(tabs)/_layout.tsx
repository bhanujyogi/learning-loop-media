import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useI18n } from '../../i18n/I18nProvider';
import { useTheme } from '../../theme/useTheme';

const icon = (glyph: string) =>
  function TabIcon({ focused }: { focused: boolean }) {
    return <Text style={{ fontSize: 24, opacity: focused ? 1 : 0.55 }}>{glyph}</Text>;
  };

/** Instagram-style bottom bar: Home, Explore, Create, Chats, Profile. Progress lives inside Profile (hidden tab). */
export default function TabsLayout() {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarIcon: icon('🏠') }} />
      <Tabs.Screen name="explore" options={{ title: t('tabs.explore'), tabBarIcon: icon('🔍') }} />
      <Tabs.Screen name="create" options={{ title: t('tabs.create'), tabBarIcon: icon('➕') }} />
      <Tabs.Screen name="chats" options={{ title: t('tabs.chats'), tabBarIcon: icon('💬') }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarIcon: icon('👤') }} />
      <Tabs.Screen name="learn" options={{ href: null }} />
    </Tabs>
  );
}
