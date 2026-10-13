import { useRef, useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../i18n/I18nProvider';
import { useAuth } from '../lib/auth';
import { REPORT_REASONS, reportOutcome, type ReportReason } from '../lib/safety';
import { supabase } from '../lib/supabase';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Button, ChoiceCard, Text } from './primitives';

/**
 * "Report" for content or a user. Writes through the existing RLS-protected `reports` table (own reports only; a trigger
 * weights reporters server-side and rate-limits). Required by app-store rules for apps with user-generated content.
 */
export function ReportSheet({
  visible,
  kind,
  targetId,
  onClose,
  onResult,
}: {
  visible: boolean;
  kind: 'content' | 'user';
  targetId: string;
  onClose: () => void;
  /** a localized message to show as a toast after closing */
  onResult: (message: string) => void;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { session } = useAuth();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  const send = async () => {
    const uid = session?.user.id;
    if (!uid || !reason || sending.current) return;
    sending.current = true;
    setBusy(true);
    const { error } = await supabase
      .from('reports')
      .insert({ reporter_id: uid, target_kind: kind, target_id: targetId, reason });
    sending.current = false;
    setBusy(false);
    const o = reportOutcome(error);
    onResult(
      o === 'sent'
        ? t('report.sent')
        : o === 'already'
          ? t('report.already')
          : o === 'rate'
            ? t('report.rate')
            : t('report.error'),
    );
    if (o !== 'failed') {
      setReason(null);
      onClose();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md }}>
          <Text variant="display" accessibilityRole="header">
            {kind === 'content' ? t('report.title') : t('report.action')}
          </Text>
          <Text muted>{t('report.why')}</Text>
          <View style={{ gap: space.sm }}>
            {REPORT_REASONS.map((r) => (
              <ChoiceCard
                key={r}
                label={t(`report.reason.${r}`)}
                state={reason === r ? 'selected' : 'idle'}
                onPress={() => setReason(r)}
                disabled={busy}
              />
            ))}
          </View>
          <View style={{ gap: space.sm, paddingTop: space.md, borderRadius: radius.lg }}>
            <Button
              label={t('report.send')}
              onPress={() => void send()}
              loading={busy}
              disabled={!reason}
            />
            <Button variant="ghost" label={t('common.close')} onPress={onClose} disabled={busy} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
