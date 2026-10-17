import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { localName } from '../../i18n/core';
import { useI18n } from '../../i18n/I18nProvider';
import { MAX_TOPIC } from '../../lib/creator-form';
import { supabase } from '../../lib/supabase';
import { space } from '../../theme/tokens';
import { Chip, Field, Text } from '../../ui/primitives';

interface Concept {
  id: string;
  name: string;
  name_i18n: Record<string, unknown> | null;
}

/** Curriculum concepts whose name contains what was typed (case-insensitive, either language). Pure so it can be tested. */
export function suggestConcepts<C extends { name: string }>(
  all: C[],
  typed: string,
  nameOf: (c: C) => string,
  limit = 6,
): C[] {
  const needle = typed.trim().toLowerCase();
  if (needle.length < 1) return [];
  return all
    .filter(
      (c) => nameOf(c).toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle),
    )
    .slice(0, limit);
}

/**
 * "What does it teach?" - free text (2–80 characters). Matching curriculum concepts show up as chips; tapping one fills the
 * text AND links the post to that concept (so the learner model can use it). Typing anything else unlinks it.
 */
export function TopicField({
  topic,
  conceptId,
  onChange,
  error,
}: {
  topic: string;
  conceptId?: string;
  onChange: (v: { topic: string; conceptId?: string }) => void;
  error?: string | null;
}) {
  const { t, locale } = useI18n();
  const list = useQuery({
    queryKey: ['concepts'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const r = await supabase
        .from('concepts')
        .select('id, name, name_i18n')
        .order('name')
        .limit(500);
      if (r.error) throw new Error('concepts');
      return r.data as Concept[];
    },
  });
  const nameOf = (c: Concept) => localName(c, locale);
  const linked = (list.data ?? []).find((c) => c.id === conceptId);
  const shown = suggestConcepts(list.data ?? [], topic, nameOf).filter(
    // once linked, the chosen concept stays visible as selected; others remain tappable
    (c) => c.id !== conceptId,
  );
  return (
    <View style={{ gap: space.sm }}>
      <Field
        label={t('create.field.concept')}
        value={topic}
        onChangeText={(v) => onChange({ topic: v })} // typing anything unlinks the concept
        maxLength={MAX_TOPIC}
        autoCapitalize="sentences"
        error={error}
      />
      <Text variant="caption" muted>
        {t('create.field.conceptHelp')}
      </Text>
      {linked || shown.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {linked ? <Chip label={nameOf(linked)} selected /> : null}
          {shown.map((c) => (
            <Chip
              key={c.id}
              label={nameOf(c)}
              onPress={() => onChange({ topic: nameOf(c).slice(0, MAX_TOPIC), conceptId: c.id })}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
