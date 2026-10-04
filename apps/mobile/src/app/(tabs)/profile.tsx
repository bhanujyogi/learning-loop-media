import { AIService } from '@learning-loop/ai';
import { isEnabled } from '@learning-loop/config';
import { levelFromXp } from '@learning-loop/learning-engine/gamification';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../i18n/I18nProvider';
import { useAccount } from '../../lib/account';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { LanguageSwitch } from '../../ui/LanguageSwitch';
import { PressableScale } from '../../ui/motion';
import { Button, Card, ErrorState, LoadingState, Text } from '../../ui/primitives';

// No native inference runtime is bundled yet, so this reports the truth instead of faking an assistant.
const ai = new AIService({
  provider: null,
  enabled: isEnabled('local_ai'),
  device: async () => ({
    totalMemoryMB: 0,
    freeStorageMB: 0,
    cpuCores: 0,
    isLowPowerMode: false,
    platform: 'other',
  }),
  installedModelIds: async () => [],
});

export default function Profile() {
  const { colors } = useTheme();
  const { t, locale, setLocale } = useI18n();
  const { session } = useAuth();
  const router = useRouter();
  const account = useAccount();
  const uid = session?.user.id;
  const [langError, setLangError] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const stats = useQuery({
    queryKey: ['profile-stats', uid],
    enabled: !!uid,
    queryFn: async () => {
      const [g, s] = await Promise.all([
        supabase.from('user_progress').select('xp').eq('user_id', uid!).maybeSingle(),
        supabase
          .from('saves')
          .select('content_id', { count: 'exact', head: true })
          .eq('user_id', uid!),
      ]);
      return { xp: g.data?.xp ?? 0, saved: s.count ?? 0 };
    },
  });
  const aiStatus = useQuery({ queryKey: ['ai-availability'], queryFn: () => ai.availability() });
  if (account.isLoading || !uid) return <LoadingState />;
  if (account.isError || !account.data)
    return <ErrorState message={t('profile.loadError')} onRetry={() => void account.refetch()} />;
  const name = account.data.username ?? '';
  const lvl = levelFromXp(stats.data?.xp ?? 0);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await supabase.auth.signOut(); // clears the local session even if the network call fails
    } finally {
      setSigningOut(false);
    }
  };
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
          <View
            accessibilityElementsHidden
            style={{
              width: 72,
              height: 72,
              borderRadius: radius.pill,
              backgroundColor: colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text variant="display" style={{ color: colors.onPrimary }}>
              {name.slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="heading" accessibilityRole="header">
              @{name}
            </Text>
            <Text muted>{t('profile.stats', { level: lvl.level, xp: stats.data?.xp ?? 0 })}</Text>
          </View>
        </View>

        <Card style={{ gap: space.sm }}>
          <Text variant="heading">{t('profile.language')}</Text>
          <LanguageSwitch
            value={locale}
            onChange={(l) => {
              setLangError(false);
              void setLocale(l).then((ok) => setLangError(!ok));
            }}
          />
          <Text variant="caption" muted>
            {t('profile.languageNote')}
          </Text>
          {langError ? (
            <Text accessibilityRole="alert" style={{ color: colors.danger }}>
              {t('profile.langError')}
            </Text>
          ) : null}
        </Card>

        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('profile.saved')}
          onPress={() => router.push('/saved')}
        >
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Text style={{ fontSize: 28 }}>🔖</Text>
            <View style={{ flex: 1 }}>
              <Text variant="heading">{t('profile.saved')}</Text>
              <Text muted>{t('profile.savedCount', { count: stats.data?.saved ?? 0 })}</Text>
            </View>
            <Text variant="heading" muted>
              ›
            </Text>
          </Card>
        </PressableScale>

        <Card style={{ gap: space.xs }}>
          <Text variant="heading">{t('profile.ai.title')}</Text>
          <Text muted>
            {aiStatus.data && !aiStatus.data.available
              ? aiStatus.data.detail
              : t('profile.ai.ready')}
          </Text>
          <Text variant="caption" muted>
            {t('profile.ai.note')}
          </Text>
        </Card>

        <Button
          variant="secondary"
          label={signingOut ? t('profile.signingOut') : t('profile.signOut')}
          loading={signingOut}
          onPress={() => void signOut()}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
