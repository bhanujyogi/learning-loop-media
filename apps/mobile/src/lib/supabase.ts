import { createPublicClient } from '@learning-loop/database/client';
import { AppState } from 'react-native';
import { env } from './env';
import { secureStorage } from './secure-storage';

export const supabase = createPublicClient(
  {
    url: env.supabaseUrl || 'http://127.0.0.1:54321',
    anonKey: env.supabaseAnonKey || 'public-anon-key-not-configured',
  },
  {
    auth: {
      storage: secureStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

// Only refresh tokens while the app is foregrounded.
AppState.addEventListener('change', (s) => {
  if (s === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
