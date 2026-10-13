import { levelFromXp } from '@learning-loop/learning-engine/gamification';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../i18n/I18nProvider';
import { track } from '../../lib/event-queue';
import { supabase } from '../../lib/supabase';
import { useNotice } from '../../lib/use-notice';
import { useGoBack } from '../../ui/ScreenHeader';
import { useReactions } from '../../lib/use-reactions';
import { radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import {
  Card,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Text,
  ToggleButton,
} from '../../ui/primitives';
import { ScreenHeader } from '../../ui/ScreenHeader';
import { ReportSheet } from '../../ui/ReportSheet';
import { Toast } from '../../ui/Toast';

/** Another learner's/creator's public profile: handle, bio, level, and a follow toggle (RLS decides what is visible). */
export default function UserProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { colors } = useTheme();
  const { notice, show } = useNotice();
  const qc = useQueryClient();
  const goBack = useGoBack();
  const [reporting, setReporting] = useState(false);
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
  const block = () =>
    Alert.alert(t('block.action'), t('block.confirm', { handle: q.data?.username ?? '' }), [
      { text: t('common.close'), style: 'cancel' },
      {
        text: t('block.action'),
        style: 'destructive',
        onPress: async () => {
          if (!reactions.uid) return;
          const { error } = await supabase
            .from('user_blocks')
            .insert({ blocker_id: reactions.uid, blocked_id: id });
          if (error && error.code !== '23505') return show(t('block.error'));
          // what this learner may see has changed: drop cached feed/saved data and leave the profile
          void qc.invalidateQueries({ queryKey: ['saved'] });
          void qc.invalidateQueries({ queryKey: ['handle'] });
          show(t('block.done'));
          goBack();
        },
      },
    ]);
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
          <View style={{ gap: space.md }}>
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
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              <Button variant="secondary" label={t('block.action')} onPress={block} />
              <Button
                variant="ghost"
                label={t('report.action')}
                onPress={() => setReporting(true)}
              />
            </View>
          </View>
        )}
      </View>
    );
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader />
      <View style={{ flex: 1 }}>
        {body}
        {q.data && !self ? (
          <ReportSheet
            visible={reporting}
            kind="user"
            targetId={id}
            onClose={() => setReporting(false)}
            onResult={show}
          />
        ) : null}
        <Toast message={notice} />
      </View>
    </SafeAreaView>
  );
}
