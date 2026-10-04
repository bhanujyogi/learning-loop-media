import { levelFromXp } from '@learning-loop/learning-engine/gamification';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../i18n/I18nProvider';
import { track } from '../../lib/event-queue';
import { supabase } from '../../lib/supabase';
import { useNotice } from '../../lib/use-notice';
import { useReactions } from '../../lib/use-reactions';
import { radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Text,
  ToggleButton,
} from '../../ui/primitives';
import { Toast } from '../../ui/Toast';

/** Another learner's/creator's public profile: handle, bio, level, and a follow toggle (RLS decides what is visible). */
export default function UserProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const { notice, show } = useNotice();
  const reactions = useReactions([], id ? [id] : [], () => show(t('social.actionError')));
  const q = useQuery({
    queryKey: ['public-profile', id],
    enabled: !!id,
    queryFn: async () => {
      const [p, g] = await Promise.all([
        supabase.from('profiles').select('username, display_name, bio').eq('id', id).maybeSingle(),
        supabase.from('user_progress').select('xp').eq('user_id', id).maybeSingle(),
      ]);
      if (p.error) throw new Error('load');
      return p.data ? { ...p.data, xp: g.data?.xp ?? 0 } : null;
    },
  });
  useEffect(() => {
    if (id && q.data) track('creator_profile_opened', { creator_id: id });
  }, [id, q.data]);

  const self = reactions.uid === id;
  let body: React.ReactNode;
  if (q.isLoading) body = <LoadingState />;
  else if (q.isError) body = <ErrorState onRetry={() => void q.refetch()} />;
  else if (!q.data)
    body = <EmptyState glyph="🔍" title={t('profile.public.notFound')} message="" />;
  else {
    const lvl = levelFromXp(q.data.xp);
    body = (
      <View style={{ padding: space.xl, gap: space.lg }}>
        <View
          accessibilityElementsHidden
          style={{
            width: 80,
            height: 80,
            borderRadius: radius.pill,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="display" style={{ color: colors.onPrimary }}>
            {(q.data.username ?? '?').slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View style={{ gap: space.xs }}>
          <Text variant="display" accessibilityRole="header">
            @{q.data.username}
          </Text>
          {q.data.display_name && q.data.display_name !== q.data.username ? (
            <Text muted>{q.data.display_name}</Text>
          ) : null}
        </View>
        {q.data.bio ? <Text>{q.data.bio}</Text> : null}
        <Card>
          <Text variant="label">{t('profile.stats', { level: lvl.level, xp: q.data.xp })}</Text>
        </Card>
        {self ? (
          <Text muted>{t('social.cantFollowSelf')}</Text>
        ) : (
          <View style={{ flexDirection: 'row' }}>
            <ToggleButton
              on={reactions.followed.has(id)}
              glyphOn="✓"
              glyphOff="＋"
              labelOn={t('social.following')}
              labelOff={t('social.follow')}
              onPress={() => reactions.toggleFollow(id)}
            />
          </View>
        )}
      </View>
    );
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: space.sm, alignSelf: 'flex-start' }}>
        <Button variant="ghost" label={`‹ ${t('common.back')}`} onPress={() => router.back()} />
      </View>
      <View style={{ flex: 1 }}>
        {body}
        <Toast message={notice} />
      </View>
    </SafeAreaView>
  );
}
