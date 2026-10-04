import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useI18n } from '../../i18n/I18nProvider';
import { answerCache } from '../../lib/answer-cache';
import { api, ApiError, type SubmitAnswerResponse } from '../../lib/api';
import { track } from '../../lib/event-queue';
import { sessionStats } from '../../lib/session-stats';
import { useReduceMotion } from '../../lib/use-reduce-motion';
import { uuid } from '../../lib/uuid';
import { radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { Animated, enter, usePop } from '../../ui/motion';
import { Button, ChoiceCard, Pill, ProgressBar, Text } from '../../ui/primitives';
import {
  buildResponse,
  describeCorrectAnswer,
  isReady,
  isSupportedQuestion,
  optionStates,
  verdictOf,
  type PublicQuestion,
} from './question-model';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/**
 * Answers are graded SERVER-SIDE (`submit-answer` Edge Function → submitAnswer). The client only ever holds the public body
 * (no answer key, no explanation); the key, explanation, XP and mastery change arrive in the grading response. Nothing here
 * computes correctness or touches mastery.
 */
export function QuestionCard({
  contentId,
  recommendationId,
  body,
  onNext,
}: {
  contentId: string;
  recommendationId?: string;
  body: PublicQuestion;
  /** Scrolls the feed to the next card (shown after the answer, so the loop continues without hunting for a gesture). */
  onNext?: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const reduceMotion = useReduceMotion();
  const cached = answerCache.get(contentId);
  const started = useRef(Date.now());
  const key = useRef(uuid());
  const submitting = useRef(false);
  const [selected, setSelected] = useState<string[]>(cached?.selected ?? []);
  const [text, setText] = useState(cached?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<SubmitAnswerResponse | null>(cached?.result ?? null);
  const [hints, setHints] = useState(0);
  const pop = usePop(res?.attemptId);

  if (!isSupportedQuestion(body.type)) return <Text muted>{t('feed.unsupportedQuestion')}</Text>;

  const multi = body.type === 'multi_choice';
  const isText = body.type === 'fill_blank' || body.type === 'numerical';
  const isOrdering = body.type === 'ordering';
  const options =
    body.type === 'true_false'
      ? [
          { id: 'true', text: t('q.true') },
          { id: 'false', text: t('q.false') },
        ]
      : (body.options ?? []);
  const choice = !isText && !isOrdering;
  const states = res && choice ? optionStates(body.type, options, selected, res.correctAnswer) : {};
  const verdict = res ? verdictOf(res) : null;
  const rightText = res ? describeCorrectAnswer(body, res.correctAnswer) : null;

  const submit = async () => {
    if (submitting.current || res) return; // never submit twice (rapid taps / re-render races)
    submitting.current = true;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.submitAnswer({
        questionId: contentId,
        response: buildResponse(body.type, selected, text),
        responseMs: Date.now() - started.current,
        hintsUsed: hints,
        recommendationId,
        idempotencyKey: key.current, // a retry after a lost response replays the same attempt, never a second one
      });
      setRes(r);
      answerCache.set(contentId, { selected, text, result: r });
      if (!r.replayed) sessionStats.record({ correct: r.correct, xpAwarded: r.xp.awarded });
      if (!reduceMotion)
        void Haptics.notificationAsync(
          r.correct
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Warning,
        );
    } catch (e) {
      setErr(e instanceof ApiError && e.isOffline ? t('q.err.offline') : t('q.err.generic'));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((s) => (multi ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]));

  const tone =
    verdict === 'correct'
      ? { fg: colors.success, bg: colors.successBg, mark: '✓', label: t('q.correct') }
      : verdict === 'partial'
        ? { fg: colors.accent, bg: colors.surfaceAlt, mark: '◐', label: t('q.partial') }
        : { fg: colors.danger, bg: colors.dangerBg, mark: '✗', label: t('q.incorrect') };

  return (
    <View style={{ gap: space.lg }}>
      <Text variant="prompt" accessibilityRole="header">
        {body.prompt}
      </Text>
      {multi ? (
        <Text variant="caption" muted>
          {t('q.multiHint')}
        </Text>
      ) : null}
      {isOrdering ? (
        <Text variant="caption" muted>
          {t('q.orderHint')}
        </Text>
      ) : null}

      {choice ? (
        <View style={{ gap: space.sm }}>
          {options.map((o, i) => {
            const st = res
              ? (states[o.id] ?? 'idle')
              : selected.includes(o.id)
                ? 'selected'
                : 'idle';
            return (
              <ChoiceCard
                key={o.id}
                role={multi ? 'checkbox' : 'radio'}
                leading={body.type === 'true_false' ? undefined : LETTERS[i]}
                label={o.text}
                state={st}
                stateLabel={
                  st === 'correct'
                    ? t('q.correct')
                    : st === 'wrong'
                      ? t('q.incorrect')
                      : st === 'missed'
                        ? t('q.correctAnswerIs')
                        : undefined
                }
                disabled={!!res || busy}
                onPress={() => toggle(o.id)}
              />
            );
          })}
        </View>
      ) : null}

      {isText ? (
        <TextInput
          value={text}
          onChangeText={setText}
          editable={!res && !busy}
          keyboardType={body.type === 'numerical' ? 'numeric' : 'default'}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t('q.yourAnswer')}
          placeholder={t('q.typeAnswer')}
          placeholderTextColor={colors.textMuted}
          onSubmitEditing={() => void submit()}
          returnKeyType="done"
          style={{
            minHeight: 56,
            fontSize: 18,
            borderWidth: res ? 2 : 1,
            borderColor: res ? (res.correct ? colors.success : colors.danger) : colors.border,
            borderRadius: radius.lg,
            paddingHorizontal: space.lg,
            color: colors.text,
            backgroundColor: colors.surface,
          }}
        />
      ) : null}

      {isOrdering ? (
        <View style={{ gap: space.sm }}>
          {(body.items ?? []).map((o) => {
            const pos = selected.indexOf(o.id);
            return (
              <ChoiceCard
                key={o.id}
                role="button"
                leading={pos >= 0 ? String(pos + 1) : undefined}
                label={o.text}
                state={pos >= 0 ? 'selected' : 'idle'}
                disabled={!!res || busy || pos >= 0}
                onPress={() => setSelected([...selected, o.id])}
              />
            );
          })}
          {selected.length > 0 && !res ? (
            <Button
              variant="ghost"
              label={t('q.orderReset')}
              onPress={() => setSelected([])}
              disabled={busy}
            />
          ) : null}
        </View>
      ) : null}

      {body.hint && !res ? (
        <Button
          variant="ghost"
          label={hints ? t('q.hintLabel', { hint: body.hint }) : t('q.hint')}
          onPress={() => {
            track('hint_used', {
              question_id: contentId,
              hint_no: hints + 1,
              recommendation_id: recommendationId,
            });
            setHints(hints + 1);
          }}
        />
      ) : null}

      {!res ? (
        <Button
          label={busy ? t('q.checking') : t('q.check')}
          onPress={() => void submit()}
          loading={busy}
          disabled={!isReady(body, selected, text)}
        />
      ) : null}
      {err ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={{ color: colors.danger }}
        >
          {err}
        </Text>
      ) : null}

      {res ? (
        <Animated.View
          entering={enter()}
          accessibilityLiveRegion="polite"
          style={{
            gap: space.md,
            padding: space.lg,
            borderRadius: radius.lg,
            backgroundColor: tone.bg,
            borderWidth: 2,
            borderColor: tone.fg,
          }}
        >
          <Animated.View
            style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm }, pop]}
          >
            <Text variant="display" style={{ color: tone.fg }}>
              {tone.mark}
            </Text>
            <Text variant="heading" style={{ color: tone.fg, flexShrink: 1 }}>
              {tone.label}
            </Text>
          </Animated.View>
          {rightText ? (
            <View style={{ gap: 2 }}>
              <Text variant="caption" muted>
                {t('q.correctAnswerIs')}
              </Text>
              <Text variant="heading">{rightText}</Text>
            </View>
          ) : null}
          {res.explanation ? (
            <View style={{ gap: 2 }}>
              <Text variant="caption" muted>
                {t('q.why')}
              </Text>
              <Text>{res.explanation}</Text>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {res.xp.awarded > 0 ? (
              <Pill
                label={t('q.xp', { xp: res.xp.awarded })}
                fg={colors.onPrimary}
                bg={colors.primary}
              />
            ) : null}
            <Pill
              label={t('q.level', { level: res.xp.level })}
              fg={colors.text}
              bg={colors.surfaceAlt}
            />
            {res.xp.leveledUp ? (
              <Pill label={t('q.levelUp')} fg={colors.onPrimary} bg={colors.success} />
            ) : null}
          </View>
          {res.repeatAttempt ? (
            <Text variant="caption" muted>
              {t('q.repeat')}
            </Text>
          ) : null}
          {res.mastery[0] ? (
            <View style={{ gap: space.xs }}>
              <Text variant="caption" muted>
                {t('q.mastery')}
              </Text>
              <ProgressBar value={res.mastery[0].mastery} label={t('q.mastery')} height={10} />
              <Text variant="caption" muted>
                {t('q.masteryNote')}
              </Text>
            </View>
          ) : null}
          {res.achievements.map((a) => (
            <Text key={a} variant="label">
              🏅 {t('q.achievement', { name: a.replace(/_/g, ' ') })}
            </Text>
          ))}
          {onNext ? <Button label={t('q.next')} onPress={onNext} /> : null}
        </Animated.View>
      ) : null}
    </View>
  );
}
