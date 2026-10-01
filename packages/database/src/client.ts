import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface PublicSupabaseConfig {
  url: string;
  anonKey: string;
}

/** Decode a JWT payload without verifying (only to refuse privileged keys on the client). */
function jwtRole(token: string): string | null {
  try {
    const p = token.split('.')[1];
    if (!p) return null;
    const json =
      typeof atob === 'function'
        ? atob(p.replace(/-/g, '+').replace(/_/g, '/'))
        : Buffer.from(p, 'base64url').toString('utf8');
    return (JSON.parse(json) as { role?: string }).role ?? null;
  } catch {
    return null;
  }
}

/**
 * Client factory for the MOBILE/ADMIN BROWSER. Refuses a service-role key outright so a misconfigured
 * build can never ship privileged credentials (docs/SECURITY.md).
 */
export function createPublicClient(
  cfg: PublicSupabaseConfig,
  options: Parameters<typeof createClient>[2] = {},
): SupabaseClient {
  if (!cfg.url || !cfg.anonKey) throw new Error('Supabase URL and anon key are required');
  if (
    jwtRole(cfg.anonKey) === 'service_role' ||
    /service[_-]?role/i.test(cfg.anonKey) ||
    cfg.anonKey.startsWith('sb_secret_')
  ) {
    throw new Error(
      'Refusing to create a client with a privileged key. Use the public anon/publishable key only.',
    );
  }
  return createClient(cfg.url, cfg.anonKey, options);
}
