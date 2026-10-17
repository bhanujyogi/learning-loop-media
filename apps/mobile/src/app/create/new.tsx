import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TopicField } from '../../features/create/TopicField';
import { useI18n } from '../../i18n/I18nProvider';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
  buildSubmission,
  emptyForm,
  MAX_IMAGES,
  MAX_OPTIONS,
  type CreatorForm,
  type CreatorKind,
  type Difficulty,
  type FormError,
  type QuestionType,
} from '../../lib/creator-form';
import { imageProblem, pickImages, uploadPostImage } from '../../lib/upload';
import { pickVideo, uploadVideo } from '../../lib/video-upload';
import { radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { LanguageSwitch } from '../../ui/LanguageSwitch';
import { Animated, enter } from '../../ui/motion';
import { Button, ChoiceCard, Chip, Field, ProgressBar, Text } from '../../ui/primitives';
import { ScreenHeader, useGoBack } from '../../ui/ScreenHeader';

const KINDS: CreatorKind[] = ['note', 'flashcard', 'question', 'image', 'video'];

/** Only the kinds that existed before this screen was reworked have `create.*` copy; the others live in the feed catalogue. */
const kindLabel = (k: CreatorKind) =>
  k === 'image' ? 'feed.create.kind.image' : (`create.kind.${k}` as const);
const kindDesc = (k: CreatorKind) =>
  k === 'image' ? 'feed.create.kind.image.desc' : (`create.kind.${k}.desc` as const);
/** Errors the form reports that have no `create.err.*` text. */
const errKey = (e: FormError) =>
  e === 'images' || e === 'imageType' || e === 'imageSize'
    ? (`feed.err.${e}` as const)
    : (`create.err.${e}` as const);

/** Where a failed post stopped, so the message can say what to do. */
type Stage = { kind: 'upload'; n: number; total: number } | { kind: 'save' };
const QTYPES: QuestionType[] = ['single_choice', 'true_false', 'fill_blank', 'numerical'];
const LEVELS: Difficulty[] = ['easy', 'medium', 'hard'];

/** Composer for notes, flashcards, questions, picture posts and videos. The server validates again; this screen only helps. Posts go live at once. */
export default function NewPost() {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const goBack = useGoBack();
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useAuth();
  const [f, setF] = useState<CreatorForm>(() => emptyForm(locale));
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState<{ text: string; value: number } | null>(null);
  const [imageNote, setImageNote] = useState<string | null>(null);
  const submitting = useRef(false);
  const set = (p: Partial<CreatorForm>) => setF((cur) => ({ ...cur, ...p }));

  const built = buildSubmission(f);
  const missing: FormError[] = showErrors && !built.ok ? built.errors : [];
  const msg = (e: FormError) => (missing.includes(e) ? t(errKey(e)) : null);

  const post = async () => {
    if (submitting.current) return; // no double posts
    if (!built.ok) {
      setShowErrors(true);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    let stage: Stage = { kind: 'save' };
    try {
      let payload = built.payload;
      if (f.kind === 'video' && f.video && session) {
        stage = { kind: 'upload', n: 1, total: 1 };
        setProgress({ text: t('feed.create.uploading', { n: 1, total: 1 }), value: 0.1 });
        const up = await uploadVideo(f.video, session.user.id);
        payload = { ...payload, body: { mediaId: up.mediaId, durationMs: up.durationMs } };
      }
      if (f.kind === 'image' && session) {
        const mediaIds: string[] = [];
        for (const [i, img] of f.images.entries()) {
          stage = { kind: 'upload', n: i + 1, total: f.images.length };
          setProgress({
            text: t('feed.create.uploading', { n: i + 1, total: f.images.length }),
            value: i / f.images.length,
          });
          mediaIds.push(await uploadPostImage(img, session.user.id));
        }
        payload = { ...payload, body: { ...(payload.body as object), mediaIds } };
      }
      stage = { kind: 'save' };
      setProgress({ text: t('feed.create.publishing'), value: 1 });
      await api.createContent(payload);
      void qc.invalidateQueries({ queryKey: ['my-posts', session?.user.id] });
      setDone(true);
    } catch (e) {
      setError(t(postErrorKey(e, stage), stage.kind === 'upload' ? stage : undefined));
    } finally {
      submitting.current = false;
      setBusy(false);
      setProgress(null);
    }
  };

  const addImages = async () => {
    const picked = await pickImages(true);
    if (!picked.length) return;
    const room = MAX_IMAGES - f.images.length;
    const fresh = picked.filter((p) => !f.images.some((x) => x.uri === p.uri));
    const usable = fresh.filter((p) => !imageProblem(p));
    const badType = fresh.some((p) => imageProblem(p) === 'type');
    const badSize = fresh.some((p) => imageProblem(p) === 'size');
    set({ images: [...f.images, ...usable.slice(0, room)] });
    setImageNote(
      badType
        ? t('feed.err.imageType')
        : badSize
          ? t('feed.err.imageSize')
          : usable.length > room
            ? t('feed.create.image.max')
            : null,
    );
  };

  if (done)
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          padding: space.xl,
          justifyContent: 'center',
          gap: space.lg,
        }}
      >
        <Animated.View
          entering={enter()}
          style={{ gap: space.lg }}
          accessibilityLiveRegion="polite"
        >
          <Text style={{ fontSize: 56, textAlign: 'center' }}>🎉</Text>
          <Text variant="heading" style={{ textAlign: 'center' }}>
            {t('create.done.live')}
          </Text>
          <Button
            label={t('create.new')}
            onPress={() => {
              setF(emptyForm(locale));
              setShowErrors(false);
              setDone(false);
              setImageNote(null);
            }}
          />
          <Button variant="secondary" label={t('common.back')} onPress={goBack} />
        </Animated.View>
      </SafeAreaView>
    );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={t('create.new')} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: space.lg, gap: space.lg }}
        >
          <Text variant="label">{t('create.field.kind')}</Text>
          <View style={{ gap: space.sm }}>
            {KINDS.map((k) => (
              <ChoiceCard
                key={k}
                label={t(kindLabel(k))}
                description={t(kindDesc(k))}
                state={f.kind === k ? 'selected' : 'idle'}
                onPress={() => set({ kind: k })}
              />
            ))}
          </View>

          <Field
            label={t('create.field.title')}
            value={f.title}
            onChangeText={(title) => set({ title })}
            maxLength={200}
            error={msg('title')}
          />

          <View style={{ gap: space.sm }}>
            <Text variant="label">{t('create.field.language')}</Text>
            <LanguageSwitch value={f.language} onChange={(language) => set({ language })} />
          </View>

          <TopicField
            topic={f.topic}
            conceptId={f.conceptId}
            onChange={(v) => set({ topic: v.topic, conceptId: v.conceptId })}
            error={msg('topic')}
          />

          <View style={{ gap: space.sm }}>
            <Text variant="label">{t('create.field.difficulty')}</Text>
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              {LEVELS.map((d) => (
                <Chip
                  key={d}
                  label={t(`feed.difficulty.${d}`)}
                  selected={f.difficulty === d}
                  onPress={() => set({ difficulty: d })}
                />
              ))}
            </View>
          </View>

          {f.kind === 'note' ? (
            <View style={{ gap: space.xs }}>
              <Field
                label={t('create.field.noteText')}
                value={f.noteText}
                onChangeText={(noteText) => set({ noteText })}
                multiline
                textAlignVertical="top"
                style={{ minHeight: 160 }}
                error={msg('noteText')}
              />
              <Text variant="caption" muted>
                {t('create.field.noteHelp')}
              </Text>
            </View>
          ) : null}

          {f.kind === 'image' ? (
            <View style={{ gap: space.sm }}>
              <Button
                variant="secondary"
                label={f.images.length ? t('feed.create.image.add') : t('feed.create.image.pick')}
                onPress={() => void addImages()}
                disabled={f.images.length >= MAX_IMAGES}
              />
              {f.images.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  {f.images.map((img, i) => (
                    <View key={img.uri} style={{ width: 96 }}>
                      <Image
                        source={{ uri: img.uri }}
                        accessibilityLabel={t('feed.create.image.alt', {
                          n: i + 1,
                          total: f.images.length,
                        })}
                        style={{
                          width: 96,
                          height: 96,
                          borderRadius: radius.md,
                          backgroundColor: colors.surfaceAlt,
                        }}
                      />
                      <Button
                        variant="ghost"
                        label={t('feed.create.image.remove')}
                        accessibilityLabel={t('feed.create.image.removeN', { n: i + 1 })}
                        onPress={() => set({ images: f.images.filter((_, j) => j !== i) })}
                      />
                    </View>
                  ))}
                </View>
              ) : null}
              <Text variant="caption" muted>
                {t('feed.create.image.help')}
              </Text>
              {imageNote ? (
                <Text accessibilityRole="alert" variant="caption" style={{ color: colors.danger }}>
                  {imageNote}
                </Text>
              ) : null}
              {msg('images') || msg('imageType') || msg('imageSize') ? (
                <Text accessibilityRole="alert" variant="caption" style={{ color: colors.danger }}>
                  {msg('images') ?? msg('imageType') ?? msg('imageSize')}
                </Text>
              ) : null}
              <Field
                label={t('feed.create.image.caption')}
                value={f.caption}
                onChangeText={(caption) => set({ caption })}
                maxLength={2000}
                multiline
                textAlignVertical="top"
                style={{ minHeight: 80 }}
              />
            </View>
          ) : null}

          {f.kind === 'video' ? (
            <View style={{ gap: space.sm }}>
              <Button
                variant="secondary"
                label={f.video ? t('create.video.change') : t('create.video.pick')}
                onPress={() => void pickVideo().then((video) => video && set({ video }))}
              />
              {f.video ? (
                <Text variant="caption" muted>
                  {f.video.name} · {(f.video.size / 1048576).toFixed(1)} MB
                </Text>
              ) : null}
              <Text variant="caption" muted>
                {t('create.video.help')}
              </Text>
              {msg('video') || msg('videoType') || msg('videoSize') ? (
                <Text accessibilityRole="alert" variant="caption" style={{ color: colors.danger }}>
                  {msg('video') ?? msg('videoType') ?? msg('videoSize')}
                </Text>
              ) : null}
            </View>
          ) : null}

          {f.kind === 'flashcard' ? (
            <>
              <Field
                label={t('create.field.front')}
                value={f.front}
                onChangeText={(front) => set({ front })}
                multiline
                textAlignVertical="top"
                style={{ minHeight: 80 }}
                error={msg('front')}
              />
              <Field
                label={t('create.field.back')}
                value={f.back}
                onChangeText={(back) => set({ back })}
                multiline
                textAlignVertical="top"
                style={{ minHeight: 80 }}
                error={msg('back')}
              />
            </>
          ) : null}

          {f.kind === 'question' ? (
            <>
              <View style={{ gap: space.sm }}>
                <Text variant="label">{t('create.q.type')}</Text>
                <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
                  {QTYPES.map((q) => (
                    <Chip
                      key={q}
                      label={t(`create.q.type.${q}`)}
                      selected={f.qType === q}
                      onPress={() => set({ qType: q })}
                    />
                  ))}
                </View>
              </View>
              <Field
                label={t('create.field.prompt')}
                value={f.prompt}
                onChangeText={(prompt) => set({ prompt })}
                multiline
                textAlignVertical="top"
                style={{ minHeight: 80 }}
                error={msg('prompt')}
              />

              {f.qType === 'single_choice' ? (
                <View style={{ gap: space.md }}>
                  {f.options.map((o, i) => (
                    <View key={i} style={{ gap: space.xs }}>
                      <Field
                        label={t('create.field.option', { n: i + 1 })}
                        value={o}
                        onChangeText={(text) =>
                          set({ options: f.options.map((x, j) => (j === i ? text : x)) })
                        }
                      />
                      <ChoiceCard
                        role="radio"
                        label={t('create.field.markCorrect')}
                        state={f.correct === i ? 'selected' : 'idle'}
                        onPress={() => set({ correct: i })}
                      />
                    </View>
                  ))}
                  {f.options.length < MAX_OPTIONS ? (
                    <Button
                      variant="secondary"
                      label={t('create.field.addOption')}
                      onPress={() => set({ options: [...f.options, ''] })}
                    />
                  ) : null}
                  {msg('options') ? (
                    <Text
                      accessibilityRole="alert"
                      variant="caption"
                      style={{ color: colors.danger }}
                    >
                      {msg('options')}
                    </Text>
                  ) : null}
                  {msg('correct') ? (
                    <Text
                      accessibilityRole="alert"
                      variant="caption"
                      style={{ color: colors.danger }}
                    >
                      {msg('correct')}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {f.qType === 'true_false' ? (
                <View style={{ gap: space.sm }}>
                  <ChoiceCard
                    label={t('q.true')}
                    state={f.tf === true ? 'selected' : 'idle'}
                    onPress={() => set({ tf: true })}
                  />
                  <ChoiceCard
                    label={t('q.false')}
                    state={f.tf === false ? 'selected' : 'idle'}
                    onPress={() => set({ tf: false })}
                  />
                  {msg('tf') ? (
                    <Text
                      accessibilityRole="alert"
                      variant="caption"
                      style={{ color: colors.danger }}
                    >
                      {msg('tf')}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {f.qType === 'fill_blank' ? (
                <Field
                  label={t('create.field.accepted')}
                  value={f.accepted}
                  onChangeText={(accepted) => set({ accepted })}
                  error={msg('accepted')}
                />
              ) : null}

              {f.qType === 'numerical' ? (
                <>
                  <Field
                    label={t('create.field.numValue')}
                    value={f.numValue}
                    onChangeText={(numValue) => set({ numValue })}
                    keyboardType="numeric"
                    error={msg('num')}
                  />
                  <Field
                    label={t('create.field.tolerance')}
                    value={f.tolerance}
                    onChangeText={(tolerance) => set({ tolerance })}
                    keyboardType="numeric"
                  />
                </>
              ) : null}

              <Field
                label={t('create.field.explanation')}
                value={f.explanation}
                onChangeText={(explanation) => set({ explanation })}
                multiline
                textAlignVertical="top"
                style={{ minHeight: 80 }}
                error={msg('explanation')}
              />
            </>
          ) : null}

          <View style={{ gap: space.sm }}>
            <ChoiceCard
              role="checkbox"
              label={t('create.confirm')}
              state={f.confirmed ? 'selected' : 'idle'}
              onPress={() => set({ confirmed: !f.confirmed })}
            />
            {msg('confirm') ? (
              <Text accessibilityRole="alert" variant="caption" style={{ color: colors.danger }}>
                {msg('confirm')}
              </Text>
            ) : null}
            <Button
              variant="ghost"
              label={t('create.guidelines')}
              onPress={() =>
                router.push({ pathname: '/legal/[doc]', params: { doc: 'guidelines' } })
              }
            />
          </View>

          {error ? (
            <Text
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              style={{ color: colors.danger }}
            >
              {error}
            </Text>
          ) : null}
          {progress ? (
            <View style={{ gap: space.xs }} accessibilityLiveRegion="polite">
              <Text variant="caption" muted>
                {progress.text}
              </Text>
              <ProgressBar value={progress.value} label={progress.text} />
            </View>
          ) : null}
          <Button
            label={busy ? t('create.submitting') : t('create.submit')}
            onPress={() => void post()}
            loading={busy}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Picks the most specific message the failure allows (HTTP status for the server, status/code for storage uploads). */
function postErrorKey(e: unknown, stage: Stage) {
  if (e instanceof ApiError) {
    if (e.isOffline) return 'create.postErr.offline' as const;
    if (e.status === 401) return 'feed.err.signedOut' as const;
    if (e.status === 429 || e.code === 'rate_limited') return 'create.postErr.rate' as const;
    if (e.status === 403) return 'create.postErr.forbidden' as const;
    if (e.status === 400) return 'create.postErr.invalid' as const;
    return 'create.postErr.generic' as const;
  }
  if (stage.kind === 'upload') {
    const x = e as { status?: number | string; statusCode?: number | string; message?: string };
    const code = Number(x?.statusCode ?? x?.status);
    if (code === 413) return 'feed.err.uploadBig' as const;
    if (code === 401 || code === 403) return 'feed.err.uploadDenied' as const;
    if (code === 429) return 'create.postErr.rate' as const;
    return stage.total > 1 ? ('feed.err.uploadN' as const) : ('feed.err.upload' as const);
  }
  return 'create.postErr.generic' as const;
}
