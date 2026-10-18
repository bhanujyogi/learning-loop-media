import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useI18n } from '../../i18n/I18nProvider';
import { useMediaUrl } from '../../lib/media';
import { radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { Button, Card, Text } from '../../ui/primitives';

/** Plays only while `active`; neighbours may preload; distant cards release the player entirely (parent unmounts this component). */
export function VideoCard({
  body,
  active,
  preload,
}: {
  body: { mediaId?: string; durationMs?: number };
  active: boolean;
  preload: boolean;
}) {
  const { t } = useI18n();
  const { url, failed } = useMediaUrl(preload || active ? body.mediaId : undefined);
  const [muted, setMuted] = useState(true);
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.muted = true;
  });
  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);
  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);
  const { colors } = useTheme();
  if (failed) return <Text muted>{t('video.unavailable')}</Text>;
  if (!url) return <Text muted>{t('video.loading')}</Text>;
  return (
    <View style={{ gap: space.sm }}>
      <VideoView
        player={player}
        style={{
          width: '100%',
          aspectRatio: 9 / 16,
          maxHeight: 420,
          borderRadius: radius.lg,
          backgroundColor: colors.surfaceAlt,
        }}
        contentFit="cover"
        nativeControls={false}
        accessibilityLabel={t('video.a11y')}
      />
      <Button
        variant="secondary"
        label={muted ? t('video.unmute') : t('video.mute')}
        onPress={() => setMuted((m) => !m)}
      />
    </View>
  );
}

interface NoteBlock {
  type: string;
  text?: string;
  level?: number;
  items?: string[];
  latex?: string;
  kind?: string;
  prompt?: string;
  label?: string;
}
export interface NoteBody {
  blocks?: NoteBlock[];
}

/** Compact feed version of a note: first heading + first paragraph, so a long note never overflows a card. */
export function NotePreview({ body }: { body: NoteBody }) {
  const blocks = body.blocks ?? [];
  const lead = blocks.find((b) => b.type === 'paragraph' || b.type === 'callout');
  const formula = blocks.find((b) => b.type === 'formula');
  return (
    <View style={{ gap: space.md }}>
      {lead?.text ? (
        <Text numberOfLines={5} style={{ fontSize: 18, lineHeight: 27 }}>
          {lead.text}
        </Text>
      ) : null}
      {formula?.latex ? (
        <Card>
          <Text variant="heading" style={{ textAlign: 'center' }}>
            {formula.latex}
          </Text>
        </Card>
      ) : null}
    </View>
  );
}

/** Whole note (opened full-screen): every block type the content schema allows. */
export function NoteView({ body }: { body: NoteBody }) {
  const { t } = useI18n();
  return (
    <View style={{ gap: space.md }}>
      {(body.blocks ?? []).map((b, i) => {
        switch (b.type) {
          case 'heading':
            return (
              <Text
                key={i}
                variant={b.level && b.level > 1 ? 'heading' : 'display'}
                accessibilityRole="header"
              >
                {b.text}
              </Text>
            );
          case 'paragraph':
            return (
              <Text key={i} style={{ fontSize: 18, lineHeight: 28 }}>
                {b.text}
              </Text>
            );
          case 'list':
            return (
              <View key={i} style={{ gap: space.xs }}>
                {(b.items ?? []).map((it, j) => (
                  <Text key={j} style={{ fontSize: 18, lineHeight: 28 }}>
                    • {it}
                  </Text>
                ))}
              </View>
            );
          case 'formula':
            return (
              <Card key={i}>
                <Text
                  variant="heading"
                  style={{ textAlign: 'center' }}
                  accessibilityLabel={t('note.formula', { latex: b.latex ?? '' })}
                >
                  {b.latex}
                </Text>
              </Card>
            );
          case 'callout':
            return (
              <Card key={i}>
                <Text variant="caption" muted>
                  {(b.kind ?? 'note').toUpperCase()}
                </Text>
                <Text style={{ fontSize: 17, lineHeight: 26 }}>{b.text}</Text>
              </Card>
            );
          case 'revision_prompt':
            return (
              <Card key={i}>
                <Text variant="caption" muted>
                  {t('note.revision')}
                </Text>
                <Text variant="label">💭 {b.prompt}</Text>
              </Card>
            );
          case 'concept_link':
            return (
              <Text key={i} variant="label">
                → {b.label}
              </Text>
            );
          default:
            return null;
        }
      })}
    </View>
  );
}

