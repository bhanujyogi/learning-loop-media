import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Image, useWindowDimensions, View } from 'react-native';
import { useI18n } from '../../i18n/I18nProvider';
import { bodyMediaIds, formatCount } from '../../lib/profile-model';
import { useMediaUrl } from '../../lib/media';
import { supabase } from '../../lib/supabase';
import { space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { PressableScale } from '../../ui/motion';
import { Text } from '../../ui/primitives';

export interface GridPost {
  id: string;
  title: string;
  type: string;
  mediaId?: string;
  publishing?: string;
}

export const GRID_GAP = 2;

/** Posts of a person that RLS lets me see (own: all non-removed; others: published). Adds the first image id per post. */
export async function fetchPosts(ownerId: string, ownOnly: boolean): Promise<GridPost[]> {
  let q = supabase
    .from('content_items')
    .select('id, title, type, publishing')
    .eq('owner_user_id', ownerId)
    .neq('ownership', 'official')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(60);
  if (!ownOnly) q = q.eq('publishing', 'published');
  const r = await q;
  if (r.error) throw new Error('load');
  return withMedia(r.data as GridPost[]);
}

export async function withMedia(posts: GridPost[]): Promise<GridPost[]> {
  const imageIds = posts.filter((p) => p.type === 'image').map((p) => p.id);
  if (!imageIds.length) return posts;
  const v = await supabase
    .from('content_versions')
    .select('content_id, body')
    .in('content_id', imageIds);
  const media = new Map<string, string>();
  for (const row of v.data ?? []) {
    const id = bodyMediaIds(row.body)[0];
    if (id && !media.has(row.content_id as string)) media.set(row.content_id as string, id);
  }
  return posts.map((p) => (media.has(p.id) ? { ...p, mediaId: media.get(p.id) } : p));
}

function Tile({ post, size }: { post: GridPost; size: number }) {
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useI18n();
  const { url } = useMediaUrl(post.type === 'image' ? post.mediaId : undefined);
  const draft = post.publishing && post.publishing !== 'published';
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={post.title}
      onPress={() => router.push({ pathname: '/content/[id]', params: { id: post.id } })}
      style={{
        width: size,
        height: size,
        backgroundColor: colors.surfaceAlt,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {url ? (
        <Image source={{ uri: url }} style={{ width: size, height: size }} resizeMode="cover" />
      ) : post.type === 'video' ? (
        <Text style={{ fontSize: 34 }}>▶</Text>
      ) : (
        <Text variant="label" numberOfLines={5} style={{ padding: space.sm, textAlign: 'center' }}>
          {post.title}
        </Text>
      )}
      {draft ? (
        <View
          style={{
            position: 'absolute',
            left: 4,
            top: 4,
            backgroundColor: colors.text,
            borderRadius: 4,
            paddingHorizontal: 5,
          }}
        >
          <Text variant="caption" style={{ color: colors.bg }}>
            {t('profile.postPending')}
          </Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

/** Instagram-style 3-column square grid with 2px gaps. */
export function PostGrid({ posts }: { posts: GridPost[] }) {
  const { width } = useWindowDimensions();
  const size = Math.floor((width - GRID_GAP * 2) / 3);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP }}>
      {posts.map((p) => (
        <Tile key={p.id} post={p} size={size} />
      ))}
    </View>
  );
}

export function StatCell({
  value,
  label,
  onPress,
}: {
  value: number | string;
  label: string;
  onPress?: () => void;
}) {
  const shown = typeof value === 'number' ? formatCount(value) : value;
  return (
    <PressableScale
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={`${shown} ${label}`}
      disabled={!onPress}
      onPress={onPress}
      style={{ alignItems: 'center', flex: 1, minHeight: 48, justifyContent: 'center' }}
    >
      <Text variant="heading">{shown}</Text>
      <Text variant="caption" muted numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

/** Posts for a profile (react-query). */
export function usePosts(ownerId: string | undefined, ownOnly: boolean) {
  return useQuery({
    queryKey: ['profile-posts', ownerId, ownOnly],
    enabled: !!ownerId,
    queryFn: () => fetchPosts(ownerId!, ownOnly),
  });
}

/** Exact number of posts I'm allowed to see for a person. */
export function usePostCount(ownerId: string | undefined, ownOnly: boolean) {
  return useQuery({
    queryKey: ['profile-post-count', ownerId, ownOnly],
    enabled: !!ownerId,
    queryFn: async () => {
      let q = supabase
        .from('content_items')
        .select('id', { count: 'exact', head: true })
        .eq('owner_user_id', ownerId!)
        .neq('ownership', 'official')
        .is('deleted_at', null);
      if (!ownOnly) q = q.eq('publishing', 'published');
      const r = await q;
      if (r.error) throw new Error('load');
      return r.count ?? 0;
    },
  });
}
