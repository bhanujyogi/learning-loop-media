import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

export interface Author {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarPath: string | null;
}

// Cards ask for their author one by one while the list renders; ids asked within a few ms go out as ONE request.
const waiting = new Map<string, ((a: Author | null | 'error') => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  timer = null;
  const batch = [...waiting.entries()];
  waiting.clear();
  if (!batch.length) return;
  const ids = batch.map(([id]) => id);
  let rows: Author[] = [];
  let failed = false;
  try {
    // RLS: profiles are readable by signed-in users
    const r = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_path')
      .in('id', ids);
    if (r.error) failed = true;
    else
      rows = (r.data ?? []).map((p) => ({
        id: p.id as string,
        username: (p.username as string | null) ?? null,
        displayName: (p.display_name as string | null) ?? null,
        avatarPath: (p.avatar_path as string | null) ?? null,
      }));
  } catch {
    failed = true;
  }
  for (const [id, resolvers] of batch) {
    const found = rows.find((x) => x.id === id) ?? null;
    resolvers.forEach((res) => res(failed ? 'error' : found));
  }
}

function loadAuthor(id: string): Promise<Author | null | 'error'> {
  return new Promise((resolve) => {
    waiting.set(id, [...(waiting.get(id) ?? []), resolve]);
    timer ??= setTimeout(() => void flush(), 20);
  });
}

/** Author profile of a post, cached per user id (react-query) and fetched in batches for the visible cards. */
export function useAuthor(userId: string | null | undefined) {
  return useQuery({
    queryKey: ['author', userId],
    enabled: !!userId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const a = await loadAuthor(userId!);
      if (a === 'error') throw new Error('author'); // not cached as "unknown": react-query retries
      return a;
    },
  });
}

/** Name shown on a card: @username, else the display name; null when neither is known. */
export const authorName = (a: Author | null | undefined): string | null =>
  a?.username ? `@${a.username}` : a?.displayName?.trim() || null;
