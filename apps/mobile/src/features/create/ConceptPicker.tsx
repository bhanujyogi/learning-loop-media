import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { localName } from '../../i18n/core';
import { useI18n } from '../../i18n/I18nProvider';
import { supabase } from '../../lib/supabase';
import { radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { ChoiceCard, Text } from '../../ui/primitives';

interface Concept {
  id: string;
  name: string;
  name_i18n: Record<string, unknown> | null;
}

/** Picks the curriculum concept a post teaches (this is what lets the learner model and the feed use the post). */
export function ConceptPicker({
  value,
  onChange,
  error,
}: {
  value?: string;
  onChange: (id: string) => void;
  error?: string | null;
}) {
  const { t, locale } = useI18n();
  const { colors } = useTheme();
  const [q, setQ] = useState('');
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
  const all = list.data ?? [];
  const needle = q.trim().toLowerCase();
  const matches = all
    .filter(
      (c) =>
        !needle ||
        localName(c, locale).toLowerCase().includes(needle) ||
        c.name.toLowerCase().includes(needle),
    )
    .slice(0, 8);
  const selected = all.find((c) => c.id === value);
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="label">{t('create.field.concept')}</Text>
      <Text variant="caption" muted>
        {t('create.field.conceptHelp')}
      </Text>
      {list.isError ? (
        <Text style={{ color: colors.danger }}>{t('create.conceptsError')}</Text>
      ) : null}
      {selected ? <ChoiceCard label={localName(selected, locale)} state="selected" /> : null}
      {all.length > 8 ? (
        <TextInput
          value={q}
          onChangeText={setQ}
          accessibilityLabel={t('create.field.concept')}
          placeholder="…"
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
      {matches
        .filter((c) => c.id !== value)
        .map((c) => (
          <ChoiceCard key={c.id} label={localName(c, locale)} onPress={() => onChange(c.id)} />
        ))}
      {error ? (
        <Text accessibilityRole="alert" variant="caption" style={{ color: colors.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
