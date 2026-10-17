import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PostGrid, withMedia, type GridPost } from '../../features/profile/ProfileParts';
import { useI18n } from '../../i18n/I18nProvider';
import { useAuth } from '../../lib/auth';
import { cleanSearch, ilikePattern } from '../../lib/profile-model';
import { getRelationship, sendFriendRequest, type Relationship } from '../../lib/social';
import { supabase } from '../../lib/supabase';
import { radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { Avatar } from '../../ui/Avatar';
import { PressableScale } from '../../ui/motion';
import { Button, Chip, EmptyState, ErrorState, LoadingState, Text } from '../../ui/primitives';

interface Person {
  id: string;
  username: string;
  display_name: string | null;
  avatar_path: string | null;
}
interface PostRow {
  id: string;
  title: string;
  type: string;
  topic_label: string | null;
}
const PERSON_COLS = 'id, username, display_name, avatar_path';

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const h = setTimeout(() => setD(v), ms);
    return () => clearTimeout(h);
  }, [v, ms]);
  return d;
}

function PersonRow({ p, me }: { p: Person; me: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const rel = useQuery({
    queryKey: ['relation', me, p.id],
    queryFn: () => getRelationship(me, p.id),
  });
  const status: Relationship | undefined = rel.data?.status;
  const add = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await sendFriendRequest(p.id);
      await qc.invalidateQueries({ queryKey: ['relation', me, p.id] });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const canAdd = status === 'none' || status === 'followed_by' || status === 'following';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        minHeight: 64,
      }}
    >
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`@${p.username}`}
        onPress={() => router.push({ pathname: '/user/[id]', params: { id: p.id } })}
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          minHeight: 56,
        }}
      >
        <Avatar path={p.avatar_path} name={p.display_name ?? p.username} size={48} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '700' }} numberOfLines={1}>
            @{p.username}
          </Text>
          {p.display_name ? (
            <Text muted numberOfLines={1}>
              {p.display_name}
            </Text>
          ) : null}
        </View>
      </PressableScale>
      {status === 'friends' ? (
        <Text variant="label" muted>
          {t('profile.friendsDone')} ✓
        </Text>
      ) : status === 'request_sent' ? (
        <Text variant="label" muted>
          {t('profile.requested')}
        </Text>
      ) : status === 'request_received' ? (
        <Button
          variant="secondary"
          label={t('profile.respond')}
          onPress={() => router.push({ pathname: '/user/[id]', params: { id: p.id } })}
        />
      ) : canAdd ? (
        <Button
          label={t('profile.addFriend')}
          loading={busy}
          onPress={() => void add()}
          style={failed ? { borderWidth: 2, borderColor: colors.danger } : undefined}
        />
      ) : null}
    </View>
  );
}

function PeopleList({ people, me }: { people: Person[]; me: string }) {
  return (
    <View>
      {people.map((p) => (
        <PersonRow key={p.id} p={p} me={me} />
      ))}
    </View>
  );
}

