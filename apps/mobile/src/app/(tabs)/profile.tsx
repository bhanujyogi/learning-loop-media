import { AIService } from '@learning-loop/ai';
import { isEnabled } from '@learning-loop/config';
import { levelFromXp } from '@learning-loop/learning-engine/gamification';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PostGrid, StatCell, usePostCount, usePosts } from '../../features/profile/ProfileParts';
import { useI18n } from '../../i18n/I18nProvider';
import { useAccount } from '../../lib/account';
import { answerCache } from '../../lib/answer-cache';
import { useAuth } from '../../lib/auth';
import { followStats } from '../../lib/profile-model';
import { deleteOutcome } from '../../lib/safety';
import { sessionStats } from '../../lib/session-stats';
import { supabase } from '../../lib/supabase';
import { space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { Avatar } from '../../ui/Avatar';
import { LanguageSwitch } from '../../ui/LanguageSwitch';
import { PressableScale } from '../../ui/motion';
import { Button, Card, EmptyState, ErrorState, LoadingState, Text } from '../../ui/primitives';

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

type Section = 'posts' | 'saved' | 'progress';

export default function Profile() {
  const { colors } = useTheme();
  const { t, locale, setLocale } = useI18n();
  const { session } = useAuth();
  const router = useRouter();
  const account = useAccount();
  const uid = session?.user.id;
  const [section, setSection] = useState<Section>('posts');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [langError, setLangError] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const me = useQuery({
    queryKey: ['my-profile', uid],
    enabled: !!uid,
    queryFn: async () => {
      const r = await supabase
        .from('profiles')
        .select('username, display_name, bio, avatar_path, is_creator')
        .eq('id', uid!)
        .single();
      if (r.error) throw new Error('load');
      return r.data;
    },
  });
  const stats = useQuery({
    queryKey: ['profile-stats', uid],
    enabled: !!uid,
    queryFn: async () => {
      const [g, s, f] = await Promise.all([
        supabase.from('user_progress').select('xp').eq('user_id', uid!).maybeSingle(),
        supabase
          .from('saves')
          .select('content_id', { count: 'exact', head: true })
          .eq('user_id', uid!),
        supabase
          .from('follows')
          .select('follower_id, followee_id')
          .or(`follower_id.eq.${uid},followee_id.eq.${uid}`)
          .limit(5000),
      ]);
      return {
        xp: g.data?.xp ?? 0,
        saved: s.count ?? 0,
        ...followStats(uid!, f.data ?? []),
      };
    },
  });
  const postCount = usePostCount(uid, true);
  const posts = usePosts(uid, true);
  const aiStatus = useQuery({ queryKey: ['ai-availability'], queryFn: () => ai.availability() });

  if (account.isLoading || me.isLoading || !uid) return <LoadingState />;
  if (account.isError || !account.data || me.isError || !me.data)
    return (
      <ErrorState
        message={t('profile.loadError')}
        onRetry={() => {
          void account.refetch();
          void me.refetch();
        }}
      />
    );
  const p = me.data;
  const handle = p.username ?? '';
  const shownName = p.display_name && p.display_name !== p.username ? p.display_name : null;
  const lvl = levelFromXp(stats.data?.xp ?? 0);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await supabase.auth.signOut(); // clears the local session even if the network call fails
    } finally {
      setSigningOut(false);
    }
  };
  const confirmDelete = () =>
    Alert.alert(t('account.delete'), t('account.deleteWarn'), [
      { text: t('common.close'), style: 'cancel' },
      {
        text: t('account.deleteConfirm'),
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          setDeleteError(null);
          const { error } = await supabase.rpc('delete_my_account');
          const o = deleteOutcome(error);
          if (o === 'deleted') {
            answerCache.clear();
            sessionStats.reset();
            await supabase.auth.signOut({ scope: 'local' }); // the user no longer exists server-side; clear the device session
          } else {
            setDeleteError(o === 'staff' ? t('account.deleteStaff') : t('account.deleteError'));
          }
          setDeleting(false);
        },
      },
    ]);

  const sections: { key: Section; label: string; glyph: string }[] = [
    { key: 'posts', label: t('profile.tab.posts'), glyph: '▦' },
    { key: 'saved', label: t('profile.tab.saved'), glyph: '🔖' },
    { key: 'progress', label: t('profile.tab.progress'), glyph: '📈' },
  ];

  let sectionBody: React.ReactNode;
  if (section === 'posts') {
    if (posts.isLoading) sectionBody = <LoadingState />;
    else if (posts.isError) sectionBody = <ErrorState onRetry={() => void posts.refetch()} />;
    else if (!posts.data?.length)
      sectionBody = (
        <View style={{ height: 280 }}>
          <EmptyState
            glyph="📷"
            title={t('profile.posts.emptyTitle')}
            message={t('profile.posts.emptyBody')}
            action={{ label: t('profile.posts.create'), onPress: () => router.push('/create') }}
          />
        </View>
      );
    else sectionBody = <PostGrid posts={posts.data} />;
  } else if (section === 'saved') {
    sectionBody = (
      <View style={{ padding: space.lg, gap: space.md }}>
        <Text muted>{t('profile.savedCount', { count: stats.data?.saved ?? 0 })}</Text>
        <Button label={t('profile.saved')} onPress={() => router.push('/saved')} />
      </View>
    );
  } else {
    sectionBody = (
      <View style={{ padding: space.lg, gap: space.md }}>
        <Text variant="heading">
          {t('profile.stats', { level: lvl.level, xp: stats.data?.xp ?? 0 })}
        </Text>
        <Button label={t('profile.progress.open')} onPress={() => router.push('/learn')} />
      </View>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView>
        <View style={{ padding: space.lg, gap: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t('profile.changePhoto')}
              onPress={() => router.push('/profile/edit')}
              hitSlop={8}
            >
              <Avatar path={p.avatar_path} name={shownName ?? handle} size={86} />
            </PressableScale>
            <View style={{ flex: 1, flexDirection: 'row' }}>
              <StatCell value={postCount.data ?? 0} label={t('profile.stat.posts')} />
              <StatCell
                value={stats.data?.friends ?? 0}
                label={t('profile.stat.friends')}
                onPress={() => router.push('/friends')}
              />
              <StatCell value={stats.data?.followers ?? 0} label={t('profile.stat.followers')} />
              <StatCell value={stats.data?.following ?? 0} label={t('profile.stat.following')} />
            </View>
          </View>
          <View style={{ gap: 2 }}>
            <Text variant="heading" accessibilityRole="header">
              {shownName ?? `@${handle}`}
            </Text>
            {shownName ? <Text muted>@{handle}</Text> : null}
            {p.bio ? <Text>{p.bio}</Text> : null}
            {p.is_creator ? (
              <Text variant="caption" muted>
                {t('profile.creatorStatus')}
              </Text>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                variant="secondary"
                label={t('profile.edit')}
                onPress={() => router.push('/profile/edit')}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                variant="secondary"
                label={t('profile.friends')}
                onPress={() => router.push('/friends')}
              />
            </View>
          </View>
        </View>

        <View
          accessibilityRole="tablist"
          style={{
            flexDirection: 'row',
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: colors.border,
          }}
        >
          {sections.map((s) => {
            const on = section === s.key;
            return (
              <PressableScale
                key={s.key}
                accessibilityRole="tab"
                accessibilityLabel={s.label}
                accessibilityState={{ selected: on }}
                onPress={() => setSection(s.key)}
                style={{
                  flex: 1,
                  minHeight: 48,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderBottomWidth: on ? 2 : 0,
                  borderBottomColor: colors.text,
                  opacity: on ? 1 : 0.6,
                }}
              >
                <Text style={{ fontSize: 20 }}>{s.glyph}</Text>
              </PressableScale>
            );
          })}
        </View>
        {sectionBody}

        <View style={{ padding: space.lg, gap: space.lg }}>
          <PressableScale
            accessibilityRole="button"
            accessibilityState={{ expanded: settingsOpen }}
            accessibilityLabel={t('profile.settings')}
            onPress={() => setSettingsOpen((v) => !v)}
            style={{
              minHeight: 48,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }}
          >
            <Text variant="heading">{t('profile.settings')}</Text>
            <Text variant="heading" muted>
              {settingsOpen ? '⌃' : '⌄'}
            </Text>
          </PressableScale>
          {settingsOpen ? (
            <View style={{ gap: space.lg }}>
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

              <Card style={{ gap: space.xs }}>
                <Text variant="heading">{t('legal.section')}</Text>
                {(['privacy', 'terms', 'guidelines'] as const).map((d) => (
                  <Button
                    key={d}
                    variant="ghost"
                    label={t(`legal.${d}`)}
                    onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: d } })}
                  />
                ))}
              </Card>

              <Button
                variant="secondary"
                label={signingOut ? t('profile.signingOut') : t('profile.signOut')}
                loading={signingOut}
                onPress={() => void signOut()}
              />
              <Button
                variant="ghost"
                label={deleting ? t('account.deleting') : t('account.delete')}
                loading={deleting}
                onPress={confirmDelete}
              />
              {deleteError ? (
                <Text accessibilityRole="alert" style={{ color: colors.danger }}>
                  {deleteError}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
