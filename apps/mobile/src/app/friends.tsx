import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../i18n/I18nProvider';
import { useAuth } from '../lib/auth';
import { startDirect, useFriendRequests, useFriends } from '../lib/chat-api';
import { personName, sendErrorKind, type ChatPerson } from '../lib/chat-model';
import { respondFriendRequest } from '../lib/social';
import { useNotice } from '../lib/use-notice';
import { space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Avatar } from '../ui/Avatar';
import { PressableScale } from '../ui/motion';
import { Button, ErrorState, LoadingState, Text } from '../ui/primitives';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Toast } from '../ui/Toast';

function PersonLine({ person, children }: { person: ChatPerson; children?: React.ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const name = personName(person);
  return (
    <View
      style={{
        minHeight: 64,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingVertical: space.sm,
      }}
    >
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('chat.openProfile', { name })}
        onPress={() => router.push({ pathname: '/user/[id]', params: { id: person.id } })}
        style={{
          flex: 1,
          minHeight: 48,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
        }}
      >
        <Avatar path={person.avatarPath} name={name} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '700' }} numberOfLines={1}>
            {name}
          </Text>
          <Text variant="caption" muted numberOfLines={1}>
            @{person.username}
          </Text>
        </View>
      </PressableScale>
      {children}
    </View>
  );
}

/** Friends (mutual follows), incoming friend requests with Accept/Decline, and the requests I have sent. */
export default function Friends() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useAuth();
  const uid = session?.user.id;
  const friends = useFriends(uid);
  const requests = useFriendRequests(uid);
  const { notice, show } = useNotice();
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['friends'] });
    void qc.invalidateQueries({ queryKey: ['friend-requests'] });
  };
  const respond = async (id: string, accept: boolean) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await respondFriendRequest(id, accept);
      show(accept ? t('chat.requestAccepted') : t('chat.requestDeclined'));
      refresh();
    } catch {
      show(t('chat.respondError'));
    } finally {
      setBusyId(null);
    }
  };
  const message = async (p: ChatPerson) => {
    if (busyId) return;
    setBusyId(p.id);
    try {
      const id = await startDirect(p.id);
      router.push({ pathname: '/chat/[id]', params: { id } });
    } catch (e) {
      show(
        sendErrorKind(e as { code?: string; message?: string }) === 'forbidden'
          ? t('chat.errForbidden')
          : t('chat.startError'),
      );
    } finally {
      setBusyId(null);
    }
  };

  const heading = (label: string, count?: number) => (
    <Text variant="heading" accessibilityRole="header" style={{ marginTop: space.lg }}>
      {label}
      {count ? ` (${count})` : ''}
    </Text>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={t('chat.friendsTitle')} />
      {friends.isLoading || requests.isLoading ? (
        <LoadingState />
      ) : friends.isError || requests.isError ? (
        <ErrorState
          offline
          message={t('chat.friendsLoadError')}
          onRetry={() => {
            void friends.refetch();
            void requests.refetch();
          }}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl }}
        >
          {heading(t('chat.requests'), requests.data?.incoming.length)}
          {requests.data?.incoming.length ? (
            requests.data.incoming.map((r) => (
              <PersonLine key={r.id} person={r.person}>
                <Button
                  label={t('chat.accept')}
                  disabled={busyId === r.id}
                  onPress={() => void respond(r.id, true)}
                  style={{ paddingHorizontal: space.md }}
                />
                <Button
                  variant="secondary"
                  label={t('chat.decline')}
                  disabled={busyId === r.id}
                  onPress={() => void respond(r.id, false)}
                  style={{ paddingHorizontal: space.md }}
                />
              </PersonLine>
            ))
          ) : (
            <Text muted>{t('chat.noRequests')}</Text>
          )}

          {heading(t('chat.friendsTitle'), friends.data?.length)}
          {friends.data?.length ? (
            friends.data.map((p) => (
              <PersonLine key={p.id} person={p}>
                <Button
                  variant="secondary"
                  label={t('chat.message')}
                  disabled={busyId === p.id}
                  onPress={() => void message(p)}
                  style={{ paddingHorizontal: space.md }}
                />
              </PersonLine>
            ))
          ) : (
            <Text muted>{t('chat.noFriends')}</Text>
          )}

          {heading(t('chat.sentRequests'), requests.data?.sent.length)}
          {requests.data?.sent.length ? (
            requests.data.sent.map((r) => (
              <PersonLine key={r.id} person={r.person}>
                <Text variant="caption" muted>
                  {t('chat.pending')}
                </Text>
              </PersonLine>
            ))
          ) : (
            <Text muted>{t('chat.noSent')}</Text>
          )}
        </ScrollView>
      )}
      <Toast message={notice} />
    </SafeAreaView>
  );
}
