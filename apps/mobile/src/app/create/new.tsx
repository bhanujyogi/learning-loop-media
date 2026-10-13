import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConceptPicker } from '../../features/create/ConceptPicker';
import { useI18n } from '../../i18n/I18nProvider';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
  buildSubmission,
  emptyForm,
  MAX_OPTIONS,
  type CreatorForm,
  type CreatorKind,
  type Difficulty,
  type FormError,
  type QuestionType,
} from '../../lib/creator-form';
import { space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { LanguageSwitch } from '../../ui/LanguageSwitch';
import { Animated, enter } from '../../ui/motion';
import { Button, ChoiceCard, Chip, Field, Text } from '../../ui/primitives';
import { ScreenHeader, useGoBack } from '../../ui/ScreenHeader';

const KINDS: CreatorKind[] = ['note', 'flashcard', 'question'];
const QTYPES: QuestionType[] = ['single_choice', 'true_false', 'fill_blank', 'numerical'];
const LEVELS: Difficulty[] = ['easy', 'medium', 'hard'];

/** Composer for notes, flashcards and questions. The server validates again and applies review rules; this screen only helps. */
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
  const [done, setDone] = useState<'pending' | 'live' | null>(null);
  const submitting = useRef(false);
  const set = (p: Partial<CreatorForm>) => setF((cur) => ({ ...cur, ...p }));

  const built = buildSubmission(f);
  const missing: FormError[] = showErrors && !built.ok ? built.errors : [];
  const msg = (e: FormError) => (missing.includes(e) ? t(`create.err.${e}`) : null);

  const post = async () => {
    if (submitting.current) return; // no double posts
    if (!built.ok) {
      setShowErrors(true);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await api.createContent(built.payload);
      void qc.invalidateQueries({ queryKey: ['my-posts', session?.user.id] });
      setDone(r.moderation === 'cleared' ? 'live' : 'pending');
    } catch (e) {
      const a = e instanceof ApiError ? e : null;
      setError(
        a?.isOffline
          ? t('create.postErr.offline')
          : a?.status === 429
            ? t('create.postErr.rate')
            : a?.status === 403
              ? t('create.postErr.forbidden')
              : a?.status === 400
                ? t('create.postErr.invalid')
                : t('create.postErr.generic'),
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
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
          <Text style={{ fontSize: 56, textAlign: 'center' }}>{done === 'live' ? '🎉' : '⏳'}</Text>
          <Text variant="heading" style={{ textAlign: 'center' }}>
            {done === 'live' ? t('create.done.live') : t('create.done.pending')}
          </Text>
          <Button
            label={t('create.new')}
            onPress={() => {
              setF(emptyForm(locale));
              setShowErrors(false);
              setDone(null);
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
                label={t(`create.kind.${k}`)}
                description={t(`create.kind.${k}.desc`)}
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

          <ConceptPicker
            value={f.conceptId}
            onChange={(conceptId) => set({ conceptId })}
            error={msg('concept')}
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
