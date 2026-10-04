import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../lib/auth';
import { isConfigured } from '../lib/env';
import { supabase } from '../lib/supabase';
import { EmptyState, LoadingState } from '../ui/primitives';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

function Gate() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const uid = session?.user.id;
  const onboarded = useQuery({
    queryKey: ['onboarded', uid],
    enabled: !!uid,
    queryFn: async () =>
      (
        await supabase
          .from('learner_profiles')
          .select('onboarding_completed')
          .eq('user_id', uid!)
          .maybeSingle()
      ).data?.onboarding_completed ?? false,
  });
  const first = segments[0] as string | undefined;
  useEffect(() => {
    if (loading) return;
    if (!session && first !== 'sign-in') router.replace('/sign-in');
    else if (session && onboarded.isSuccess) {
      if (!onboarded.data && first !== 'onboarding') router.replace('/onboarding');
      else if (onboarded.data && (first === 'sign-in' || first === 'onboarding'))
        router.replace('/');
    }
  }, [loading, session, onboarded.isSuccess, onboarded.data, first, router]);
  if (!isConfigured())
    return (
      <EmptyState
        title="App not configured"
        message="Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (see .env.example)."
      />
    );
  if (loading || (session && onboarded.isLoading)) return <LoadingState />;
  return <Slot />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="auto" />
          <Gate />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
