import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../i18n/I18nProvider';
import { useAuth } from '../../lib/auth';
import { useConversations, useFriends } from '../../lib/chat-api';
import {
  conversationName,
  displayMessages,
  mergeMessages,
  personName,
  sendErrorKind,
  showSenderName,
  type ChatMessage,
  type ChatPerson,
  type ConversationRow,
} from '../../lib/chat-model';
import { reportOutcome } from '../../lib/safety';
import { supabase } from '../../lib/supabase';
import { parseShareToken } from '../../lib/social';
import { useNotice } from '../../lib/use-notice';
import { HIT, radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { Avatar } from '../../ui/Avatar';
import { PressableScale } from '../../ui/motion';
import { Button, ChoiceCard, ErrorState, LoadingState, Text } from '../../ui/primitives';
import { useGoBack } from '../../ui/ScreenHeader';
import { Toast } from '../../ui/Toast';

const COLUMNS = 'id, conversation_id, sender_id, body, created_at';
const REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'other'] as const;
type Reason = (typeof REPORT_REASONS)[number];

function Bubble({
  m,
  mine,
  senderName,
  onLongPress,
  onRetry,
}: {
  m: ChatMessage;
  mine: boolean;
  senderName: string | null;
  onLongPress: () => void;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const sharedId = parseShareToken(m.body);
  const fg = mine ? colors.onPrimary : colors.text;
  const failed = m.pending === 'failed';
  return (
    <View
      style={{
        alignItems: mine ? 'flex-end' : 'flex-start',
        paddingHorizontal: space.lg,
        marginVertical: 2,
      }}
    >
      {senderName ? (
        <Text variant="caption" muted style={{ fontWeight: '700', marginLeft: space.sm }}>
          {senderName}
        </Text>
      ) : null}
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={
          sharedId
            ? `${t('chat.sharedCard')}. ${t('chat.sharedCardOpen')}`
            : failed
              ? `${m.body}. ${t('chat.failedRetry')}`
              : m.body
        }
        onPress={() => {
          if (failed) onRetry();
          else if (sharedId) router.push({ pathname: '/content/[id]', params: { id: sharedId } });
        }}
        onLongPress={mine || m.pending ? undefined : onLongPress}
        delayLongPress={350}
        style={{
          maxWidth: '80%',
          minHeight: 36,
          borderRadius: radius.xl,
          paddingHorizontal: space.lg,
          paddingVertical: space.sm,
          backgroundColor: mine ? colors.primary : colors.surfaceAlt,
          opacity: m.pending === 'sending' ? 0.6 : 1,
          borderWidth: failed ? 1 : 0,
          borderColor: colors.danger,
        }}
      >
        {sharedId ? (
          <View style={{ gap: 2 }}>
            <Text style={{ color: fg, fontWeight: '700' }}>📎 {t('chat.sharedCard')}</Text>
            <Text variant="caption" style={{ color: fg }}>
              {t('chat.sharedCardOpen')}
            </Text>
          </View>
        ) : (
          <Text style={{ color: fg }}>{m.body}</Text>
        )}
      </PressableScale>
      {failed ? (
        <Text variant="caption" style={{ color: colors.danger }}>
          {t('chat.failedRetry')}
        </Text>
      ) : m.pending === 'sending' ? (
        <Text variant="caption" muted>
          {t('chat.sending')}
        </Text>
      ) : null}
    </View>
  );
}

function ReportModal({
  message,
  onClose,
  onResult,
}: {
  message: ChatMessage | null;
  onClose: () => void;
  onResult: (m: string) => void;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const send = async (reason: Reason) => {
    const uid = session?.user.id;
    if (!uid || !message || busy) return;
    setBusy(true);
    const { error } = await supabase
      .from('message_reports')
      .insert({ message_id: message.id, reporter_id: uid, reason });
    setBusy(false);
    const o = reportOutcome(error);
    onResult(
      o === 'sent'
        ? t('chat.reportSent')
        : o === 'already'
          ? t('chat.reportAlready')
          : o === 'rate'
            ? t('chat.errRate')
            : t('chat.reportError'),
    );
    if (o !== 'failed') onClose();
  };
  return (
    <Modal visible={!!message} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <SafeAreaView
          edges={['bottom']}
          style={{
            backgroundColor: colors.bg,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            padding: space.lg,
            gap: space.sm,
          }}
        >
          <Text variant="heading" accessibilityRole="header">
            {t('chat.report')}
          </Text>
          <Text muted>{t('chat.reportWhy')}</Text>
          {REPORT_REASONS.map((r) => (
            <ChoiceCard
              key={r}
              role="button"
              label={t(`chat.reason.${r}`)}
              disabled={busy}
              onPress={() => void send(r)}
            />
          ))}
          <Button variant="ghost" label={t('chat.cancel')} onPress={onClose} disabled={busy} />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function AddPeopleModal({
  visible,
  conv,
  uid,
  onClose,
  onDone,
}: {
  visible: boolean;
  conv: ConversationRow;
  uid: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const friends = useFriends(uid);
  const [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const inGroup = new Set(conv.members.map((m) => m.id));
  const candidates = (friends.data ?? []).filter(
    (f) => !inGroup.has(f.id) && !added.includes(f.id),
  );
  const add = async (p: ChatPerson) => {
    if (busy) return;
    setBusy(p.id);
    const { error } = await supabase.rpc('add_group_member', { p_conv: conv.id, p_user: p.id });
    setBusy(null);
    if (error) return onDone(t('chat.addError'));
    setAdded((a) => [...a, p.id]);
    void qc.invalidateQueries({ queryKey: ['conversations'] });
  };
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ padding: space.lg, gap: space.sm, flex: 1 }}>
          <Text variant="heading" accessibilityRole="header">
            {t('chat.addPeople')}
          </Text>
          {friends.isLoading ? (
            <LoadingState />
          ) : (
            <FlatList
              data={candidates}
              keyExtractor={(p) => p.id}
              ListEmptyComponent={<Text muted>{t('chat.addPeopleEmpty')}</Text>}
              renderItem={({ item }) => (
                <View
                  style={{
                    minHeight: 60,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                  }}
                >
                  <Avatar path={item.avatarPath} name={personName(item)} size={40} />
                  <Text style={{ flex: 1, fontWeight: '700' }} numberOfLines={1}>
                    {personName(item)}
                  </Text>
                  <Button
                    variant="secondary"
                    label={t('chat.add')}
                    accessibilityLabel={`${t('chat.add')} ${personName(item)}`}
                    loading={busy === item.id}
                    onPress={() => void add(item)}
                  />
                </View>
              )}
            />
          )}
          <Button variant="ghost" label={t('common.close')} onPress={onClose} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

/** One conversation: bubbles, shared-post cards, composer. Polls every ~3s while focused. */
export default function Thread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const goBack = useGoBack();
  const qc = useQueryClient();
  const { session } = useAuth();
  const uid = session?.user.id;
  const focused = useIsFocused();
  const { notice, show } = useNotice();
  const [text, setText] = useState('');
  const [pending, setPending] = useState<ChatMessage[]>([]);
  const [reporting, setReporting] = useState<ChatMessage | null>(null);
  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const seq = useRef(0);

  const convs = useConversations(uid, 10000);
  const conv = convs.data?.find((c) => c.id === id);
  const group = conv?.kind === 'group';

  const messages = useQuery({
    queryKey: ['messages', id],
    enabled: !!id,
    refetchInterval: focused ? 3000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select(COLUMNS)
        .eq('conversation_id', id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return mergeMessages([], (data ?? []) as ChatMessage[]);
    },
  });

  const me = useQuery({
    queryKey: ['chat-member', id, uid],
    enabled: !!id && !!uid && group,
    queryFn: async () => {
      const { data } = await supabase
        .from('conversation_members')
        .select('member_role')
        .eq('conversation_id', id)
        .eq('user_id', uid!)
        .maybeSingle();
      return (data?.member_role as string | undefined) ?? 'member';
    },
  });

  // mark as read whenever a newer message from someone else is on screen
  const newest = messages.data?.[messages.data.length - 1]?.id;
  const marked = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!uid || !id || !newest || !focused || marked.current === newest) return;
    marked.current = newest;
    void supabase
      .from('conversation_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', id)
      .eq('user_id', uid)
      .then(() => qc.invalidateQueries({ queryKey: ['conversations'] }));
  }, [uid, id, newest, focused, qc]);

  const people = useMemo(() => new Map((conv?.members ?? []).map((m) => [m.id, m])), [conv]);
  const nameOf = useCallback(
    (sender: string) => {
      const p = people.get(sender);
      return p ? personName(p) : t('chat.unknownUser');
    },
    [people, t],
  );

  const errorText = (e: unknown) => {
    const k = sendErrorKind(e as { code?: string; message?: string });
    return k === 'rate'
      ? t('chat.errRate')
      : k === 'forbidden'
        ? t('chat.errForbidden')
        : k === 'offline'
          ? t('chat.errOffline')
          : t('chat.errOther');
  };

  const deliver = useCallback(
    async (tmp: ChatMessage) => {
      if (!uid || !id) return;
      const { data, error } = await supabase
        .from('messages')
        .insert({ conversation_id: id, sender_id: uid, body: tmp.body })
        .select(COLUMNS)
        .single();
      if (error || !data) {
        setPending((p) => p.map((x) => (x.id === tmp.id ? { ...x, pending: 'failed' } : x)));
        show(errorText(error));
        return;
      }
      qc.setQueryData<ChatMessage[]>(['messages', id], (cur) =>
        mergeMessages(cur ?? [], [data as ChatMessage]),
      );
      setPending((p) => p.filter((x) => x.id !== tmp.id));
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    [uid, id, qc, show, t],
  );

  const send = () => {
    const body = text.trim();
    if (!body || !uid || !id) return;
    setText('');
    const tmp: ChatMessage = {
      id: `tmp-${Date.now()}-${seq.current++}`,
      conversation_id: id,
      sender_id: uid,
      body,
      created_at: new Date().toISOString(),
      pending: 'sending',
    };
    setPending((p) => [...p, tmp]);
    void deliver(tmp);
  };
  const retry = (m: ChatMessage) => {
    const again = { ...m, pending: 'sending' as const };
    setPending((p) => p.map((x) => (x.id === m.id ? again : x)));
    void deliver(again);
  };

  const leave = () =>
    Alert.alert(t('chat.leaveTitle'), t('chat.leaveBody'), [
      { text: t('chat.cancel'), style: 'cancel' },
      {
        text: t('chat.leave'),
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase
            .from('conversation_members')
            .update({ left_at: new Date().toISOString() })
            .eq('conversation_id', id)
            .eq('user_id', uid!);
          if (error) return show(t('chat.leaveError'));
          void qc.invalidateQueries({ queryKey: ['conversations'] });
          goBack();
        },
      },
    ]);

  const data = displayMessages(messages.data ?? [], pending);
  const title = conv
    ? conversationName(conv, group ? t('chat.untitledGroup') : t('chat.unknownUser'))
    : '';
  const first = conv?.members[0];
  const subtitle = !conv
    ? ''
    : group
      ? t('chat.members', { count: conv.members.length + 1 })
      : first
        ? `@${first.username}`
        : '';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: space.sm,
          gap: space.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Button
          variant="ghost"
          label="‹"
          accessibilityLabel={t('common.back')}
          onPress={goBack}
          style={{ paddingHorizontal: space.md }}
        />
        {conv ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`${title}. ${subtitle}`}
            disabled={group || !first}
            onPress={() =>
              first && router.push({ pathname: '/user/[id]', params: { id: first.id } })
            }
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              minHeight: HIT,
            }}
          >
            {group ? (
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: colors.surfaceAlt,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text>👥</Text>
              </View>
            ) : (
              <Avatar path={first?.avatarPath} name={title} size={36} />
            )}
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} accessibilityRole="header" style={{ fontWeight: '800' }}>
                {title}
              </Text>
              {subtitle ? (
                <Text variant="caption" muted numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
          </PressableScale>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {group ? (
          <Button
            variant="ghost"
            label="⋯"
            accessibilityLabel={t('chat.groupOptions')}
            onPress={() => setMenu(true)}
            style={{ paddingHorizontal: space.md }}
          />
        ) : null}
      </View>

      {messages.isLoading ? (
        <LoadingState />
      ) : messages.isError && !messages.data ? (
        <ErrorState
          offline
          message={t('chat.threadLoadError')}
          onRetry={() => void messages.refetch()}
        />
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {messages.isError ? (
            <Text
              accessibilityRole="alert"
              variant="caption"
              style={{ color: colors.danger, textAlign: 'center', padding: space.xs }}
            >
              {t('chat.errOffline')}
            </Text>
          ) : null}
          <FlatList
            inverted
            data={data}
            keyExtractor={(m) => m.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingVertical: space.md }}
            ListEmptyComponent={
              <Text
                muted
                style={{ textAlign: 'center', padding: space.xl, transform: [{ scaleY: -1 }] }}
              >
                {t('chat.threadEmpty')}
              </Text>
            }
            renderItem={({ item, index }) => {
              const mine = item.sender_id === uid;
              // the list is newest-first, so the message "above" in time is the next index
              const above = data[index + 1];
              return (
                <Bubble
                  m={item}
                  mine={mine}
                  senderName={
                    showSenderName(!!group, mine, above?.sender_id, item.sender_id)
                      ? nameOf(item.sender_id)
                      : null
                  }
                  onLongPress={() => setReporting(item)}
                  onRetry={() => retry(item)}
                />
              );
            }}
          />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: space.sm,
              padding: space.sm,
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }}
          >
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={t('chat.messagePlaceholder')}
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={t('chat.messagePlaceholder')}
              multiline
              maxLength={4000}
              style={{
                flex: 1,
                minHeight: HIT,
                maxHeight: 120,
                borderRadius: radius.xl,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                color: colors.text,
                paddingHorizontal: space.lg,
                paddingVertical: space.sm,
                fontSize: 16,
              }}
            />
            <Button
              label={t('chat.send')}
              disabled={!text.trim()}
              onPress={send}
              style={{ paddingHorizontal: space.lg }}
            />
          </View>
        </KeyboardAvoidingView>
      )}

      <ReportModal message={reporting} onClose={() => setReporting(null)} onResult={show} />

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={() => setMenu(false)}
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}
        >
          <SafeAreaView
            edges={['bottom']}
            style={{
              backgroundColor: colors.bg,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              padding: space.lg,
              gap: space.sm,
            }}
          >
            {me.data === 'admin' ? (
              <Button
                variant="secondary"
                label={t('chat.addPeople')}
                onPress={() => {
                  setMenu(false);
                  setAdding(true);
                }}
              />
            ) : null}
            <Button
              variant="secondary"
              label={t('chat.leaveGroup')}
              onPress={() => {
                setMenu(false);
                leave();
              }}
            />
            <Button variant="ghost" label={t('chat.cancel')} onPress={() => setMenu(false)} />
          </SafeAreaView>
        </PressableScale>
      </Modal>

      {conv && uid ? (
        <AddPeopleModal
          visible={adding}
          conv={conv}
          uid={uid}
          onClose={() => setAdding(false)}
          onDone={show}
        />
      ) : null}
      <Toast message={notice} />
    </SafeAreaView>
  );
}
