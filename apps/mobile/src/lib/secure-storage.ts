import * as SecureStore from 'expo-secure-store';

/**
 * Supabase auth storage backed by the OS keychain/keystore. SecureStore values are size-limited on some
 * platforms, so large session JSON is stored in chunks.
 */
const CHUNK = 1800;
const key = (k: string, i: number) => `${k.replace(/[^A-Za-z0-9._-]/g, '_')}.${i}`;

export const secureStorage = {
  async getItem(k: string): Promise<string | null> {
    const count = await SecureStore.getItemAsync(key(k, -1));
    if (!count) return null;
    const parts: string[] = [];
    for (let i = 0; i < Number(count); i++) {
      const p = await SecureStore.getItemAsync(key(k, i));
      if (p == null) return null;
      parts.push(p);
    }
    return parts.join('');
  },
  async setItem(k: string, value: string): Promise<void> {
    await secureStorage.removeItem(k);
    const n = Math.ceil(value.length / CHUNK) || 1;
    for (let i = 0; i < n; i++)
      await SecureStore.setItemAsync(key(k, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
    await SecureStore.setItemAsync(key(k, -1), String(n));
  },
  async removeItem(k: string): Promise<void> {
    const count = await SecureStore.getItemAsync(key(k, -1));
    for (let i = 0; i < Number(count ?? 0); i++) await SecureStore.deleteItemAsync(key(k, i));
    await SecureStore.deleteItemAsync(key(k, -1));
  },
};
