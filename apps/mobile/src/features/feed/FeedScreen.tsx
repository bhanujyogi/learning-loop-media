import { interactiveDefinition } from '@learning-loop/validation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, useWindowDimensions, View, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError, type FeedItem } from '../../lib/api';
import { track } from '../../lib/event-queue';
import { mediaState, mergeBatch, shouldFetchMore } from '../../lib/feed-window';
import { supabase } from '../../lib/supabase';
import { space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { Button, Card, EmptyState, ErrorState, LoadingState, Text } from '../../ui/primitives';
import { InteractiveRenderer } from '../interactive/InteractiveRenderer';
import { FlashcardCard, NoteCard, VideoCard } from './MediaCards';
import { QuestionCard } from './QuestionCard';

type Body = Record<string, unknown>;

function Social({ item }: { item: FeedItem }) {
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  // Optimistic: flip immediately, roll back on failure.
  const toggle = async (
    table: 'likes' | 'saves',
    on: boolean,
    set: (v: boolean) => void,
    ev: string,
    undo: string,
  ) => {
    set(!on);
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid) {
      set(on);
      return;
    }
    const q = on
      ? supabase.from(table).delete().eq('user_id', uid).eq('content_id', item.contentId)
      : supabase.from(table).insert({ user_id: uid, content_id: item.contentId });
    const { error } = await q;
    if (error) set(on);
    else track(on ? undo : ev, { content_id: item.contentId });
  };
  return (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      <Button
        variant="secondary"
        label={liked ? '♥ Liked' : '♡ Like'}
        onPress={() => toggle('likes', liked, setLiked, 'like', 'unlike')}
      />
      <Button
        variant="secondary"
        label={saved ? '★ Saved' : '☆ Save'}
        onPress={() => toggle('saves', saved, setSaved, 'save', 'unsave')}
      />
    </View>
  );
}

function CardBody({
  item,
  active,
  preload,
}: {
  item: FeedItem;
  active: boolean;
  preload: boolean;
}) {
  const body = item.body as Body;
  switch (item.type) {
    case 'question':
      return <QuestionCard contentId={item.contentId} body={body as never} />;
    case 'note':
      return <NoteCard body={body as never} />;
    case 'flashcard':
      return <FlashcardCard body={body as never} />;
    case 'video':
      return <VideoCard body={body as never} active={active} preload={preload} />;
    case 'interactive': {
      const parsed = interactiveDefinition.safeParse(body);
      return parsed.success ? (
        <InteractiveRenderer contentId={item.contentId} def={parsed.data} />
      ) : (
        <Text muted>This interactive isn’t supported in this app version.</Text>
      );
    }
    default:
      return <Text muted>This content type isn’t supported in this app version yet.</Text>;
  }
}

export function FeedScreen() {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const pageH = height - insets.top - insets.bottom - 64; // minus tab bar
  const [items, setItems] = useState<FeedItem[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const fetching = useRef(false);
  const enteredAt = useRef<{ id: string; at: number } | null>(null);

  const load = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    setLoading(true);
    setError(null);
    try {
      const r = await api.feed(10);
      setItems((cur) => mergeBatch(cur, r.items));
      setExhausted(r.exhausted && r.items.length === 0);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(500, 'error'));
    } finally {
      fetching.current = false;
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (shouldFetchMore(active, items.length, fetching.current, exhausted) && items.length)
      void load();
  }, [active, items.length, exhausted, load]);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken<FeedItem>[] }) => {
    const v = viewableItems[0];
    if (!v || v.index == null || !v.item) return;
    const prev = enteredAt.current;
    const now = Date.now();
    if (prev && prev.id !== v.item.contentId) {
      const watched = now - prev.at;
      if (watched < 1500)
        track('skip', { content_id: prev.id, watched_ms: watched, immediate: true });
      else track('content_visible', { content_id: prev.id, visible_ms: watched });
    }
    if (!prev || prev.id !== v.item.contentId) {
      enteredAt.current = { id: v.item.contentId, at: now };
      track('feed_impression', {
        content_id: v.item.contentId,
        position: v.item.position,
        recommendation_id: v.item.recommendationId,
      });
    }
    setActive(v.index);
  }).current;

  if (loading && !items.length) return <LoadingState label="Building your feed…" />;
  if (error && !items.length) return <ErrorState offline={error.isOffline} onRetry={load} />;
  if (!items.length)
    return (
      <EmptyState
        title="You're all caught up"
        message="Nothing new right now. Check back soon, or review what you've learned in the Learn tab."
        action={{ label: 'Refresh', onPress: load }}
      />
    );

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.contentId}
      pagingEnabled
      snapToInterval={pageH}
      decelerationRate="fast"
      showsVerticalScrollIndicator={false}
      getItemLayout={(_, index) => ({ length: pageH, offset: pageH * index, index })}
      windowSize={3}
      maxToRenderPerBatch={2}
      initialNumToRender={2}
      removeClippedSubviews
      viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
      onViewableItemsChanged={onViewable}
      ListFooterComponent={
        exhausted ? (
          <View style={{ height: pageH }}>
            <EmptyState
              title="You're all caught up"
              message="That's everything for now."
              action={{ label: 'Refresh', onPress: load }}
            />
          </View>
        ) : null
      }
      renderItem={({ item, index }) => {
        const m = mediaState(index, active);
        return (
          <View style={{ height: pageH, padding: space.lg, backgroundColor: colors.bg }}>
            <Card style={{ flex: 1, gap: space.md, justifyContent: 'space-between' }}>
              <View style={{ gap: space.sm, flexShrink: 1 }}>
                <Text
                  variant="caption"
                  muted
                  accessibilityLabel={`${item.format ?? item.type}${item.hook ? ', ' + item.hook : ''}`}
                >
                  {(item.format ?? item.type).toUpperCase()}
                  {item.hook ? ` · ${item.hook}` : ''}
                </Text>
                <Text variant="title" accessibilityRole="header">
                  {item.title}
                </Text>
                {m !== 'released' ? (
                  <CardBody item={item} active={m === 'active'} preload={m === 'preload'} />
                ) : null}
              </View>
              <Social item={item} />
            </Card>
          </View>
        );
      }}
    />
  );
}
