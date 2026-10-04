import { DEFAULT_LOCALE, type Locale } from '@learning-loop/shared';
import { useQueryClient } from '@tanstack/react-query';
import Storage from 'expo-sqlite/kv-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { accountKey, useAccount, type Account } from '../lib/account';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { resolveLocale, translate, type MessageKey, type Params, type PluralKey } from './core';

const KEY = 'll.locale.v1';
const readStored = (): string | null => {
  try {
    return Storage.getItemSync(KEY);
  } catch {
    return null;
  }
};
const writeStored = (l: Locale) => {
  try {
    Storage.setItemSync(KEY, l);
  } catch {
    /* storage unavailable: preference lives for this session only */
  }
};
const deviceLocale = (): string | null => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return null;
  }
};

type T = (key: MessageKey | PluralKey, params?: Params & { count?: number }) => string;
interface I18n {
  locale: Locale;
  t: T;
  /** Saves the preference locally and (when signed in) to profiles.locale. Resolves false if the account write failed. */
  setLocale: (l: Locale) => Promise<boolean>;
}
const Ctx = createContext<I18n>({
  locale: DEFAULT_LOCALE,
  t: (k, p) => translate(DEFAULT_LOCALE, k, p),
  setLocale: async () => true,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const account = useAccount();
  const [stored, setStored] = useState<string | null>(readStored);
  const locale = resolveLocale({
    onboarded: account.data?.onboarded ?? false,
    profileLocale: account.data?.locale,
    storedLocale: stored,
    deviceLocale: deviceLocale(),
  });
  // Keep the on-device copy in step with the account so the sign-in screen opens in the learner's language next time.
  useEffect(() => {
    if (account.data?.onboarded && account.data.locale === locale) writeStored(locale);
  }, [account.data, locale]);

  const uid = session?.user.id;
  const setLocale = useCallback(
    async (l: Locale) => {
      writeStored(l);
      setStored(l);
      if (!uid) return true;
      // Optimistic cache update so the UI switches immediately; roll back if the account write fails.
      const prev = qc.getQueryData<Account>(accountKey(uid));
      if (prev) qc.setQueryData<Account>(accountKey(uid), { ...prev, locale: l });
      const { error } = await supabase.from('profiles').update({ locale: l }).eq('id', uid);
      if (error) {
        if (prev) qc.setQueryData<Account>(accountKey(uid), prev);
        return false;
      }
      return true;
    },
    [uid, qc],
  );
  const value = useMemo<I18n>(
    () => ({ locale, t: (k, p) => translate(locale, k, p), setLocale }),
    [locale, setLocale],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useI18n = () => useContext(Ctx);
