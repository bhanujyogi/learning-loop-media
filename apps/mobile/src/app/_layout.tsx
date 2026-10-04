import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nProvider, useI18n } from '../i18n/I18nProvider';
import { useAccount } from '../lib/account';
import { AuthProvider, useAuth } from '../lib/auth';
import { isConfigured } from '../lib/env';
import { useTheme } from '../theme/useTheme';
import { EmptyState, ErrorState, LoadingState } from '../ui/primitives';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

/**
 * Routing gate: unauthenticated → /sign-in; authenticated but not onboarded → /onboarding; otherwise the app.
 * This is UX only. Authorization is enforced in Postgres (RLS) and the Edge Functions, never by this redirect.
 */
function Gate() {
  const { session, loading } = useAuth();
  const { t } = useI18n();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const segments = useSegments();
  const router = useRouter();
  const account = useAccount();
  const uid = session?.user.id;
  const first = segments[0] as string | undefined;

  // A different user (or sign-out) must never see the previous user's cached rows.
  const lastUid = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (lastUid.current !== uid) {
      if (lastUid.current !== undefined || uid === undefined) qc.clear();
      lastUid.current = uid;
    }
  }, [uid, qc]);

  useEffect(() => {
    if (loading) return;
    if (!session) {
      if (first !== 'sign-in') router.replace('/sign-in');
    } else if (account.isSuccess) {
      if (!account.data.onboarded && first !== 'onboarding') router.replace('/onboarding');
      else if (account.data.onboarded && (first === 'sign-in' || first === 'onboarding'))
        router.replace('/');
    }
  }, [loading, session, account.isSuccess, account.data?.onboarded, first, router]);

  if (!isConfigured())
    return <EmptyState glyph="🔧" title={t('config.title')} message={t('config.body')} />;
  if (loading || (session && account.isLoading)) return <LoadingState />;
  if (session && account.isError)
    return <ErrorState offline onRetry={() => void account.refetch()} />;
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
      <Stack.Screen name="content/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="saved" />
      <Stack.Screen name="user/[id]" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <I18nProvider>
            <StatusBar style="auto" />
            <Gate />
          </I18nProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
