import { levelFromXp } from '@learning-loop/learning-engine/gamification';
import { useQuery } from '@tanstack/react-query';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { Card, ErrorState, LoadingState, ProgressBar, Text } from '../../ui/primitives';

/** Personal learning dashboard: complements the feed (RLS guarantees these are the viewer's own rows). */
export default function Learn() {
  const { colors } = useTheme();
  const { session } = useAuth();
  const uid = session!.user.id;
  const q = useQuery({
    queryKey: ['dashboard', uid],
    queryFn: async () => {
      const [prog, due, mastery] = await Promise.all([
        supabase
          .from('user_progress')
          .select('xp, level, streak_current, streak_longest')
          .eq('user_id', uid)
          .maybeSingle(),
        supabase
          .from('review_items')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', uid)
          .lte('due_at', new Date().toISOString()),
        supabase
          .from('concept_mastery')
          .select('concept_id, alpha, beta, concepts(name)')
          .eq('user_id', uid)
          .order('updated_at', { ascending: false })
          .limit(50),
      ]);
      if (prog.error || due.error || mastery.error) throw new Error('load');
      return { prog: prog.data, due: due.count ?? 0, mastery: mastery.data ?? [] };
    },
  });
  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const xp = q.data.prog?.xp ?? 0;
  const lvl = levelFromXp(xp);
  const weak = q.data.mastery
    .map((m) => ({
      name: (m.concepts as unknown as { name: string } | null)?.name ?? 'Concept',
      mastery: m.alpha / (m.alpha + m.beta),
    }))
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 5);
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <Text variant="title" accessibilityRole="header">
          Your learning
        </Text>
        <Card style={{ gap: space.sm }}>
          <Text variant="heading">Level {lvl.level}</Text>
          <ProgressBar
            value={lvl.needed ? lvl.into / lvl.needed : 0}
            label={`Progress to level ${lvl.level + 1}`}
          />
          <Text muted>
            {xp} XP · 🔥 {q.data.prog?.streak_current ?? 0}-day streak (best{' '}
            {q.data.prog?.streak_longest ?? 0})
          </Text>
        </Card>
        <Card style={{ gap: space.xs }}>
          <Text variant="heading">Reviews due</Text>
          <Text>
            {q.data.due > 0
              ? `${q.data.due} item${q.data.due === 1 ? '' : 's'} ready — they’ll appear in your feed.`
              : 'Nothing due right now.'}
          </Text>
        </Card>
        <Card style={{ gap: space.sm }}>
          <Text variant="heading">Focus areas</Text>
          {weak.length === 0 ? (
            <Text muted>Answer a few questions and your focus areas will show up here.</Text>
          ) : (
            weak.map((w) => (
              <View key={w.name} style={{ gap: space.xs }}>
                <Text variant="label">{w.name}</Text>
                <ProgressBar value={w.mastery} label={`${w.name} mastery estimate`} />
              </View>
            ))
          )}
          <Text variant="caption" muted>
            Mastery values are estimates that improve with more practice.
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
