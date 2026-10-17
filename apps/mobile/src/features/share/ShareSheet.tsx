/**
 * ShareSheet - bottom sheet for sharing a post into chats.
 *
 * Props:
 * - `contentId` (string): id of the post to share; sent to a chat as the message body `ll:content:<id>`.
 * - `title` (string): post title, used for the external share text ("<title> - shared from Learning Loop").
 * - `visible` (boolean): whether the sheet is shown.
 * - `onClose` (() => void): called when the user dismisses the sheet.
 *
 * Lists the user's conversations and friends (tap to send; a DM is started first for friends without one), shows "Sent"
 * per recipient, and offers "More options" (system share sheet). Tracks a `share` event with {content_id, channel}.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../i18n/I18nProvider';
import { useAuth } from '../../lib/auth';
import { startDirect, useConversations, useFriends } from '../../lib/chat-api';
import { conversationName, personName, sendErrorKind } from '../../lib/chat-model';
import { track } from '../../lib/event-queue';
import { supabase } from '../../lib/supabase';
import { shareToken } from '../../lib/social';
import { radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { Avatar } from '../../ui/Avatar';
import { Button, LoadingState, Text } from '../../ui/primitives';

export function ShareSheet({
  contentId,
  title,
  visible,
  onClose,
}: {
  contentId: string;
  title: string;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const { session } = useAuth();
  const uid = session?.user.id;
  const convs = useConversations(visible ? uid : undefined, false);
  const friends = useFriends(visible ? uid : undefined);
  const [sent, setSent] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setSent([]);
      setError(null);
    }
  }, [visible, contentId]);

  const fail = (e: unknown) => {
    const k = sendErrorKind(e as { code?: string; message?: string });
    setError(
      k === 'rate'
        ? t('chat.errRate')
        : k === 'forbidden'
          ? t('chat.errForbidden')
          : k === 'offline'
            ? t('chat.errOffline')
            : t('chat.shareError'),
    );
  };

  /** key identifies the row (conversation id or `u:<friend id>`); conversationId may need to be created first. */
  const sendTo = async (key: string, conversationId: () => Promise<string>) => {
    if (!uid || busy) return;
    setBusy(key);
    setError(null);
    try {
      const cid = await conversationId();
      const { error: e } = await supabase
        .from('messages')
        .insert({ conversation_id: cid, sender_id: uid, body: shareToken(contentId) });
      if (e) throw e;
      setSent((s) => [...s, key]);
      track('share', { content_id: contentId, channel: 'chat' });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['messages', cid] });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const more = async () => {
    try {
      const r = await Share.share({ message: t('chat.shareMessage', { title }) });
      if (r.action === Share.sharedAction)
        track('share', { content_id: contentId, channel: 'external' });
    } catch {
      setError(t('chat.shareError'));
    }
  };

  const directIds = new Set(
    (convs.data ?? [])
      .filter((c) => c.kind === 'direct' && c.members[0])
      .map((c) => c.members[0]!.id),
  );
  const newFriends = (friends.data ?? []).filter((f) => !directIds.has(f.id));
  const loading = convs.isLoading || friends.isLoading;
  const nothing = !loading && !(convs.data?.length ?? 0) && !newFriends.length;

  const Row = ({
    k,
    name,
    avatarPath,
    group,
    onPress,
  }: {
    k: string;
    name: string;
    avatarPath?: string | null;
    group?: boolean;
    onPress: () => void;
  }) => {
    const done = sent.includes(k);
    return (
      <View style={{ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        {group ? (
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: colors.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text>👥</Text>
          </View>
        ) : (
          <Avatar path={avatarPath} name={name} size={40} />
        )}
        <Text style={{ flex: 1, fontWeight: '700' }} numberOfLines={1}>
          {name}
        </Text>
        <Button
          variant={done ? 'ghost' : 'secondary'}
          label={done ? `✓ ${t('chat.shareSent')}` : t('chat.send')}
          accessibilityLabel={done ? t('chat.shareSent') : t('chat.shareSendTo', { name })}
          loading={busy === k}
          disabled={done}
          onPress={onPress}
        />
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <SafeAreaView
          edges={['bottom']}
          style={{
            maxHeight: '80%',
            backgroundColor: colors.bg,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            padding: space.lg,
            gap: space.sm,
          }}
        >
          <Text variant="heading" accessibilityRole="header">
            {t('chat.shareTitle')}
          </Text>
          {loading ? (
            <LoadingState />
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled">
              {convs.data?.length ? (
                <Text variant="label" muted>
                  {t('chat.shareChats')}
                </Text>
              ) : null}
              {(convs.data ?? []).map((c) => {
                const name = conversationName(
                  c,
                  c.kind === 'group' ? t('chat.untitledGroup') : t('chat.unknownUser'),
                );
                return (
                  <Row
                    key={c.id}
                    k={c.id}
                    name={name}
                    avatarPath={c.members[0]?.avatarPath}
                    group={c.kind === 'group'}
                    onPress={() => void sendTo(c.id, async () => c.id)}
                  />
                );
              })}
              {newFriends.length ? (
                <Text variant="label" muted style={{ marginTop: space.sm }}>
                  {t('chat.shareFriends')}
                </Text>
              ) : null}
              {newFriends.map((f) => (
                <Row
                  key={f.id}
                  k={`u:${f.id}`}
                  name={personName(f)}
                  avatarPath={f.avatarPath}
                  onPress={() => void sendTo(`u:${f.id}`, () => startDirect(f.id))}
                />
              ))}
              {nothing ? <Text muted>{t('chat.shareNothing')}</Text> : null}
            </ScrollView>
          )}
          {error ? (
            <Text accessibilityRole="alert" style={{ color: colors.danger }}>
              {error}
            </Text>
          ) : null}
          <Button variant="secondary" label={t('chat.shareMore')} onPress={() => void more()} />
          <Button variant="ghost" label={t('common.close')} onPress={onClose} />
        </SafeAreaView>
      </View>
    </Modal>
  );
}
