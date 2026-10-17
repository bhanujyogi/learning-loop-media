import { supabase } from './supabase';

/** How the signed-in user relates to another person. */
export type Relationship =
  'self' | 'friends' | 'request_sent' | 'request_received' | 'following' | 'followed_by' | 'none';

export interface Relation {
  status: Relationship;
  /** id of the pending request addressed to me (when status = request_received) */
  requestId?: string;
}

export async function getRelationship(me: string, other: string): Promise<Relation> {
  if (me === other) return { status: 'self' };
  const [f, r] = await Promise.all([
    supabase
      .from('follows')
      .select('follower_id, followee_id')
      .or(
        `and(follower_id.eq.${me},followee_id.eq.${other}),and(follower_id.eq.${other},followee_id.eq.${me})`,
      ),
    supabase
      .from('friend_requests')
      .select('id, from_user, to_user, status')
      .eq('status', 'pending')
      .or(
        `and(from_user.eq.${me},to_user.eq.${other}),and(from_user.eq.${other},to_user.eq.${me})`,
      ),
  ]);
  const iFollow = !!f.data?.some((x) => x.follower_id === me);
  const theyFollow = !!f.data?.some((x) => x.follower_id === other);
  if (iFollow && theyFollow) return { status: 'friends' };
  const req = r.data?.[0];
  if (req)
    return req.from_user === me
      ? { status: 'request_sent' }
      : { status: 'request_received', requestId: req.id as string };
  if (iFollow) return { status: 'following' };
  if (theyFollow) return { status: 'followed_by' };
  return { status: 'none' };
}

export async function sendFriendRequest(other: string): Promise<'pending' | 'friends'> {
  const { data, error } = await supabase.rpc('send_friend_request', { p_to: other });
  if (error) throw error;
  return data as 'pending' | 'friends';
}
export async function respondFriendRequest(id: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_friend_request', { p_id: id, p_accept: accept });
  if (error) throw error;
}
export async function follow(me: string, other: string): Promise<void> {
  const { error } = await supabase.from('follows').insert({ follower_id: me, followee_id: other });
  if (error && error.code !== '23505') throw error;
}
export async function unfollow(me: string, other: string): Promise<void> {
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', me)
    .eq('followee_id', other);
  if (error) throw error;
}

/** Content a message shares is a plain token the chat screen renders as a card. */
export const SHARE_PREFIX = 'll:content:';
export const shareToken = (contentId: string) => `${SHARE_PREFIX}${contentId}`;
export const parseShareToken = (body: string): string | null =>
  body.startsWith(SHARE_PREFIX) && /^[0-9a-f-]{36}$/i.test(body.slice(SHARE_PREFIX.length).trim())
    ? body.slice(SHARE_PREFIX.length).trim()
    : null;
