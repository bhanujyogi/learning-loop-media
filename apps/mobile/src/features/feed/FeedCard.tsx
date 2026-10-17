import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useI18n } from '../../i18n/I18nProvider';
import type { FeedItem } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { kindOf, radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { LOCALE_NAMES } from '../../ui/LanguageSwitch';
import { Avatar } from '../../ui/Avatar';
import { PressableScale } from '../../ui/motion';
import { Pill, Text } from '../../ui/primitives';
import { ShareSheet } from '../share/ShareSheet';
import { authorName, useAuthor } from './author';
import { difficultyBand, difficultyKey, positionLabel, typeLabelKey } from './card-model';
import { ContentBody } from './ContentBody';

/** `@handle` of a creator (RLS: profiles are readable by signed-in users). Cached per user id. */
export function useHandle(userId: string | null | undefined) {
  return useQuery({
    queryKey: ['handle', userId],
    enabled: !!userId,
    staleTime: 10 * 60_000,
    queryFn: async () =>
      (await supabase.from('profiles').select('username').eq('id', userId!).maybeSingle()).data
        ?.username ?? null,
  });
}

interface Reactions {
  uid?: string;
  liked: Set<string>;
  saved: Set<string>;
  followed: Set<string>;
  toggleLike: (id: string, rec?: string) => void;
  toggleSave: (id: string, rec?: string) => void;
  toggleFollow: (creatorId: string) => void;
}

/** Round icon-style action (Instagram action bar): glyph only, with a spoken label; 48dp touch target. */
function Action({
  glyph,
  label,
  onPress,
  on,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
  on?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={on === undefined ? undefined : { selected: on }}
      onPress={onPress}
      style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ fontSize: 28, lineHeight: 36, color: on ? colors.danger : colors.text }}>
        {glyph}
      </Text>
    </PressableScale>
  );
}

