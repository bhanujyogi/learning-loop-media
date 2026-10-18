import { useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../i18n/I18nProvider';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
  MAX_BULK_BYTES,
  MAX_BULK_ITEMS,
  parseBulkFile,
  runMixedImport,
  type ImportEntry,
  type BulkFatal,
  type ImportProgress,
  type ImportSummary,
  type ParsedBulk,
  type StopReason,
} from '../../lib/bulk-import';
import {
  buildMediaPlan,
  MAX_IMAGE_BYTES,
  MAX_MEDIA_FILES,
  MAX_MEDIA_MANIFEST_ITEMS,
  MAX_VIDEO_BYTES,
  uploadStats,
  type PickedMedia,
} from '../../lib/bulk-media';
import { uploadPostImage } from '../../lib/upload';
import { uploadVideo } from '../../lib/video-upload';
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
  too_many_media_items: 'bulk.err.tooManyItems',
  too_many_files: 'bulk.err.tooManyFiles',
} as const satisfies Record<BulkFatal, string>;
const STOP_KEY = {
  rate_limited: 'feed.bulk.stop.rate',
  cancelled: 'feed.bulk.stop.cancelled',
  offline: 'feed.bulk.stop.offline',
  rejected: 'feed.bulk.stop.rejected',
  server: 'feed.bulk.stop.server',
} as const satisfies Record<StopReason, string>;
const SHOWN_PROBLEMS = 5;
const SHOWN_NAMES = 10;

/** Storage errors have `status`; Postgres errors only a `code` (a refusal, not a network problem). */
const withStatus = (e: unknown): unknown => {
  const o = e as { status?: unknown; code?: unknown; message?: unknown } | null;
  return typeof o?.status !== 'number' && typeof o?.code === 'string'
    ? Object.assign(new Error(String(o.message ?? o.code)), { status: 400 })
    : e;
};

