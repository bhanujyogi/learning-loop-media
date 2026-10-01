import { AIService } from '@learning-loop/ai';
import { isEnabled } from '@learning-loop/config';
import { useQuery } from '@tanstack/react-query';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { Button, Card, LoadingState, Text } from '../../ui/primitives';

// No native inference runtime is bundled yet, so this reports the truth instead of faking an assistant.
const ai = new AIService({
  provider: null,
  enabled: isEnabled('local_ai'),
  device: async () => ({
    totalMemoryMB: 0,
    freeStorageMB: 0,
    cpuCores: 0,
    isLowPowerMode: false,
    platform: 'other',
  }),
  installedModelIds: async () => [],
});

export default function Profile() {
  const { colors } = useTheme();
  const { session } = useAuth();
  const uid = session!.user.id;
  const profile = useQuery({
    queryKey: ['profile', uid],
    queryFn: async () =>
      (await supabase.from('profiles').select('username, display_name').eq('id', uid).single())
        .data,
  });
  const aiStatus = useQuery({ queryKey: ['ai-availability'], queryFn: () => ai.availability() });
  if (profile.isLoading) return <LoadingState />;
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <Text variant="title" accessibilityRole="header">
          @{profile.data?.username}
        </Text>
        <Card style={{ gap: space.xs }}>
          <Text variant="heading">On-device AI assistant</Text>
          <Text muted>
            {aiStatus.data && !aiStatus.data.available ? aiStatus.data.detail : 'Ready.'}
          </Text>
          <Text variant="caption" muted>
            Runs entirely on your device. Your questions are never sent to a cloud AI service.
          </Text>
        </Card>
        <Button variant="secondary" label="Sign out" onPress={() => supabase.auth.signOut()} />
      </ScrollView>
    </SafeAreaView>
  );
}
