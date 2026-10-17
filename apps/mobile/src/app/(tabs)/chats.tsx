import { useRouter } from 'expo-router';
import { FlatList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../i18n/I18nProvider';
import { useConversations, useFriendRequests } from '../../lib/chat-api';
import {
  conversationName,
  formatChatTime,
  messagePreview,
  type ConversationRow,
} from '../../lib/chat-model';
import { useAuth } from '../../lib/auth';
import { HIT, radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { Avatar } from '../../ui/Avatar';
import { PressableScale } from '../../ui/motion';
import { EmptyState, ErrorState, LoadingState, Text } from '../../ui/primitives';

function HeaderButton({
  glyph,
  label,
  badge,
  onPress,
}: {
  glyph: string;
  label: string;
  badge?: number;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={{ width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ fontSize: 24 }}>{glyph}</Text>
      {badge ? (
        <View
          style={{
            position: 'absolute',
            top: 4,
            right: 2,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            paddingHorizontal: 4,
            backgroundColor: colors.danger,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="caption" style={{ color: colors.bg, fontWeight: '700', lineHeight: 16 }}>
            {badge > 9 ? '9+' : badge}
          </Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

function Row({ c }: { c: ConversationRow }) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const name = conversationName(
    c,
    c.kind === 'group' ? t('chat.untitledGroup') : t('chat.unknownUser'),
  );
  const p = messagePreview(c.lastBody);
  const preview =
    p.kind === 'share' ? t('chat.sharedPost') : p.kind === 'text' ? p.text : t('chat.noMessages');
  const time = formatChatTime(c.lastMessageAt, new Date(), locale);
  const unread = c.unread > 0;
  const first = c.members[0];
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={[name, preview, time, unread ? t('chat.unread', { count: c.unread }) : '']
        .filter(Boolean)
        .join('. ')}
      onPress={() => router.push({ pathname: '/chat/[id]', params: { id: c.id } })}
      style={{
        minHeight: 72,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
      }}
    >
      {c.kind === 'group' ? (
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            backgroundColor: colors.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 24 }}>👥</Text>
        </View>
      ) : (
        <Avatar path={first?.avatarPath} name={name} size={52} />
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontWeight: unread ? '800' : '700' }}>
          {name}
        </Text>
        <View style={{ flexDirection: 'row', gap: space.xs }}>
          <Text
            variant="caption"
            muted={!unread}
            numberOfLines={1}
            style={{ flexShrink: 1, fontWeight: unread ? '700' : '400' }}
          >
            {preview}
          </Text>
          {time ? (
            <Text variant="caption" muted>
              · {time}
            </Text>
          ) : null}
        </View>
      </View>
      {unread ? (
        <View
          style={{
            minWidth: 22,
            height: 22,
            borderRadius: radius.pill,
            paddingHorizontal: 6,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            variant="caption"
            style={{ color: colors.onPrimary, fontWeight: '700', lineHeight: 18 }}
          >
            {c.unread > 99 ? '99+' : c.unread}
          </Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

/** Instagram-style inbox: newest conversation first, unread emphasised, polled every ~5s while focused. */
export default function Chats() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user.id;
  const convs = useConversations(uid, 5000);
  const requests = useFriendRequests(uid);
  const pending = requests.data?.incoming.length ?? 0;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: space.lg,
          paddingRight: space.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Text variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
          {t('chat.title')}
        </Text>
        <HeaderButton
          glyph="👤"
          label={
            pending
              ? `${t('chat.friends')}. ${t('chat.requestsBadge', { count: pending })}`
              : t('chat.friends')
          }
          badge={pending}
          onPress={() => router.push('/friends')}
        />
        <HeaderButton
          glyph="✏️"
          label={t('chat.newChat')}
          onPress={() => router.push('/chat/new')}
        />
      </View>
      {convs.isLoading ? (
        <LoadingState />
      ) : convs.isError && !convs.data ? (
        <ErrorState offline message={t('chat.loadError')} onRetry={() => void convs.refetch()} />
      ) : !convs.data?.length ? (
        <EmptyState
          glyph="💬"
          title={t('chat.emptyTitle')}
          message={t('chat.emptyBody')}
          action={{ label: t('chat.emptyCta'), onPress: () => router.push('/chat/new') }}
        />
      ) : (
        <FlatList
          data={convs.data}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => <Row c={item} />}
          ItemSeparatorComponent={() => (
            <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 80 }} />
          )}
          refreshing={convs.isRefetching && !convs.isLoading}
          onRefresh={() => void convs.refetch()}
        />
      )}
    </SafeAreaView>
  );
}
