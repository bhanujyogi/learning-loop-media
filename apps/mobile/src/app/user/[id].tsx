import { levelFromXp } from '@learning-loop/learning-engine/gamification';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PostGrid, StatCell, usePostCount, usePosts } from '../../features/profile/ProfileParts';
import { useI18n } from '../../i18n/I18nProvider';
import { useAuth } from '../../lib/auth';
import { track } from '../../lib/event-queue';
import { relationActions, type ProfileAction } from '../../lib/profile-model';
import {
  follow,
  getRelationship,
  respondFriendRequest,
  sendFriendRequest,
  unfollow,
} from '../../lib/social';
import { supabase } from '../../lib/supabase';
import { useNotice } from '../../lib/use-notice';
import { space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { Avatar } from '../../ui/Avatar';
import { Button, EmptyState, ErrorState, LoadingState, Text } from '../../ui/primitives';
import { ReportSheet } from '../../ui/ReportSheet';
import { ScreenHeader, useGoBack } from '../../ui/ScreenHeader';
import { Toast } from '../../ui/Toast';

/** Another person's profile: header, relationship actions, posts grid (RLS decides what is visible). */
export default function UserProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const me = session?.user.id;
  const { notice, show } = useNotice();
  const qc = useQueryClient();
  const goBack = useGoBack();
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState<ProfileAction | null>(null);
  const self = !!me && me === id;

  useEffect(() => {
    if (self) router.replace('/profile');
  }, [self, router]);

  const q = useQuery({
    queryKey: ['public-profile', id],
    enabled: !!id && !self,
    queryFn: async () => {
      const [p, g] = await Promise.all([
        supabase
          .from('profiles')
          .select('username, display_name, bio, avatar_path')
          .eq('id', id)
          .maybeSingle(),
        supabase.from('user_progress').select('xp').eq('user_id', id).maybeSingle(),
      ]);
      if (p.error) throw new Error('load');
      return p.data ? { ...p.data, xp: g.data?.xp ?? 0 } : null;
    },
  });
  const rel = useQuery({
    queryKey: ['relation', me, id],
    enabled: !!id && !!me && !self,
    queryFn: () => getRelationship(me!, id),
  });
  const postCount = usePostCount(id, false);
  const posts = usePosts(id, false);

  useEffect(() => {
    if (id && q.data) track('creator_profile_opened', { creator_id: id });
  }, [id, q.data]);

  const refreshRelation = () => {
    void qc.invalidateQueries({ queryKey: ['relation', me, id] });
    void qc.invalidateQueries({ queryKey: ['profile-stats', me] });
    void qc.invalidateQueries({ queryKey: ['people'] });
  };
  const run = async (action: ProfileAction, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(action);
    try {
      await fn();
      refreshRelation();
    } catch {
      show(t('social.actionError'));
    } finally {
      setBusy(null);
    }
  };
  const act = (a: ProfileAction) => {
    if (!me) return;
    const requestId = rel.data?.requestId;
    switch (a) {
      case 'addFriend':
        return run(a, async () => {
          const r = await sendFriendRequest(id);
          show(t(r === 'friends' ? 'profile.nowFriends' : 'profile.requestSent'));
        });
      case 'follow':
        return run(a, async () => {
          await follow(me, id);
          track('follow', { creator_id: id });
        });
      case 'following':
        return run(a, async () => {
          await unfollow(me, id);
          track('unfollow', { creator_id: id });
        });
      case 'accept':
      case 'decline':
        if (!requestId) return;
        return run(a, () => respondFriendRequest(requestId, a === 'accept'));
      case 'message':
        return run(a, async () => {
          const { data, error } = await supabase.rpc('start_direct_conversation', { p_other: id });
          if (error || !data) throw error ?? new Error('conversation');
          router.push(`/chat/${data as string}`);
        });
      default:
        return;
    }
  };

  const block = () =>
    Alert.alert(t('block.action'), t('block.confirm', { handle: q.data?.username ?? '' }), [
      { text: t('common.close'), style: 'cancel' },
      {
        text: t('block.action'),
        style: 'destructive',
        onPress: async () => {
          if (!me) return;
          const { error } = await supabase
            .from('user_blocks')
            .insert({ blocker_id: me, blocked_id: id });
          if (error && error.code !== '23505') return show(t('block.error'));
          // what this learner may see has changed: drop cached feed/saved data and leave the profile
          void qc.invalidateQueries({ queryKey: ['saved'] });
          void qc.invalidateQueries({ queryKey: ['handle'] });
          show(t('block.done'));
          goBack();
        },
      },
    ]);

  const label = (a: ProfileAction) =>
    ({
      addFriend: t('profile.addFriend'),
      follow: t('social.follow'),
      requested: t('profile.requested'),
      accept: t('profile.accept'),
      decline: t('profile.decline'),
      following: t('social.following'),
      friends: `${t('profile.friendsDone')} ✓`,
      message: t('profile.message'),
    })[a];

  let body: React.ReactNode;
  if (self || q.isLoading) body = <LoadingState />;
  else if (q.isError) body = <ErrorState onRetry={() => void q.refetch()} />;
  else if (!q.data)
    body = <EmptyState glyph="🔍" title={t('profile.public.notFound')} message="" />;
  else {
    const d = q.data;
    const lvl = levelFromXp(d.xp);
    const shownName = d.display_name && d.display_name !== d.username ? d.display_name : null;
    const actions = rel.data ? relationActions(rel.data.status) : [];
    body = (
      <ScrollView>
        <View style={{ padding: space.lg, gap: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
            <Avatar path={d.avatar_path} name={shownName ?? d.username} size={86} />
            <View style={{ flex: 1, flexDirection: 'row' }}>
              <StatCell value={postCount.data ?? 0} label={t('profile.stat.posts')} />
              <StatCell value={lvl.level} label={t('profile.stat.level')} />
              <StatCell value={d.xp} label={t('profile.stat.xp')} />
            </View>
          </View>
          <View style={{ gap: 2 }}>
            <Text variant="heading" accessibilityRole="header">
              {shownName ?? `@${d.username}`}
            </Text>
            {shownName ? <Text muted>@{d.username}</Text> : null}
            {d.bio ? <Text>{d.bio}</Text> : null}
          </View>
          {rel.isLoading ? null : rel.isError ? (
            <Button
              variant="secondary"
              label={t('common.retry')}
              onPress={() => void rel.refetch()}
            />
          ) : (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {actions.map((a) => {
                const primary = a === 'addFriend' || a === 'accept' || a === 'message';
                return (
                  <View key={a} style={{ flex: 1 }}>
                    <Button
                      variant={primary ? 'primary' : 'secondary'}
                      label={label(a)}
                      disabled={a === 'requested' || a === 'friends'}
                      loading={busy === a}
                      onPress={() => void act(a)}
                    />
                  </View>
                );
              })}
              <Button
                variant="secondary"
                label="⋯"
                accessibilityLabel={t('profile.more')}
                style={{ paddingHorizontal: space.lg }}
                onPress={() =>
                  Alert.alert(`@${d.username}`, undefined, [
                    { text: t('report.action'), onPress: () => setReporting(true) },
                    { text: t('block.action'), style: 'destructive', onPress: block },
                    { text: t('common.close'), style: 'cancel' },
                  ])
                }
              />
            </View>
          )}
        </View>
        <View style={{ borderTopWidth: 1, borderColor: colors.border }}>
          {posts.isLoading ? (
            <LoadingState />
          ) : posts.isError ? (
            <ErrorState onRetry={() => void posts.refetch()} />
          ) : !posts.data?.length ? (
            <View style={{ height: 240 }}>
              <EmptyState glyph="📷" title={t('profile.public.noPosts')} message="" />
            </View>
          ) : (
            <PostGrid posts={posts.data} />
          )}
        </View>
      </ScrollView>
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
