import { useQuery } from '@tanstack/react-query';
import { useAuth } from './auth';
import { supabase } from './supabase';

export interface Account {
  onboarded: boolean;
  /** `profiles.locale` — the single learner language preference. */
  locale: string | null;
  username: string | null;
  displayName: string | null;
}
export const accountKey = (uid: string | undefined) => ['account', uid] as const;

/** Onboarding status + language preference for the signed-in user (RLS: own rows only). Shared by routing and i18n. */
export function useAccount() {
  const { session } = useAuth();
  const uid = session?.user.id;
  return useQuery({
    queryKey: accountKey(uid),
    enabled: !!uid,
    queryFn: async (): Promise<Account> => {
      const [lp, p] = await Promise.all([
        supabase
          .from('learner_profiles')
          .select('onboarding_completed')
          .eq('user_id', uid!)
          .maybeSingle(),
        supabase.from('profiles').select('locale, username, display_name').eq('id', uid!).single(),
      ]);
      if (lp.error || p.error) throw new Error('account');
      return {
        onboarded: lp.data?.onboarding_completed ?? false,
        locale: p.data.locale,
        username: p.data.username,
        displayName: p.data.display_name,
      };
    },
  });
}
