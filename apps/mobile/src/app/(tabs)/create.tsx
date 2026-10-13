import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Alert, FlatList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { kindLabelKey } from '../../features/feed/card-model';
import { useI18n } from '../../i18n/I18nProvider';
import { useAuth } from '../../lib/auth';
import { postStatus, type PostStatus } from '../../lib/creator-form';
import { supabase } from '../../lib/supabase';
import { useNotice } from '../../lib/use-notice';
import { kindOf, space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { Button, Card, ErrorState, LoadingState, Pill, Text } from '../../ui/primitives';
import { Toast } from '../../ui/Toast';

interface Post {
  id: string;
  title: string;
  type: string;
  format: string | null;
  publishing: string;
  moderation: string;
}

/** Create tab: start a new post, and see / delete your own posts with their review status. */
export default function CreateTab() {
  const { t } = useI18n();
  const { colors, kind: kindColors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useAuth();
  const uid = session?.user.id;
  const { notice, show } = useNotice();
  const posts = useQuery({
    queryKey: ['my-posts', uid],
    enabled: !!uid,
    queryFn: async () => {
      // RLS: owners can read their own content in every state
      const r = await supabase
        .from('content_items')
        .select('id, title, type, format, publishing, moderation')
        .eq('owner_user_id', uid!)
        .neq('publishing', 'deleted')
        .order('created_at', { ascending: false })
        .limit(50);
      if (r.error) throw new Error('load');
      return r.data as Post[];
    },
  });

  const remove = (id: string) =>
    Alert.alert(t('create.delete'), t('create.deleteConfirm'), [
      { text: t('common.close'), style: 'cancel' },
      {
        text: t('create.delete'),
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase
            .from('content_items')
            .update({ publishing: 'deleted' })
            .eq('id', id);
          if (error) return show(t('create.deleteError'));
          void qc.invalidateQueries({ queryKey: ['my-posts', uid] });
          void qc.invalidateQueries({ queryKey: ['saved', uid] });
        },
      },
    ]);

  const label: Record<PostStatus, string> = {
    live: t('create.status.live'),
    pending: t('create.status.pending'),
    hidden: t('create.status.hidden'),
    removed: t('create.status.removed'),
  };
  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      <Text variant="display" accessibilityRole="header">
        {t('create.title')}
      </Text>
      <Text muted>{t('create.intro')}</Text>
      <Button label={t('create.new')} onPress={() => router.push('/create/new')} />
      <Button
        variant="ghost"
        label={t('create.guidelines')}
        onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'guidelines' } })}
      />
      <Text variant="heading" accessibilityRole="header">
        {t('create.mine')}
      </Text>
    </View>
  );

  if (posts.isLoading || !uid) return <LoadingState />;
  if (posts.isError) return <ErrorState onRetry={() => void posts.refetch()} />;
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={posts.data ?? []}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={header}
        ListEmptyComponent={<Text muted>{t('create.mineEmpty')}</Text>}
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        refreshing={posts.isRefetching}
        onRefresh={() => void posts.refetch()}
        renderItem={({ item }) => {
          const kind = kindOf(item.type, item.format);
          const k = kindColors(kind);
          const status = postStatus(item);
          return (
            <Card style={{ gap: space.sm }}>
              <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
                <Pill
                  label={t(kindLabelKey(kind, item.format)).toUpperCase()}
                  fg={k.fg}
                  bg={k.bg}
                />
                <Pill
                  label={label[status]}
                  fg={
                    status === 'live'
                      ? colors.success
                      : status === 'pending'
                        ? colors.text
                        : colors.danger
                  }
                  bg={
                    status === 'live'
                      ? colors.successBg
                      : status === 'pending'
                        ? colors.surfaceAlt
                        : colors.dangerBg
                  }
                />
              </View>
              <Text variant="heading">{item.title}</Text>
              <View style={{ flexDirection: 'row' }}>
                <Button
                  variant="secondary"
                  label={t('create.delete')}
                  onPress={() => remove(item.id)}
                />
              </View>
            </Card>
          );
        }}
      />
      <Toast message={notice} />
    </SafeAreaView>
  );
}
