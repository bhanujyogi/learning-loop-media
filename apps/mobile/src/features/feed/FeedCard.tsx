import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useI18n } from '../../i18n/I18nProvider';
import type { FeedItem } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { kindOf, radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { LOCALE_NAMES } from '../../ui/LanguageSwitch';
import { Pill, Text, ToggleButton } from '../../ui/primitives';
import { difficultyBand, difficultyKey, kindLabelKey, positionLabel } from './card-model';
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

export function FeedCard({
  item,
  index,
  total,
  height,
  active,
  preload,
  reactions,
  onNext,
}: {
  item: FeedItem;
  index: number;
  total: number;
  height: number;
  active: boolean;
  preload: boolean;
  reactions: Reactions;
  onNext: () => void;
}) {
  const { colors, kind: kindColors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const kind = kindOf(item.type, item.format);
  const k = kindColors(kind);
  const band = difficultyBand(item.difficulty);
  const handle = useHandle(item.creatorUserId);
  const canFollow = !!item.creatorUserId && item.creatorUserId !== reactions.uid;
  const otherLanguage = item.language !== locale;
  const kindLabel = t(kindLabelKey(kind, item.format));

  return (
    <View style={{ height, padding: space.lg }}>
      <View
        accessibilityLabel={`${positionLabel(index, total)}. ${kindLabel}. ${item.title}`}
        style={{
          flex: 1,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          overflow: 'hidden',
        }}
      >
        {/* header band: kind colour + text label (never colour alone) */}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: space.sm,
            paddingHorizontal: space.xl,
            paddingVertical: space.md,
            backgroundColor: k.bg,
          }}
        >
          <Pill label={kindLabel.toUpperCase()} fg={k.fg} bg={colors.surface} />
          {band ? <Pill label={t(difficultyKey(band))} fg={k.fg} bg={colors.surface} /> : null}
          {item.isExploration ? (
            <Pill label={t('feed.exploration')} fg={k.fg} bg={colors.surface} />
          ) : null}
          {otherLanguage ? (
            <Pill
              label={t('feed.langBadge', {
                language:
                  LOCALE_NAMES[item.language as keyof typeof LOCALE_NAMES] ??
                  item.language.toUpperCase(),
              })}
              fg={k.fg}
              bg={colors.surface}
            />
          ) : null}
        </View>

        {/* body scrolls only when it must (e.g. a long explanation); short cards just sit still */}
        <ScrollView
          nestedScrollEnabled
          bounces={false}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: space.xl, gap: space.lg }}
        >
          <Text variant="display" accessibilityRole="header">
            {item.title}
          </Text>
          <ContentBody
            item={item}
            recommendationId={item.recommendationId}
            mode="feed"
            active={active}
            preload={preload}
            onNext={onNext}
          />
        </ScrollView>

        <View
          style={{
            gap: space.sm,
            padding: space.lg,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          {item.creatorUserId || item.official ? (
            <Pressable
              accessibilityRole={item.creatorUserId ? 'link' : 'text'}
              disabled={!item.creatorUserId}
              onPress={() =>
                item.creatorUserId &&
                router.push({ pathname: '/user/[id]', params: { id: item.creatorUserId } })
              }
              style={{ minHeight: 32, justifyContent: 'center' }}
            >
              <Text variant="caption" muted>
                {item.creatorUserId && handle.data
                  ? t('social.by', { handle: handle.data })
                  : t('feed.byOfficial')}
              </Text>
            </Pressable>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <ToggleButton
              on={reactions.liked.has(item.contentId)}
              glyphOn="♥"
              glyphOff="♡"
              labelOn={t('social.liked')}
              labelOff={t('social.like')}
              onPress={() => reactions.toggleLike(item.contentId, item.recommendationId)}
            />
            <ToggleButton
              on={reactions.saved.has(item.contentId)}
              glyphOn="★"
              glyphOff="☆"
              labelOn={t('social.saved')}
              labelOff={t('social.save')}
              onPress={() => reactions.toggleSave(item.contentId, item.recommendationId)}
            />
            {canFollow ? (
              <ToggleButton
                on={reactions.followed.has(item.creatorUserId!)}
                glyphOn="✓"
                glyphOff="＋"
                labelOn={t('social.following')}
                labelOff={t('social.follow')}
                onPress={() => reactions.toggleFollow(item.creatorUserId!)}
              />
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}
