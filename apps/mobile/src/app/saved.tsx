import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FlatList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { kindLabelKey } from '../features/feed/card-model';
import { useI18n } from '../i18n/I18nProvider';
import { useAuth } from '../lib/auth';
import { track } from '../lib/event-queue';
import { supabase } from '../lib/supabase';
import { useNotice } from '../lib/use-notice';
import { kindOf, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Button, Card, EmptyState, ErrorState, LoadingState, Pill, Text } from '../ui/primitives';
import { Toast } from '../ui/Toast';

interface SavedRow {
  content_id: string;
  created_at: string;
  content_items: { id: string; title: string; type: string; format: string | null } | null;
}

/** The learner's saved content (RLS: own saves only). Content that is no longer visible is simply not listed. */
export default function Saved() {
  const { t } = useI18n();
  const { colors, kind: kindColors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useAuth();
  const uid = session?.user.id;
  const { notice, show } = useNotice();
  const q = useQuery({
    queryKey: ['saved', uid],
    enabled: !!uid,
    queryFn: async () => {
      const r = await supabase
        .from('saves')
        .select('content_id, created_at, content_items(id, title, type, format)')
        .eq('user_id', uid!)
        .order('created_at', { ascending: false })
        .limit(100);
      if (r.error) throw new Error('load');
      return (r.data as unknown as SavedRow[]).filter((x) => x.content_items);
    },
  });
  const unsave = async (id: string) => {
    if (!uid) return;
    const { error } = await supabase.from('saves').delete().eq('user_id', uid).eq('content_id', id);
    if (error) return show(t('social.actionError'));
    track('unsave', { content_id: id });
    qc.setQueryData<SavedRow[]>(['saved', uid], (cur) =>
      (cur ?? []).filter((x) => x.content_id !== id),
    );
    void qc.invalidateQueries({ queryKey: ['saved-count', uid] });
  };
  let body: React.ReactNode;
  if (q.isLoading) body = <LoadingState />;
  else if (q.isError || !q.data) body = <ErrorState onRetry={() => void q.refetch()} />;
  else if (!q.data.length)
    body = <EmptyState glyph="🔖" title={t('saved.empty.title')} message={t('saved.empty.body')} />;
  else
    body = (
      <FlatList
        data={q.data}
        keyExtractor={(r) => r.content_id}
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        renderItem={({ item }) => {
          const c = item.content_items!;
          const kind = kindOf(c.type, c.format);
          const k = kindColors(kind);
          return (
            <Card style={{ gap: space.sm }}>
              <Pill label={t(kindLabelKey(kind, c.format)).toUpperCase()} fg={k.fg} bg={k.bg} />
              <Text variant="heading">{c.title}</Text>
              <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
                <Button
                  label={t('saved.open')}
                  onPress={() => router.push({ pathname: '/content/[id]', params: { id: c.id } })}
                />
                <Button
                  variant="secondary"
                  label={`☆ ${t('social.saved')}`}
                  onPress={() => void unsave(c.id)}
                />
              </View>
            </Card>
          );
        }}
      />
    );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
        <Button variant="ghost" label={`‹ ${t('common.back')}`} onPress={() => router.back()} />
        <Text variant="heading" accessibilityRole="header">
          {t('saved.title')}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        {body}
        <Toast message={notice} />
      </View>
    </SafeAreaView>
  );
}
