/**
 * Public client configuration ONLY. Anything privileged (service-role key, DB URL, publishing credentials)
 * must never appear here: Expo inlines EXPO_PUBLIC_* variables into the app bundle.
 */
export const env = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
};
export const isConfigured = () => !!env.supabaseUrl && !!env.supabaseAnonKey;
