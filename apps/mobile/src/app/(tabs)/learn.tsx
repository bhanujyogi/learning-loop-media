import { levelFromXp } from '@learning-loop/learning-engine/gamification';
import { useQuery } from '@tanstack/react-query';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { localName } from '../../i18n/core';
import { useI18n } from '../../i18n/I18nProvider';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { Animated, enter } from '../../ui/motion';
import { Card, ErrorState, LoadingState, ProgressBar, Text } from '../../ui/primitives';

/** Personal learning dashboard: complements the feed (RLS guarantees these are the viewer's own rows). */
export default function Learn() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const { session } = useAuth();
  const uid = session?.user.id;
  const q = useQuery({
    queryKey: ['dashboard', uid],
    enabled: !!uid,
    queryFn: async () => {
      const [prog, due, mastery] = await Promise.all([
        supabase
          .from('user_progress')
          .select('xp, level, streak_current, streak_longest')
          .eq('user_id', uid!)
          .maybeSingle(),
        supabase
          .from('review_items')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', uid!)
          .lte('due_at', new Date().toISOString()),
        supabase
          .from('concept_mastery')
          .select('concept_id, alpha, beta, concepts(name, name_i18n)')
          .eq('user_id', uid!)
          .order('updated_at', { ascending: false })
          .limit(50),
      ]);
      if (prog.error || due.error || mastery.error) throw new Error('load');
      return { prog: prog.data, due: due.count ?? 0, mastery: mastery.data ?? [] };
    },
  });
  if (q.isLoading || !uid) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => void q.refetch()} />;
  const xp = q.data.prog?.xp ?? 0;
  const lvl = levelFromXp(xp);
  const weak = q.data.mastery
    .map((m) => {
      const c = m.concepts as unknown as {
        name: string;
        name_i18n: Record<string, unknown> | null;
      } | null;
      return {
        name: c ? localName(c, locale) : t('learn.concept'),
        mastery: m.alpha / (m.alpha + m.beta),
      };
    })
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 5);
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <Text variant="display" accessibilityRole="header">
          {t('learn.title')}
        </Text>
        <Animated.View entering={enter()}>
          <Card style={{ gap: space.sm }}>
            <Text variant="heading">{t('learn.level', { level: lvl.level })}</Text>
            <ProgressBar
              value={lvl.needed ? lvl.into / lvl.needed : 0}
              label={t('learn.toLevel', { level: lvl.level + 1 })}
              height={12}
            />
            <Text muted>
              {t('learn.xpStreak', {
                xp,
                streak: q.data.prog?.streak_current ?? 0,
                best: q.data.prog?.streak_longest ?? 0,
              })}
            </Text>
          </Card>
        </Animated.View>
        <Animated.View entering={enter(80)}>
          <Card style={{ gap: space.xs }}>
            <Text variant="heading">{t('learn.reviews')}</Text>
            <Text>
              {q.data.due > 0
                ? t('learn.reviewsDue', { count: q.data.due })
                : t('learn.reviewsNone')}
            </Text>
          </Card>
        </Animated.View>
        <Animated.View entering={enter(160)}>
          <Card style={{ gap: space.sm }}>
            <Text variant="heading">{t('learn.focus')}</Text>
            {weak.length === 0 ? (
              <Text muted>{t('learn.focusEmpty')}</Text>
            ) : (
              weak.map((w) => (
                <View key={w.name} style={{ gap: space.xs }}>
                  <Text variant="label">{w.name}</Text>
                  <ProgressBar value={w.mastery} label={t('learn.masteryOf', { name: w.name })} />
                </View>
              ))
            )}
            <Text variant="caption" muted>
              {t('learn.focusNote')}
            </Text>
          </Card>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}