function NameList({ title, names, danger }: { title: string; names: string[]; danger?: boolean }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  if (!names.length) return null;
  return (
    <>
      <Text variant="label">{title}</Text>
      {names.slice(0, SHOWN_NAMES).map((n, i) => (
        <Text
          key={`${n}-${i}`}
          variant="caption"
          style={danger ? { color: colors.danger } : undefined}
          muted={!danger}
        >
          {n}
        </Text>
      ))}
      {names.length > SHOWN_NAMES ? (
        <Text variant="caption" muted>
          {t('bulk.plan.more', { count: names.length - SHOWN_NAMES })}
        </Text>
      ) : null}
    </>
  );
}

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
  const [mediaFiles, setMediaFiles] = useState<PickedMedia[]>([]);
  const [pickingMedia, setPickingMedia] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
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
    setMediaFiles([]);
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
        setParsed({ items: [], media: [], errors: [], total: 0, fatal: 'too_big' });
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

  const pickMedia = async () => {
    if (running || pickingMedia) return;
    setPickingMedia(true);
    setMediaFailed(false);
    try {
      const r = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'video/*'],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (r.canceled) return;
      setMediaFiles(
        r.assets.map((a) => ({
          uri: a.uri,
          name: a.name,
          size: a.size ?? 0,
          mimeType: a.mimeType ?? '',
        })),
      );
    } catch {
      setMediaFailed(true);
    } finally {
      setPickingMedia(false);
    }
  };

  const plan = useMemo(
    () => buildMediaPlan(parsed?.media ?? [], mediaFiles),
    [parsed?.media, mediaFiles],
  );
  const from = Math.max(1, Math.floor(Number(startFrom)) || 1);
  const toSend: ImportEntry[] = parsed
    ? [...parsed.items, ...plan.ready]
        .filter((i) => i.index + 1 >= from)
        .sort((a, b) => a.index - b.index)
    : [];
  const stats = uploadStats(plan.ready.filter((i) => i.index + 1 >= from));
  const canStart = !!parsed && !parsed.fatal && toSend.length > 0 && confirmed && !running;
  const hasMedia = !!parsed && !parsed.fatal && parsed.media.length > 0;

  const start = async () => {
    if (!canStart || busy.current) return;
    busy.current = true;
    cancelled.current = false;
    setRunning(true);
    setSummary(null);
    try {
      const userId = session?.user.id;
      const s = await runMixedImport(
        toSend,
        (payloads) => api.createContentBulk(payloads),
        async (file, kind, knownDurationMs) => {
          if (!userId) throw Object.assign(new Error('signed_out'), { status: 401 });
          try {
            if (kind === 'image') return { mediaId: await uploadPostImage(file, userId) };
            const up = await uploadVideo(file, userId, knownDurationMs);
            return { mediaId: up.mediaId, durationMs: up.durationMs };
          } catch (e) {
            throw withStatus(e);
          }
        },
        { isCancelled: () => cancelled.current, onProgress: setProgress },
      );
      setSummary(s);
      void qc.invalidateQueries({ queryKey: ['my-posts', session?.user.id] });
    } finally {
      busy.current = false;
      setRunning(false);
    }
  };

  const problems = [
    ...(parsed?.errors ?? []),
    ...plan.skipped.map((p) => ({ index: p.index, message: p.message })),
  ].sort((a, b) => a.index - b.index);
  const readyCount = (parsed?.items.length ?? 0) + plan.ready.length;
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

          {hasMedia ? (
            <Text variant="caption" muted>
              {t('bulk.limits.media', {
                imageMb: MAX_IMAGE_BYTES / 1048576,
                videoMb: MAX_VIDEO_BYTES / 1048576,
                items: MAX_MEDIA_MANIFEST_ITEMS,
                files: MAX_MEDIA_FILES,
              })}
            </Text>
          ) : null}

          {parsed?.fatal ? (
            <Text
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={{ color: colors.danger }}
            >
              {t(FATAL_KEY[parsed.fatal], {
                max:
                  parsed.fatal === 'too_many_media_items'
                    ? MAX_MEDIA_MANIFEST_ITEMS
                    : parsed.fatal === 'too_many_files'
                      ? MAX_MEDIA_FILES
                      : MAX_BULK_ITEMS,
                mb: MAX_BULK_BYTES / 1048576,
              })}
            </Text>
          ) : null}

          {hasMedia ? (
            <Card style={{ gap: space.sm }}>
              <Text variant="heading">{t('bulk.media.title')}</Text>
              <Text muted>
                {t('bulk.media.help', {
                  files: parsed.media.reduce((n, m) => n + m.refs.length, 0),
                })}
              </Text>
              <Button
                variant="secondary"
                label={mediaFiles.length ? t('bulk.media.change') : t('bulk.media.pick')}
                onPress={() => void pickMedia()}
                loading={pickingMedia}
                disabled={running}
              />
              <Text variant="caption" muted accessibilityLiveRegion="polite">
                {mediaFiles.length
                  ? t('bulk.media.count', { count: mediaFiles.length })
                  : t('bulk.media.none')}
              </Text>
              {mediaFailed ? (
                <Text accessibilityRole="alert" style={{ color: colors.danger }}>
                  {t('bulk.media.pickFailed')}
                </Text>
              ) : null}
            </Card>
          ) : null}

          {parsed && !parsed.fatal ? (
            <Card style={{ gap: space.sm }} accessibilityLiveRegion="polite">
              <Text variant="heading">
                {t('feed.bulk.summary', { valid: readyCount, bad: problems.length })}
              </Text>
              {hasMedia && plan.ready.length ? (
                <Text variant="caption" muted>
                  {t('bulk.plan.ready', {
                    items: plan.ready.length,
                    files: stats.files,
                    mb: Math.round((stats.bytes / 1048576) * 10) / 10,
                  })}
                </Text>
              ) : null}
              {hasMedia ? (
                <>
                  <NameList
                    title={t('bulk.plan.missing', { count: plan.missing.length })}
                    names={plan.missing}
                    danger
                  />
                  <NameList
                    title={t('bulk.plan.bad', { count: plan.badFiles.length })}
                    names={plan.badFiles.map((b) =>
                      t(b.reason === 'type' ? 'bulk.plan.badType' : 'bulk.plan.badSize', {
                        name: b.name,
                      }),
                    )}
                    danger
                  />
                  <NameList
                    title={t('bulk.plan.unused', { count: plan.unused.length })}
                    names={plan.unused}
                  />
                  <NameList
                    title={t('bulk.plan.dupes', { count: plan.duplicates.length })}
                    names={plan.duplicates}
                  />
                </>
              ) : null}
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
                    {t(hasMedia ? 'bulk.plan.skipNote' : 'feed.bulk.skipNote')}
                  </Text>
                </>
              ) : null}
            </Card>
          ) : null}

          {parsed && !parsed.fatal && readyCount ? (
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
              {stats.files ? (
                <Text variant="caption" muted>
                  {t('bulk.plan.keepOpen')}
                </Text>
              ) : null}
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
                    {progress.files
                      ? t('bulk.progress.media', {
                          file: Math.min(progress.files.done + 1, progress.files.total),
                          files: progress.files.total,
                          n: Math.min(progress.done + 1, progress.total),
                          total: progress.total,
                        })
                      : t('feed.bulk.progress', { done: progress.done, total: progress.total })}
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
