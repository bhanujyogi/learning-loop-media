import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../i18n/I18nProvider';
import { useAuth } from '../../lib/auth';
import { startDirect, useFriends } from '../../lib/chat-api';
import { personName, sendErrorKind } from '../../lib/chat-model';
import { supabase } from '../../lib/supabase';
import { HIT, radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { Avatar } from '../../ui/Avatar';
import { PressableScale } from '../../ui/motion';
import { Button, EmptyState, ErrorState, Field, LoadingState, Text } from '../../ui/primitives';
import { ScreenHeader } from '../../ui/ScreenHeader';

const MAX_OTHERS = 49;

/** Pick one friend to open a DM, or several to create a group (friends = mutual follows). */
export default function NewChat() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useAuth();
  const uid = session?.user.id;
  const friends = useFriends(uid);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = friends.data ?? [];
    return q
      ? all.filter((p) => `${p.username} ${p.displayName ?? ''}`.toLowerCase().includes(q))
      : all;
  }, [friends.data, query]);

  const toggle = (id: string) => {
    setError(null);
    setPicked((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= MAX_OTHERS) {
        setError(t('chat.groupLimit'));
        return cur;
      }
      return [...cur, id];
    });
  };

  const isGroup = picked.length >= 2;
  const go = async () => {
    if (busy || !picked.length) return;
    setError(null);
    setTitleError(null);
    if (isGroup && !title.trim()) {
      setTitleError(t('chat.groupNameRequired'));
      return;
    }
    setBusy(true);
    try {
      let id: string;
      if (isGroup) {
        const { data, error: e } = await supabase.rpc('create_group', {
          p_title: title.trim(),
          p_members: picked,
        });
        if (e) throw e;
        id = data as string;
      } else {
        id = await startDirect(picked[0]!);
      }
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      router.replace({ pathname: '/chat/[id]', params: { id } });
    } catch (e) {
      const k = sendErrorKind(e as { code?: string; message?: string });
      setError(
        k === 'forbidden'
          ? t('chat.errForbidden')
          : k === 'rate'
            ? t('chat.errRate')
            : k === 'offline'
              ? t('chat.errOffline')
              : t('chat.startError'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={t('chat.newTitle')} />
      {friends.isLoading ? (
        <LoadingState />
      ) : friends.isError ? (
        <ErrorState
          offline
          message={t('chat.friendsLoadError')}
          onRetry={() => void friends.refetch()}
        />
      ) : !friends.data?.length ? (
        <EmptyState
          glyph="🤝"
          title={t('chat.noFriendsTitle')}
          message={t('chat.noFriendsBody')}
          action={{ label: t('chat.goExplore'), onPress: () => router.replace('/explore') }}
        />
      ) : (
        <>
          <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
            <Text variant="caption" muted>
              {t('chat.pickHint')}
            </Text>
            <Field
              label={t('chat.search')}
              value={query}
              onChangeText={setQuery}
              placeholder={t('chat.search')}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
          </View>
          <FlatList
            data={shown}
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text muted style={{ padding: space.xl, textAlign: 'center' }}>
                {t('chat.noMatch', { query })}
              </Text>
            }
            renderItem={({ item }) => {
              const on = picked.includes(item.id);
              const name = personName(item);
              return (
                <PressableScale
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${name}, @${item.username}`}
                  onPress={() => toggle(item.id)}
                  style={{
                    minHeight: 64,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    paddingHorizontal: space.lg,
                    paddingVertical: space.sm,
                  }}
                >
                  <Avatar path={item.avatarPath} name={name} size={44} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700' }} numberOfLines={1}>
                      {name}
                    </Text>
                    <Text variant="caption" muted numberOfLines={1}>
                      @{item.username}
                    </Text>
                  </View>
                  <View
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: radius.pill,
                      borderWidth: 2,
                      borderColor: on ? colors.primary : colors.border,
                      backgroundColor: on ? colors.primary : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {on ? (
                      <Text style={{ color: colors.onPrimary, fontWeight: '800' }}>✓</Text>
                    ) : null}
                  </View>
                </PressableScale>
              );
            }}
          />
          <View
            style={{
              padding: space.lg,
              gap: space.sm,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              minHeight: HIT,
            }}
          >
            {picked.length ? (
              <Text variant="caption" muted>
                {t('chat.selectedCount', { count: picked.length })}
              </Text>
            ) : null}
            {isGroup ? (
              <Field
                label={t('chat.groupName')}
                value={title}
                onChangeText={(v) => {
                  setTitle(v);
                  setTitleError(null);
                }}
                placeholder={t('chat.groupNamePlaceholder')}
                maxLength={60}
                error={titleError}
              />
            ) : null}
            {error ? (
              <Text accessibilityRole="alert" style={{ color: colors.danger }}>
                {error}
              </Text>
            ) : null}
            <Button
              label={isGroup ? t('chat.createGroup') : t('chat.startChat')}
              disabled={!picked.length}
              loading={busy}
              onPress={() => void go()}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}