export default function Explore() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const me = session?.user.id;
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'people' | 'posts'>('people');
  const term = cleanSearch(useDebounced(text, 300));
  const searching = term.length > 0;

  const people = useQuery({
    queryKey: ['people', 'search', term, me],
    enabled: searching && mode === 'people' && !!me,
    queryFn: async (): Promise<Person[]> => {
      const pat = ilikePattern(term);
      const [a, b] = await Promise.all([
        supabase
          .from('profiles')
          .select(PERSON_COLS)
          .ilike('username', pat)
          .neq('id', me!)
          .limit(20),
        supabase
          .from('profiles')
          .select(PERSON_COLS)
          .ilike('display_name', pat)
          .neq('id', me!)
          .limit(20),
      ]);
      if (a.error || b.error) throw new Error('search');
      const seen = new Map<string, Person>();
      for (const p of [...(a.data ?? []), ...(b.data ?? [])] as Person[])
        if (p.username && !seen.has(p.id)) seen.set(p.id, p);
      return [...seen.values()].slice(0, 20);
    },
  });
  const postSearch = useQuery({
    queryKey: ['explore', 'posts', term],
    enabled: searching && mode === 'posts',
    queryFn: async (): Promise<PostRow[]> => {
      const pat = ilikePattern(term);
      const base = () =>
        supabase
          .from('content_items')
          .select('id, title, type, topic_label')
          .eq('publishing', 'published')
          .is('deleted_at', null)
          .order('published_at', { ascending: false })
          .limit(20);
      const [a, b] = await Promise.all([
        base().ilike('title', pat),
        base().ilike('topic_label', pat),
      ]);
      if (a.error || b.error) throw new Error('search');
      const seen = new Map<string, PostRow>();
      for (const r of [...(a.data ?? []), ...(b.data ?? [])] as PostRow[])
        if (!seen.has(r.id)) seen.set(r.id, r);
      return [...seen.values()].slice(0, 20);
    },
  });

  const suggested = useQuery({
    queryKey: ['people', 'suggested', me],
    enabled: !searching && !!me,
    queryFn: async (): Promise<Person[]> => {
      const [fol, creators, recent] = await Promise.all([
        supabase.from('follows').select('followee_id').eq('follower_id', me!).limit(2000),
        supabase
          .from('profiles')
          .select(PERSON_COLS)
          .eq('is_creator', true)
          .neq('id', me!)
          .limit(30),
        supabase
          .from('content_items')
          .select('owner_user_id')
          .eq('publishing', 'published')
          .eq('ownership', 'user')
          .is('deleted_at', null)
          .not('owner_user_id', 'is', null)
          .order('published_at', { ascending: false })
          .limit(40),
      ]);
      const following = new Set((fol.data ?? []).map((r) => r.followee_id as string));
      const authorIds = [
        ...new Set((recent.data ?? []).map((r) => r.owner_user_id as string)),
      ].filter((x) => x !== me);
      const authors = authorIds.length
        ? await supabase.from('profiles').select(PERSON_COLS).in('id', authorIds)
        : { data: [] as Person[] };
      const out = new Map<string, Person>();
      // recently active authors first, then other creators
      for (const p of [
        ...((authors.data ?? []) as Person[]),
        ...((creators.data ?? []) as Person[]),
      ])
        if (p.username && !following.has(p.id) && p.id !== me && !out.has(p.id)) out.set(p.id, p);
      return [...out.values()].slice(0, 10);
    },
  });
  const trending = useQuery({
    queryKey: ['explore', 'trending'],
    enabled: !searching,
    queryFn: async (): Promise<GridPost[]> => {
      const r = await supabase
        .from('content_items')
        .select('id, title, type, content_stats(like_count, save_count)')
        .eq('publishing', 'published')
        .is('deleted_at', null)
        .order('published_at', { ascending: false })
        .limit(60);
      if (r.error) throw new Error('load');
      type Row = {
        id: string;
        title: string;
        type: string;
        content_stats:
          | { like_count: number; save_count: number }
          | { like_count: number; save_count: number }[]
          | null;
      };
      const score = (x: Row) => {
        const s = Array.isArray(x.content_stats) ? x.content_stats[0] : x.content_stats;
        return (s?.like_count ?? 0) + (s?.save_count ?? 0);
      };
      const rows = (r.data as unknown as Row[])
        .map((x, i) => ({ x, i, s: score(x) }))
        .sort((a, b) => b.s - a.s || a.i - b.i) // ties keep newest-first
        .slice(0, 12)
        .map(({ x }) => ({ id: x.id, title: x.title, type: x.type }));
      return withMedia(rows);
    },
  });

  const searchBar = (
    <View style={{ padding: space.lg, gap: space.md }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 48,
          borderRadius: radius.pill,
          backgroundColor: colors.surfaceAlt,
          paddingHorizontal: space.lg,
          gap: space.sm,
        }}
      >
        <Text muted accessibilityElementsHidden>
          🔍
        </Text>
        <TextInput
          value={text}
          onChangeText={setText}
          accessibilityLabel={t('explore.search')}
          placeholder={t(mode === 'people' ? 'explore.search.people' : 'explore.search.posts')}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          maxLength={60}
          style={{ flex: 1, minHeight: 48, fontSize: 16, color: colors.text }}
        />
        {text ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('explore.clear')}
            onPress={() => setText('')}
            style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text muted>✕</Text>
          </PressableScale>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Chip
          label={t('explore.mode.people')}
          selected={mode === 'people'}
          onPress={() => setMode('people')}
        />
        <Chip
          label={t('explore.mode.posts')}
          selected={mode === 'posts'}
          onPress={() => setMode('posts')}
        />
      </View>
    </View>
  );

  let body: React.ReactNode;
  if (searching && mode === 'people') {
    if (people.isLoading) body = <LoadingState />;
    else if (people.isError) body = <ErrorState onRetry={() => void people.refetch()} />;
    else if (!people.data?.length)
      body = (
        <EmptyState glyph="🔍" title={t('explore.noPeople')} message={t('explore.noResultsBody')} />
      );
    else body = <PeopleList people={people.data} me={me!} />;
  } else if (searching) {
    if (postSearch.isLoading) body = <LoadingState />;
    else if (postSearch.isError) body = <ErrorState onRetry={() => void postSearch.refetch()} />;
    else if (!postSearch.data?.length)
      body = (
        <EmptyState glyph="🔍" title={t('explore.noPosts')} message={t('explore.noResultsBody')} />
      );
    else
      body = (
        <View>
          {postSearch.data.map((r) => (
            <PressableScale
              key={r.id}
              accessibilityRole="button"
              accessibilityLabel={r.title}
              onPress={() => router.push({ pathname: '/content/[id]', params: { id: r.id } })}
              style={{
                minHeight: 56,
                paddingHorizontal: space.lg,
                paddingVertical: space.sm,
                justifyContent: 'center',
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <Text style={{ fontWeight: '600' }} numberOfLines={2}>
                {r.title}
              </Text>
              {r.topic_label ? (
                <Text variant="caption" muted>
                  {r.topic_label}
                </Text>
              ) : null}
            </PressableScale>
          ))}
        </View>
      );
  } else {
    body = (
      <View style={{ gap: space.lg }}>
        <View style={{ gap: space.xs }}>
          <Text
            variant="heading"
            style={{ paddingHorizontal: space.lg }}
            accessibilityRole="header"
          >
            {t('explore.suggested')}
          </Text>
          {suggested.isLoading ? (
            <LoadingState />
          ) : suggested.isError ? (
            <ErrorState onRetry={() => void suggested.refetch()} />
          ) : !suggested.data?.length ? (
            <Text muted style={{ paddingHorizontal: space.lg }}>
              {t('explore.suggested.empty')}
            </Text>
          ) : (
            <PeopleList people={suggested.data} me={me!} />
          )}
        </View>
        <View style={{ gap: space.sm }}>
          <Text
            variant="heading"
            style={{ paddingHorizontal: space.lg }}
            accessibilityRole="header"
          >
            {t('explore.trending')}
          </Text>
          {trending.isLoading ? (
            <LoadingState />
          ) : trending.isError ? (
            <ErrorState onRetry={() => void trending.refetch()} />
          ) : !trending.data?.length ? (
            <Text muted style={{ paddingHorizontal: space.lg }}>
              {t('explore.trending.empty')}
            </Text>
          ) : (
            <PostGrid posts={trending.data} />
          )}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: space.xxl }}
      >
        {searchBar}
        {me ? body : <LoadingState />}
      </ScrollView>
    </SafeAreaView>
  );
}