export function FeedCard({
  item,
  index,
  total,
  height,
  active,
  preload,
  reactions,
  onNext,
  onReport,
}: {
  item: FeedItem;
  index: number;
  total: number;
  height: number;
  active: boolean;
  preload: boolean;
  reactions: Reactions;
  onNext: () => void;
  onReport: (contentId: string) => void;
}) {
  const { colors, kind: kindColors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const [sharing, setSharing] = useState(false);
  const kind = kindOf(item.type, item.format);
  const k = kindColors(kind);
  const band = difficultyBand(item.difficulty);
  const author = useAuthor(item.creatorUserId);
  const canFollow = !!item.creatorUserId && item.creatorUserId !== reactions.uid;
  const otherLanguage = item.language !== locale;
  const kindLabel = t(typeLabelKey(item.type, kind, item.format));
  const official = item.official || !item.creatorUserId;
  const name = official
    ? t('feed.byOfficial')
    : (authorName(author.data) ?? t('feed.card.someone'));
  const topic = (item as FeedItem & { topicLabel?: string | null }).topicLabel?.trim() || null;
  const liked = reactions.liked.has(item.contentId);
  const saved = reactions.saved.has(item.contentId);
  const following = !!item.creatorUserId && reactions.followed.has(item.creatorUserId);
  const media = item.type === 'image' || item.type === 'video';
  const imageCaption =
    item.type === 'image' ? ((item.body as { caption?: string } | null)?.caption ?? '') : '';
  const openAuthor = () =>
    item.creatorUserId &&
    router.push({ pathname: '/user/[id]', params: { id: item.creatorUserId } });

  return (
    <View style={{ height, padding: space.sm }}>
      <View
        accessibilityLabel={`${positionLabel(index, total)}. ${kindLabel}. ${item.title}`}
        style={{
          flex: 1,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          overflow: 'hidden',
        }}
      >
        {/* header: avatar, name, topic or kind, follow */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            paddingHorizontal: space.md,
            paddingVertical: space.sm,
          }}
        >
          <Pressable
            accessibilityRole={official ? 'text' : 'link'}
            accessibilityLabel={name}
            disabled={official}
            onPress={openAuthor}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              minHeight: 48,
            }}
          >
            <Avatar
              path={official ? null : author.data?.avatarPath}
              name={official ? 'L' : (author.data?.displayName ?? author.data?.username)}
              size={40}
              ring={!official}
            />
            <View style={{ flex: 1 }}>
              <Text variant="label" numberOfLines={1} style={{ fontWeight: '700' }}>
                {name}
              </Text>
              <Text variant="caption" muted numberOfLines={1}>
                {topic ?? kindLabel}
              </Text>
            </View>
          </Pressable>
          {canFollow ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={following ? t('social.following') : t('social.follow')}
              accessibilityState={{ selected: following }}
              hitSlop={8}
              onPress={() => reactions.toggleFollow(item.creatorUserId!)}
              style={{
                minHeight: 36,
                paddingHorizontal: space.lg,
                borderRadius: radius.pill,
                justifyContent: 'center',
                backgroundColor: following ? colors.surfaceAlt : colors.primary,
              }}
            >
              <Text variant="label" style={{ color: following ? colors.text : colors.onPrimary }}>
                {following ? t('social.following') : t('social.follow')}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* media / body scrolls only when it must (e.g. a long explanation); short cards just sit still */}
        <ScrollView
          nestedScrollEnabled
          bounces={false}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{
            paddingHorizontal: media ? space.sm : space.lg,
            paddingVertical: space.sm,
            gap: space.lg,
          }}
        >
          {media ? null : (
            <Text variant="display" accessibilityRole="header">
              {item.title}
            </Text>
          )}
          <ContentBody
            item={item}
            recommendationId={item.recommendationId}
            mode="feed"
            active={active}
            preload={preload}
            onNext={onNext}
            onDoubleTap={
              liked ? undefined : () => reactions.toggleLike(item.contentId, item.recommendationId)
            }
          />
        </ScrollView>

        {/* action bar: like, share, save (left to right) and report */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: space.sm,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <Action
            glyph={liked ? '♥' : '♡'}
            on={liked}
            label={liked ? t('social.liked') : t('social.like')}
            onPress={() => reactions.toggleLike(item.contentId, item.recommendationId)}
          />
          <Action glyph="↗" label={t('feed.card.share')} onPress={() => setSharing(true)} />
          <Action
            glyph={saved ? '★' : '☆'}
            on={saved}
            label={saved ? t('social.saved') : t('social.save')}
            onPress={() => reactions.toggleSave(item.contentId, item.recommendationId)}
          />
          <View style={{ flex: 1 }} />
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('report.action')}
            onPress={() => onReport(item.contentId)}
            style={{
              minHeight: 48,
              minWidth: 48,
              paddingHorizontal: space.md,
              justifyContent: 'center',
            }}
          >
            <Text variant="caption" muted>
              {t('report.action')}
            </Text>
          </PressableScale>
        </View>

        {/* caption: bold author name + title (pictures and videos also show their own caption) */}
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.xs }}>
          {media ? (
            <Text numberOfLines={2}>
              <Text style={{ fontWeight: '700' }}>{name} </Text>
              {item.title}
            </Text>
          ) : null}
          {imageCaption ? (
            <Text variant="caption" muted numberOfLines={3}>
              {imageCaption}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Pill label={kindLabel.toUpperCase()} fg={k.fg} bg={k.bg} />
            {band ? <Pill label={t(difficultyKey(band))} fg={k.fg} bg={k.bg} /> : null}
            {item.isExploration ? <Pill label={t('feed.exploration')} fg={k.fg} bg={k.bg} /> : null}
            {otherLanguage ? (
              <Pill
                label={t('feed.langBadge', {
                  language:
                    LOCALE_NAMES[item.language as keyof typeof LOCALE_NAMES] ??
                    item.language.toUpperCase(),
                })}
                fg={k.fg}
                bg={k.bg}
              />
            ) : null}
          </View>
        </View>
      </View>
      {sharing ? (
        <ShareSheet
          contentId={item.contentId}
          title={item.title}
          visible
          onClose={() => setSharing(false)}
        />
      ) : null}
    </View>
  );
}
