import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, View, type ViewToken } from 'react-native';
import { useI18n } from '../../i18n/I18nProvider';
import type { FeedItem } from '../../lib/api';
import { track } from '../../lib/event-queue';
import { mediaState, shouldFetchMore } from '../../lib/feed-window';
import { useFeed } from '../../lib/use-feed';
import { useNotice } from '../../lib/use-notice';
import { useReactions } from '../../lib/use-reactions';
import { useTheme } from '../../theme/useTheme';
import { EmptyState, ErrorState, Button, Text } from '../../ui/primitives';
import { FeedCardSkeleton } from '../../ui/Skeleton';
import { Toast } from '../../ui/Toast';
import { FeedCard } from './FeedCard';
import { SessionStrip } from './SessionStrip';

// Must be a stable object: React Native does not support changing viewabilityConfig on a mounted list.
const VIEWABILITY = { itemVisiblePercentThreshold: 80 } as const;

/** Vertical, paged, virtualised learning feed backed by the server's ranking pipeline. */
export function FeedScreen() {
  const { t, prefsVersion } = useI18n();
  const { colors } = useTheme();
  const feed = useFeed();
  const { notice, show } = useNotice();
  const [pageH, setPageH] = useState(0);
  const [active, setActive] = useState(0);
  const list = useRef<FlatList<FeedItem>>(null);
  const enteredAt = useRef<{ id: string; at: number; rec: string } | null>(null);

  const reactions = useReactions(
    feed.items.map((i) => i.contentId),
    feed.items.flatMap((i) => (i.creatorUserId ? [i.creatorUserId] : [])),
    useCallback(() => show(t('social.actionError')), [show, t]),
  );

  // The viewability callback must be stable, so it reads the latest state through a ref.
  const live = useRef({ total: 0, paging: false, exhausted: false, loadMore: feed.loadMore });
  live.current = {
    total: feed.items.length,
    paging: feed.paging,
    exhausted: feed.exhausted,
    loadMore: feed.loadMore,
  };

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken<FeedItem>[] }) => {
    const v = viewableItems[0];
    if (!v || v.index == null || !v.item) return;
    const prev = enteredAt.current;
    const now = Date.now();
    if (prev && prev.id !== v.item.contentId) {
      const watched = now - prev.at;
      if (watched < 1500)
        track('skip', {
          content_id: prev.id,
          recommendation_id: prev.rec,
          watched_ms: watched,
          immediate: true,
        });
      else
        track('content_visible', {
          content_id: prev.id,
          recommendation_id: prev.rec,
          visible_ms: watched,
        });
    }
    if (!prev || prev.id !== v.item.contentId) {
      enteredAt.current = { id: v.item.contentId, at: now, rec: v.item.recommendationId };
      track('feed_impression', {
        content_id: v.item.contentId,
        position: v.item.position,
        recommendation_id: v.item.recommendationId,
      });
    }
    setActive(v.index);
    const l = live.current;
    if (shouldFetchMore(v.index, l.total, l.paging, l.exhausted)) void l.loadMore();
  }).current;

  const goNext = useCallback(() => {
    const next = active + 1;
    if (next < feed.items.length) list.current?.scrollToIndex({ index: next, animated: true });
    else if (!feed.exhausted) void feed.loadMore();
  }, [active, feed]);

  // A saved language change must change the CONTENT too (the feed serves the learner's language + English), not just the UI.
  const lastPrefs = useRef(prefsVersion);
  useEffect(() => {
    if (lastPrefs.current === prefsVersion) return;
    lastPrefs.current = prefsVersion;
    setActive(0);
    feed.reset();
  }, [prefsVersion]);

  // A failed pull-to-refresh while items are on screen must not be silent.
  useEffect(() => {
    if (feed.error && feed.items.length) show(t('feed.refreshError'));
  }, [feed.error, feed.items.length, show, t]);

  // Pull-to-refresh with nothing newer: say so instead of silently doing nothing.
  useEffect(() => {
    if (feed.upToDate) show(t('feed.upToDate'));
  }, [feed.upToDate, show, t]);

  let content: React.ReactNode;
  if (pageH === 0) content = null;
  else if (feed.loading && !feed.items.length) content = <FeedCardSkeleton />;
  else if (feed.error && !feed.items.length)
    content = <ErrorState offline={feed.error.isOffline} onRetry={() => void feed.retry()} />;
  else if (!feed.items.length)
    content = (
      <EmptyState
        glyph="🎉"
        title={t('feed.caughtUp.title')}
        message={t('feed.caughtUp.body')}
        action={{ label: t('feed.refresh'), onPress: () => void feed.retry() }}
      />
    );
  else
    content = (
      <FlatList
        ref={list}
        data={feed.items}
        keyExtractor={(i) => i.contentId}
        pagingEnabled
        disableIntervalMomentum
        snapToInterval={pageH}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        getItemLayout={(_, index) => ({ length: pageH, offset: pageH * index, index })}
        windowSize={3}
        maxToRenderPerBatch={2}
        initialNumToRender={2}
        removeClippedSubviews
        viewabilityConfig={VIEWABILITY}
        onViewableItemsChanged={onViewable}
        refreshControl={
          <RefreshControl
            refreshing={feed.refreshing}
            onRefresh={() => void feed.refresh()}
            accessibilityLabel={t('feed.refresh')}
          />
        }
        ListFooterComponent={
          feed.pagingError ? (
            <View
              style={{ height: pageH, alignItems: 'center', justifyContent: 'center', gap: 12 }}
            >
              <Text muted>{t('feed.moreError')}</Text>
              <Button label={t('common.retry')} onPress={() => void feed.loadMore()} />
            </View>
          ) : feed.paging ? (
            <View style={{ height: pageH }}>
              <FeedCardSkeleton />
            </View>
          ) : feed.exhausted ? (
            <View style={{ height: pageH }}>
              <EmptyState
                glyph="🎉"
                title={t('feed.caughtUp.title')}
                message={t('feed.caughtUp.body')}
                action={{ label: t('feed.refresh'), onPress: () => void feed.refresh() }}
              />
            </View>
          ) : null
        }
        renderItem={({ item, index }) => {
          const m = mediaState(index, active);
          // Far-away cards keep their slot (so scroll offsets stay exact) but release heavy content.
          return m === 'released' ? (
            <View style={{ height: pageH }} />
          ) : (
            <FeedCard
              item={item}
              index={index}
              total={feed.items.length}
              height={pageH}
              active={m === 'active'}
              preload={m === 'preload'}
              reactions={reactions}
              onNext={goNext}
            />
          );
        }}
      />
    );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SessionStrip />
      <View style={{ flex: 1 }} onLayout={(e) => setPageH(Math.floor(e.nativeEvent.layout.height))}>
        {content}
        <Toast message={notice} />
      </View>
    </View>
  );
}
