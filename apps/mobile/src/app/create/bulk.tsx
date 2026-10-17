import { useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../i18n/I18nProvider';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
  MAX_BULK_BYTES,
  MAX_BULK_ITEMS,
  parseBulkFile,
  runBulkImport,
  type BulkFatal,
  type ImportProgress,
  type ImportSummary,
  type ParsedBulk,
  type StopReason,
} from '../../lib/bulk-import';
import { space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { Button, Card, ChoiceCard, Field, ProgressBar, Text } from '../../ui/primitives';
import { ScreenHeader } from '../../ui/ScreenHeader';

const FATAL_KEY = {
  empty: 'feed.bulk.err.empty',
  too_big: 'feed.bulk.err.tooBig',
  not_json: 'feed.bulk.err.notJson',
  no_items: 'feed.bulk.err.noItems',
  too_many: 'feed.bulk.err.tooMany',
  bad_version: 'feed.bulk.err.badVersion',
} as const satisfies Record<BulkFatal, string>;
const STOP_KEY = {
  rate_limited: 'feed.bulk.stop.rate',
  cancelled: 'feed.bulk.stop.cancelled',
  offline: 'feed.bulk.stop.offline',
  rejected: 'feed.bulk.stop.rejected',
  server: 'feed.bulk.stop.server',
} as const satisfies Record<StopReason, string>;
const SHOWN_PROBLEMS = 5;

/** Owner tool: load a JSON file of many questions / flashcards / notes (made by an AI chat from the template) and post them in batches. */
export default function BulkImport() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const { session } = useAuth();
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedBulk | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [startFrom, setStartFrom] = useState('1');
  const [reading, setReading] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const cancelled = useRef(false);
  const busy = useRef(false);

  useEffect(
    () => () => {
      cancelled.current = true; // leaving the screen stops sending further chunks
    },
    [],
  );

  const pick = async () => {
    if (running || reading) return;
    setReading(true);
    setReadFailed(false);
    setSummary(null);
    setProgress(null);
    try {
      const r = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      const a = r.canceled ? undefined : r.assets[0];
      if (!a) return;
      setFileName(a.name);
      if ((a.size ?? 0) > MAX_BULK_BYTES) {
        setParsed({ items: [], errors: [], total: 0, fatal: 'too_big' });
        return;
      }
      const text = await new File(a.uri).text();
      setParsed(parseBulkFile(text));
      setStartFrom('1');
    } catch {
      setParsed(null);
      setReadFailed(true);
    } finally {
      setReading(false);
    }
  };

  const from = Math.max(1, Math.floor(Number(startFrom)) || 1);
  const toSend = parsed ? parsed.items.filter((i) => i.index + 1 >= from) : [];
  const canStart = !!parsed && !parsed.fatal && toSend.length > 0 && confirmed && !running;

  const start = async () => {
    if (!canStart || busy.current) return;
    busy.current = true;
    cancelled.current = false;
    setRunning(true);
    setSummary(null);
    try {
      const s = await runBulkImport(toSend, (payloads) => api.createContentBulk(payloads), {
        isCancelled: () => cancelled.current,
        onProgress: setProgress,
      });
      setSummary(s);
      void qc.invalidateQueries({ queryKey: ['my-posts', session?.user.id] });
    } finally {
      busy.current = false;
      setRunning(false);
    }
  };

  const problems = parsed?.errors ?? [];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={t('feed.bulk.title')} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: space.lg, gap: space.lg }}
        >
          <Text muted>{t('feed.bulk.intro')}</Text>
          <Text variant="caption" muted>
            {t('feed.bulk.limits', {
              items: MAX_BULK_ITEMS,
              mb: Math.round(MAX_BULK_BYTES / 1048576),
            })}
          </Text>

          <Button
            variant="secondary"
            label={fileName ? t('feed.bulk.change') : t('feed.bulk.pick')}
            onPress={() => void pick()}
            loading={reading}
            disabled={running}
          />
          {fileName ? (
            <Text variant="caption" muted>
              {fileName}
            </Text>
          ) : null}
          {readFailed ? (
            <Text accessibilityRole="alert" style={{ color: colors.danger }}>
              {t('feed.bulk.err.read')}
            </Text>
          ) : null}

          {parsed?.fatal ? (
            <Text
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={{ color: colors.danger }}
            >
              {t(FATAL_KEY[parsed.fatal], { max: MAX_BULK_ITEMS, mb: MAX_BULK_BYTES / 1048576 })}
            </Text>
          ) : null}

          {parsed && !parsed.fatal ? (
            <Card style={{ gap: space.sm }} accessibilityLiveRegion="polite">
              <Text variant="heading">
                {t('feed.bulk.summary', { valid: parsed.items.length, bad: problems.length })}
              </Text>
              {problems.length ? (
                <>
                  <Text variant="label">{t('feed.bulk.problems')}</Text>
                  {problems.slice(0, SHOWN_PROBLEMS).map((p) => (
                    <Text key={p.index} variant="caption" style={{ color: colors.danger }}>
                      {t('feed.bulk.problemLine', { n: p.index + 1, message: p.message })}
                    </Text>
                  ))}
                  {problems.length > SHOWN_PROBLEMS ? (
                    <Text variant="caption" muted>
                      {t('feed.bulk.moreProblems', { count: problems.length - SHOWN_PROBLEMS })}
                    </Text>
                  ) : null}
                  <Text variant="caption" muted>
                    {t('feed.bulk.skipNote')}
                  </Text>
                </>
              ) : null}
            </Card>
          ) : null}

          {parsed && !parsed.fatal && parsed.items.length ? (
            <>
              <Field
                label={t('feed.bulk.startFrom')}
                value={startFrom}
                onChangeText={setStartFrom}
                keyboardType="number-pad"
                editable={!running}
              />
              <ChoiceCard
                role="checkbox"
                label={t('create.confirm')}
                state={confirmed ? 'selected' : 'idle'}
                onPress={() => setConfirmed((c) => !c)}
              />
              <Button
                label={t('feed.bulk.start', { count: toSend.length })}
                onPress={() => void start()}
                disabled={!canStart}
                loading={running}
              />
            </>
          ) : null}

          {running || progress ? (
            <View style={{ gap: space.xs }} accessibilityLiveRegion="polite">
              {progress ? (
                <>
                  <Text variant="label">
                    {t('feed.bulk.progress', { done: progress.done, total: progress.total })}
                  </Text>
                  <ProgressBar
                    value={progress.total ? progress.done / progress.total : 0}
                    label={t('feed.bulk.progress', { done: progress.done, total: progress.total })}
                  />
                </>
              ) : null}
              {running ? (
                <Button
                  variant="secondary"
                  label={t('feed.bulk.cancel')}
                  onPress={() => {
                    cancelled.current = true;
                  }}
                />
              ) : null}
            </View>
          ) : null}

          {summary ? (
            <Card style={{ gap: space.sm }} accessibilityLiveRegion="polite">
              <Text variant="heading">
                {t('feed.bulk.result', {
                  imported: summary.imported,
                  failed: summary.failed.length,
                })}
              </Text>
              {summary.stopped ? (
                <Text accessibilityRole="alert" style={{ color: colors.danger }}>
                  {t(STOP_KEY[summary.stopped], { n: summary.resumeAt ?? 1 })}
                </Text>
              ) : null}
              {summary.stopped ? (
                <Text variant="caption" muted>
                  {t('feed.bulk.notSent', { count: summary.notSent })}
                </Text>
              ) : null}
              {summary.failed.slice(0, SHOWN_PROBLEMS).map((p) => (
                <Text key={p.index} variant="caption" style={{ color: colors.danger }}>
                  {t('feed.bulk.problemLine', { n: p.index + 1, message: p.message })}
                </Text>
              ))}
              {summary.failed.length > SHOWN_PROBLEMS ? (
                <Text variant="caption" muted>
                  {t('feed.bulk.moreProblems', { count: summary.failed.length - SHOWN_PROBLEMS })}
                </Text>
              ) : null}
            </Card>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
