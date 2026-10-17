import { useQuery } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { parseConversations, type ChatPerson, type ConversationRow } from './chat-model';
import { mutualIds } from './chat-model';
import { supabase } from './supabase';

/** Data access for the chat screens (all authorization is enforced by RLS / RPCs in Postgres). */

export async function fetchConversations(): Promise<ConversationRow[]> {
  const { data, error } = await supabase.rpc('my_conversations');
  if (error) throw error;
  return parseConversations(data);
}

/** Inbox query; polls while the screen is focused. */
export function useConversations(uid: string | undefined, intervalMs: number | false = 5000) {
  const focused = useIsFocused();
  return useQuery({
    queryKey: ['conversations', uid],
    enabled: !!uid,
    queryFn: fetchConversations,
    refetchInterval: focused ? intervalMs : false,
  });
}

const toPerson = (p: {
  id: string;
  username: string;
  display_name: string | null;
  avatar_path: string | null;
}): ChatPerson => ({
  id: p.id,
  username: p.username,
  displayName: p.display_name,
  avatarPath: p.avatar_path,
});

export async function fetchProfiles(ids: string[]): Promise<ChatPerson[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_path')
    .in('id', ids);
  if (error) throw error;
  return (data ?? []).map(toPerson);
}

/** Friends = mutual follows: query both directions, intersect, join profiles. */
export async function fetchFriends(me: string): Promise<ChatPerson[]> {
  const [a, b] = await Promise.all([
    supabase.from('follows').select('followee_id').eq('follower_id', me),
    supabase.from('follows').select('follower_id').eq('followee_id', me),
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  const ids = mutualIds(
    (a.data ?? []).map((r) => r.followee_id as string),
    (b.data ?? []).map((r) => r.follower_id as string),
  );
  const people = await fetchProfiles(ids);
  return people.sort((x, y) =>
    (x.displayName ?? x.username).localeCompare(y.displayName ?? y.username),
  );
}

export function useFriends(uid: string | undefined) {
  return useQuery({
    queryKey: ['friends', uid],
    enabled: !!uid,
    queryFn: () => fetchFriends(uid!),
  });
}

export interface RequestRow {
  id: string;
  person: ChatPerson;
}
export interface FriendRequests {
  incoming: RequestRow[];
  sent: RequestRow[];
}
export async function fetchFriendRequests(me: string): Promise<FriendRequests> {
  const { data, error } = await supabase
    .from('friend_requests')
    .select('id, from_user, to_user, status, created_at')
    .eq('status', 'pending')
    .or(`from_user.eq.${me},to_user.eq.${me}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  const other = (r: { from_user: string; to_user: string }) =>
    r.from_user === me ? r.to_user : r.from_user;
  const people = new Map(
    (await fetchProfiles([...new Set(rows.map(other))])).map((p) => [p.id, p] as const),
  );
  const build = (r: (typeof rows)[number]): RequestRow | null => {
    const person = people.get(other(r));
    return person ? { id: r.id as string, person } : null;
  };
  const clean = (x: (RequestRow | null)[]) => x.filter((v): v is RequestRow => !!v);
  return {
    incoming: clean(rows.filter((r) => r.to_user === me).map(build)),
    sent: clean(rows.filter((r) => r.from_user === me).map(build)),
  };
}

export function useFriendRequests(uid: string | undefined, intervalMs: number | false = 15000) {
  const focused = useIsFocused();
  return useQuery({
    queryKey: ['friend-requests', uid],
    enabled: !!uid,
    queryFn: () => fetchFriendRequests(uid!),
    refetchInterval: focused ? intervalMs : false,
  });
}

export async function startDirect(other: string): Promise<string> {
  const { data, error } = await supabase.rpc('start_direct_conversation', { p_other: other });
  if (error) throw error;
  return data as string;
}