export interface ImageBody {
  mediaIds?: string[];
  caption?: string;
}

/** One picture: resolves its signed URL, shows a spinner while loading and a truthful message if it can't be shown. */
function Slide({
  mediaId,
  enabled,
  width,
  height,
  label,
  onTap,
}: {
  mediaId: string;
  enabled: boolean;
  width: number;
  height: number;
  label: string;
  onTap: () => void;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { url, failed } = useMediaUrl(enabled ? mediaId : undefined);
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  return (
    <Pressable
      onPress={onTap}
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{
        width,
        height,
        backgroundColor: colors.surfaceAlt,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {failed || broken ? (
        <Text muted style={{ textAlign: 'center', padding: space.lg }}>
          {t('feed.image.error')}
        </Text>
      ) : url ? (
        <Image
          source={{ uri: url }}
          resizeMode="contain"
          onLoad={() => setLoaded(true)}
          onError={() => setBroken(true)}
          style={{ width, height }}
        />
      ) : null}
      {!failed && !broken && !loaded ? (
        <View
          pointerEvents="none"
          accessibilityLabel={t('feed.image.loading')}
          style={{ position: 'absolute' }}
        >
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Swipeable picture post (Instagram-style carousel): horizontal paging, "2 / 5" badge and dots. Double-tap calls `onDoubleTap`
 * (the feed uses it to like) and flashes a heart. Pictures load only for the active card and its neighbours.
 */
export function ImageCard({
  body,
  active,
  preload,
  onDoubleTap,
}: {
  body: ImageBody;
  active: boolean;
  preload: boolean;
  onDoubleTap?: () => void;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const ids = body.mediaIds ?? [];
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const [heart, setHeart] = useState(false);
  const lastTap = useRef(0);
  const heartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (heartTimer.current) clearTimeout(heartTimer.current);
    },
    [],
  );
  const height = Math.round(width * 1.15);
  const onTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 320 && onDoubleTap) {
      lastTap.current = 0;
      onDoubleTap();
      setHeart(true);
      if (heartTimer.current) clearTimeout(heartTimer.current);
      heartTimer.current = setTimeout(() => setHeart(false), 700);
    } else lastTap.current = now;
  }, [onDoubleTap]);
  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width > 0) setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };
  if (!ids.length) return <Text muted>{t('feed.image.error')}</Text>;
  return (
    <View
      style={{ gap: space.sm }}
      onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}
    >
      {width > 0 ? (
        <View style={{ borderRadius: radius.md, overflow: 'hidden' }}>
          <FlatList
            data={ids}
            horizontal
            pagingEnabled
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(id, i) => `${id}-${i}`}
            onMomentumScrollEnd={onEnd}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            initialNumToRender={1}
            windowSize={3}
            renderItem={({ item, index }) => (
              <Slide
                mediaId={item}
                enabled={(active || preload) && Math.abs(index - page) <= 1}
                width={width}
                height={height}
                label={t('feed.image.a11y', { n: index + 1, total: ids.length })}
                onTap={onTap}
              />
            )}
          />
          {ids.length > 1 ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: space.sm,
                right: space.sm,
                backgroundColor: 'rgba(0,0,0,0.6)',
                borderRadius: radius.pill,
                paddingHorizontal: space.md,
                paddingVertical: 2,
              }}
            >
              <Text variant="caption" style={{ color: '#FFFFFF' }}>
                {page + 1} / {ids.length}
              </Text>
            </View>
          ) : null}
          {heart ? (
            <View
              pointerEvents="none"
              accessibilityElementsHidden
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                right: 0,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 96, color: '#FFFFFF', lineHeight: 120 }}>♥</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {ids.length > 1 ? (
        <View
          accessible
          accessibilityLabel={t('feed.image.position', { n: page + 1, total: ids.length })}
          style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}
        >
          {ids.map((_, i) => (
            <View
              key={i}
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                backgroundColor: i === page ? colors.primary : colors.border,
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
