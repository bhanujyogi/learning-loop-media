import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ContentBody } from '../../features/feed/ContentBody';
import { kindLabelKey } from '../../features/feed/card-model';
import { useI18n } from '../../i18n/I18nProvider';
import { track } from '../../lib/event-queue';
import { useNotice } from '../../lib/use-notice';
import { useReactions } from '../../lib/use-reactions';
import { supabase } from '../../lib/supabase';
import { kindOf, space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Pill,
  Text,
  ToggleButton,
} from '../../ui/primitives';
import { Toast } from '../../ui/Toast';

/** Opens one published item full-screen (from a feed card or the Saved list). The body is read through RLS like any client read. */
export default function ContentScreen() {
  const { id, rec } = useLocalSearchParams<{ id: string; rec?: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const { colors, kind: kindColors } = useTheme();
  const { notice, show } = useNotice();
  const recommendationId = rec ? rec : undefined;

  const q = useQuery({
    queryKey: ['content', id],
    enabled: !!id,
    queryFn: async () => {
      const item = await supabase
        .from('content_items')
        .select('id,type,title,format,language,current_version_id')
        .eq('id', id)
        .maybeSingle();
      if (item.error) throw new Error('load');
      if (!item.data?.current_version_id) return null; // not visible to this user (RLS) or not published
      const v = await supabase
        .from('content_versions')
        .select('body')
        .eq('id', item.data.current_version_id)
        .maybeSingle();
      if (v.error) throw new Error('load');
      return v.data ? { ...item.data, body: v.data.body as unknown } : null;
    },
  });
  const reactions = useReactions(id ? [id] : [], [], () => show(t('social.actionError')));
  const data = q.data;
  useEffect(() => {
    if (data?.type === 'note')
      track('note_open', { content_id: data.id, recommendation_id: recommendationId });
  }, [data?.id, data?.type, recommendationId]);

  const back = (
    <Button variant="ghost" label={`‹ ${t('common.back')}`} onPress={() => router.back()} />
  );
  let body: React.ReactNode;
  if (q.isLoading) body = <LoadingState />;
  else if (q.isError) body = <ErrorState onRetry={() => void q.refetch()} />;
  else if (!data) body = <EmptyState glyph="🔍" title={t('content.notFound')} message="" />;
  else {
    const kind = kindOf(data.type, data.format);
    const k = kindColors(kind);
    body = (
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }}>
        <Pill label={t(kindLabelKey(kind, data.format)).toUpperCase()} fg={k.fg} bg={k.bg} />
        <Text variant="display" accessibilityRole="header">
          {data.title}
        </Text>
        <ContentBody
          item={{ contentId: data.id, type: data.type, body: data.body }}
          recommendationId={recommendationId}
          mode="full"
          onNext={() => router.back()}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <ToggleButton
            on={reactions.liked.has(data.id)}
            glyphOn="♥"
            glyphOff="♡"
            labelOn={t('social.liked')}
            labelOff={t('social.like')}
            onPress={() => reactions.toggleLike(data.id, recommendationId)}
          />
          <ToggleButton
            on={reactions.saved.has(data.id)}
            glyphOn="★"
            glyphOff="☆"
            labelOn={t('social.saved')}
            labelOff={t('social.save')}
            onPress={() => reactions.toggleSave(data.id, recommendationId)}
          />
        </View>
      </ScrollView>
    );
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: space.sm }}>
        <View style={{ alignSelf: 'flex-start' }}>{back}</View>
      </View>
      <View style={{ flex: 1 }}>
        {body}
        <Toast message={notice} />
      </View>
    </SafeAreaView>
  );
}
