import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Button, Chip, ErrorState, LoadingState, Text } from '../ui/primitives';

/** Deliberately short: pick an exam, a few subjects, optionally a date. The first feed batch learns the rest. */
export default function Onboarding() {
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useAuth();
  const [examId, setExamId] = useState<string | undefined>();
  const [subjects, setSubjects] = useState<string[]>([]);
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const data = useQuery({
    queryKey: ['onboarding-options'],
    queryFn: async () => {
      const [e, s] = await Promise.all([
        supabase.from('exams').select('id,name').eq('active', true).order('name'),
        supabase.from('subjects').select('id,name').order('name'),
      ]);
      if (e.error || s.error) throw new Error('load');
      return { exams: e.data, subjects: s.data };
    },
  });
  if (data.isLoading) return <LoadingState />;
  if (data.isError || !data.data) return <ErrorState onRetry={() => data.refetch()} />;

  const validDate = date === '' || /^\d{4}-\d{2}-\d{2}$/.test(date);
  const finish = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.onboarding({ examId, examDate: date || undefined, interestSubjectIds: subjects });
      await qc.invalidateQueries({ queryKey: ['onboarded', session?.user.id] });
      router.replace('/');
    } catch {
      setErr('Could not save your choices. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }}>
        <Text variant="title" accessibilityRole="header">
          Let’s personalise your feed
        </Text>
        <Text muted>Two quick choices. Everything else is learned as you go.</Text>
        <Text variant="heading">Your exam</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {data.data.exams.map((e) => (
            <Chip
              key={e.id}
              label={e.name}
              selected={examId === e.id}
              onPress={() => setExamId(examId === e.id ? undefined : e.id)}
            />
          ))}
        </View>
        <Text variant="heading">What interests you?</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {data.data.subjects.map((s) => (
            <Chip
              key={s.id}
              label={s.name}
              selected={subjects.includes(s.id)}
              onPress={() =>
                setSubjects(
                  subjects.includes(s.id)
                    ? subjects.filter((x) => x !== s.id)
                    : [...subjects, s.id],
                )
              }
            />
          ))}
        </View>
        <Text variant="heading">Exam date (optional)</Text>
        <TextInput
          accessibilityLabel="Exam date, year-month-day"
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.textMuted}
          style={{
            minHeight: 48,
            borderWidth: 1,
            borderColor: validDate ? colors.border : colors.danger,
            borderRadius: radius.md,
            paddingHorizontal: space.md,
            color: colors.text,
            backgroundColor: colors.surface,
          }}
        />
        {err ? (
          <Text accessibilityRole="alert" style={{ color: colors.danger }}>
            {err}
          </Text>
        ) : null}
        <Button label="Start learning" onPress={finish} loading={busy} disabled={!validDate} />
        <Button variant="ghost" label="Skip for now" onPress={finish} disabled={busy} />
      </ScrollView>
    </SafeAreaView>
  );
}
