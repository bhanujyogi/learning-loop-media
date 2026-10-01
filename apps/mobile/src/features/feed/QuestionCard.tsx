import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { api, ApiError, type SubmitAnswerResponse } from '../../lib/api';
import { track } from '../../lib/event-queue';
import { useReduceMotion } from '../../lib/use-reduce-motion';
import { uuid } from '../../lib/uuid';
import { radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { Button, ProgressBar, Text } from '../../ui/primitives';

interface Opt {
  id: string;
  text: string;
}
interface PublicQuestion {
  type: string;
  prompt: string;
  options?: Opt[];
  items?: Opt[];
  hint?: string;
}
const SUPPORTED = [
  'single_choice',
  'image_based',
  'application',
  'multi_choice',
  'true_false',
  'fill_blank',
  'numerical',
  'ordering',
];

/**
 * Answers are graded SERVER-SIDE. The client only ever holds the public body (no answer key, no explanation);
 * the explanation arrives with the grading response.
 */
export function QuestionCard({ contentId, body }: { contentId: string; body: PublicQuestion }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const started = useRef(Date.now());
  const key = useRef(uuid());
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<SubmitAnswerResponse | null>(null);
  const [hints, setHints] = useState(0);

  if (!SUPPORTED.includes(body.type)) {
    return (
      <Text muted>
        This question type isn’t supported in this app version yet. Swipe to continue.
      </Text>
    );
  }
  const multi = body.type === 'multi_choice';
  const isChoice = !!body.options && body.type !== 'ordering';
  const isText = body.type === 'fill_blank' || body.type === 'numerical';
  const isOrdering = body.type === 'ordering';
  const options =
    body.type === 'true_false'
      ? [
          { id: 'true', text: 'True' },
          { id: 'false', text: 'False' },
        ]
      : (body.options ?? []);

  const buildResponse = (): unknown => {
    if (body.type === 'true_false') return { value: selected[0] === 'true' };
    if (multi) return { optionIds: selected };
    if (isChoice) return { optionId: selected[0] };
    if (body.type === 'numerical') return { value: Number(text) };
    if (body.type === 'fill_blank') return { value: text };
    return { order: selected };
  };
  const ready = isText
    ? text.trim().length > 0 && (body.type !== 'numerical' || Number.isFinite(Number(text)))
    : isOrdering
      ? selected.length === (body.items?.length ?? 0)
      : selected.length > 0;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.submitAnswer({
        questionId: contentId,
        response: buildResponse(),
        responseMs: Date.now() - started.current,
        hintsUsed: hints,
        idempotencyKey: key.current,
      });
      setRes(r);
      if (!reduceMotion)
        void Haptics.notificationAsync(
          r.correct
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Warning,
        );
    } catch (e) {
      setErr(
        e instanceof ApiError && e.isOffline
          ? "You're offline. Reconnect to check your answer — it will be graded when you retry."
          : 'Could not check your answer. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((s) => (multi ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]));

  return (
    <View style={{ gap: space.md }}>
      <Text variant="heading" accessibilityRole="header">
        {body.prompt}
      </Text>
      {isChoice || body.type === 'true_false'
        ? options.map((o) => (
            <Button
              key={o.id}
              variant={selected.includes(o.id) ? 'primary' : 'secondary'}
              label={`${selected.includes(o.id) ? '✓ ' : ''}${o.text}`}
              disabled={!!res}
              onPress={() => toggle(o.id)}
            />
          ))
        : null}
      {isText ? (
        <TextInput
          value={text}
          onChangeText={setText}
          editable={!res}
          keyboardType={body.type === 'numerical' ? 'numeric' : 'default'}
          accessibilityLabel="Your answer"
          placeholder="Type your answer"
          placeholderTextColor={colors.textMuted}
          style={{
            minHeight: 48,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.md,
            paddingHorizontal: space.md,
            color: colors.text,
            backgroundColor: colors.surface,
          }}
        />
      ) : null}
      {isOrdering
        ? (body.items ?? []).map((o) => (
            <Button
              key={o.id}
              variant={selected.includes(o.id) ? 'primary' : 'secondary'}
              disabled={!!res || selected.includes(o.id)}
              label={selected.includes(o.id) ? `${selected.indexOf(o.id) + 1}. ${o.text}` : o.text}
              onPress={() => setSelected([...selected, o.id])}
            />
          ))
        : null}
      {body.hint && !res ? (
        <Button
          variant="ghost"
          label={hints ? `Hint: ${body.hint}` : 'Show hint'}
          onPress={() =>
            setHints((h) => {
              track('hint_used', { question_id: contentId, hint_no: h + 1 });
              return h + 1;
            })
          }
        />
      ) : null}
      {!res ? (
        <Button label="Check answer" onPress={submit} loading={busy} disabled={!ready} />
      ) : null}
      {err ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger }}>
          {err}
        </Text>
      ) : null}
      {res ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            gap: space.sm,
            padding: space.md,
            borderRadius: radius.md,
            backgroundColor: res.correct ? colors.successBg : colors.dangerBg,
          }}
        >
          <Text variant="heading">{res.correct ? '✓ Correct' : '✗ Not quite'}</Text>
          <Text>{res.explanation}</Text>
          <Text variant="label">
            +{res.xp.awarded} XP · Level {res.xp.level}
            {res.xp.leveledUp ? ' — level up!' : ''}
          </Text>
          {res.mastery[0] ? (
            <View style={{ gap: space.xs }}>
              <Text variant="caption" muted>
                Concept mastery estimate ({res.mastery[0].level})
              </Text>
              <ProgressBar value={res.mastery[0].mastery} label="Concept mastery estimate" />
            </View>
          ) : null}
          {res.achievements.map((a) => (
            <Text key={a} variant="label">
              🏅 Achievement unlocked: {a.replace(/_/g, ' ')}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
