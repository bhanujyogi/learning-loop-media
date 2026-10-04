import { PREPARATION_LEVELS, type Locale, type PreparationLevel } from '@learning-loop/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { localName } from '../i18n/core';
import { useI18n } from '../i18n/I18nProvider';
import { accountKey } from '../lib/account';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  buildOnboardingPayload,
  formatDateInput,
  isSkippable,
  ONBOARDING_STEPS,
  parseExamDate,
  type OnboardingStep,
} from '../lib/onboarding';
import { supabase } from '../lib/supabase';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { LanguageSwitch } from '../ui/LanguageSwitch';
import { Animated, enter } from '../ui/motion';
import {
  Button,
  ChoiceCard,
  Chip,
  ErrorState,
  Field,
  LoadingState,
  ProgressBar,
  Text,
} from '../ui/primitives';

interface Named {
  id: string;
  name: string;
  name_i18n: Record<string, unknown> | null;
}

/** Five short steps (language → goal → subjects → level → date). Every step but language can be skipped. */
export default function Onboarding() {
  const { colors } = useTheme();
  const { t, locale, setLocale } = useI18n();
  const qc = useQueryClient();
  const { session } = useAuth();
  const [step, setStep] = useState(0);
  const [examId, setExamId] = useState<string | undefined>();
  const [subjects, setSubjects] = useState<string[]>([]);
  const [level, setLevel] = useState<PreparationLevel | undefined>();
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submitting = useRef(false);

  const options = useQuery({
    queryKey: ['onboarding-options'],
    queryFn: async () => {
      const [e, s] = await Promise.all([
        supabase.from('exams').select('id,name,name_i18n').eq('active', true).order('name'),
        supabase.from('subjects').select('id,name,name_i18n').order('name'),
      ]);
      if (e.error || s.error) throw new Error('load');
      return { exams: e.data as Named[], subjects: s.data as Named[] };
    },
  });

  const current: OnboardingStep = ONBOARDING_STEPS[step]!;
  const last = step === ONBOARDING_STEPS.length - 1;
  const dateOk = parseExamDate(date).ok;

  const finish = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setErr(null);
    try {
      await api.onboarding(
        buildOnboardingPayload({ language: locale, examId, subjects, level, date }),
      );
      // routing gate re-reads the account, sees onboarded=true and moves to the feed
      await qc.invalidateQueries({ queryKey: accountKey(session?.user.id) });
    } catch {
      setErr(t('onb.saveError'));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const next = () => (last ? void finish() : setStep(step + 1));
  const canContinue = current === 'date' ? dateOk : true;

  if (options.isLoading) return <LoadingState />;
  if (options.isError || !options.data)
    return <ErrorState message={t('onb.optionsError')} onRetry={() => void options.refetch()} />;
  const data = options.data;

  const title = {
    language: t('onb.lang.title'),
    goal: t('onb.goal.title'),
    subjects: t('onb.subjects.title'),
    level: t('onb.level.title'),
    date: t('onb.date.title'),
  }[current];
  const body = {
    language: t('onb.lang.body'),
    goal: t('onb.goal.body'),
    subjects: t('onb.subjects.body'),
    level: t('onb.level.body'),
    date: t('onb.date.body'),
  }[current];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={{ paddingHorizontal: space.xl, paddingTop: space.lg, gap: space.sm }}>
          <ProgressBar
            value={(step + 1) / ONBOARDING_STEPS.length}
            label={t('onb.step', { n: step + 1, total: ONBOARDING_STEPS.length })}
            height={10}
          />
          <Text variant="caption" muted>
            {t('onb.step', { n: step + 1, total: ONBOARDING_STEPS.length })}
          </Text>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: space.xl, gap: space.lg, flexGrow: 1 }}
        >
          <Animated.View key={current} entering={enter()} style={{ gap: space.lg }}>
            <Text variant="display" accessibilityRole="header">
              {title}
            </Text>
            <Text muted>{body}</Text>

            {current === 'language' ? (
              <LanguageSwitch value={locale} onChange={(l: Locale) => void setLocale(l)} />
            ) : null}

            {current === 'goal' ? (
              <View style={{ gap: space.md }}>
                {data.exams.map((e) => (
                  <ChoiceCard
                    key={e.id}
                    label={localName(e, locale)}
                    state={examId === e.id ? 'selected' : 'idle'}
                    onPress={() => setExamId(e.id)}
                  />
                ))}
                <ChoiceCard
                  label={t('onb.goal.later')}
                  state={examId === undefined ? 'selected' : 'idle'}
                  onPress={() => setExamId(undefined)}
                />
              </View>
            ) : null}

            {current === 'subjects' ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {data.subjects.map((s) => (
                  <Chip
                    key={s.id}
                    label={localName(s, locale)}
                    selected={subjects.includes(s.id)}
                    onPress={() =>
                      setSubjects((cur) =>
                        cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id],
                      )
                    }
                  />
                ))}
              </View>
            ) : null}

            {current === 'level' ? (
              <View style={{ gap: space.md }}>
                {PREPARATION_LEVELS.map((l) => (
                  <ChoiceCard
                    key={l}
                    label={t(`onb.level.${l}`)}
                    description={t(`onb.level.${l}.desc`)}
                    state={level === l ? 'selected' : 'idle'}
                    onPress={() => setLevel(l)}
                  />
                ))}
              </View>
            ) : null}

            {current === 'date' ? (
              <View style={{ gap: space.md }}>
                <Field
                  label={t('onb.date.label')}
                  value={date}
                  onChangeText={(v) => setDate(formatDateInput(v))}
                  placeholder={t('onb.date.placeholder')}
                  keyboardType="number-pad"
                  maxLength={10}
                  error={date && !dateOk ? t('onb.date.invalid') : null}
                />
                <Button variant="ghost" label={t('onb.date.unknown')} onPress={() => setDate('')} />
              </View>
            ) : null}
          </Animated.View>
        </ScrollView>

        <View
          style={{
            padding: space.xl,
            gap: space.sm,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
          }}
        >
          {err ? (
            <Text accessibilityRole="alert" style={{ color: colors.danger }}>
              {err}
            </Text>
          ) : null}
          <Button
            label={last ? t('onb.finish') : t('common.continue')}
            onPress={next}
            loading={busy}
            disabled={!canContinue}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {step > 0 ? (
              <Button
                variant="ghost"
                label={t('common.back')}
                onPress={() => setStep(step - 1)}
                disabled={busy}
              />
            ) : (
              <View />
            )}
            {isSkippable(current) && !last ? (
              <Button
                variant="ghost"
                label={t('common.skip')}
                onPress={() => setStep(step + 1)}
                disabled={busy}
              />
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
