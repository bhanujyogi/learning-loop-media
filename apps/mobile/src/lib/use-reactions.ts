import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth';
import { track } from './event-queue';
import { mergeFetched, settleWrite, toggled, unseen } from './reactions';
import { supabase } from './supabase';

type Table = 'likes' | 'saves';

/**
 * Like / save / follow state for a set of content (and creators), loaded from the database (RLS: own rows only) so initial
 * state is real, with optimistic toggles that roll back on failure. Writes go through the same RLS policies as anywhere else.
 */
export function useReactions(contentIds: string[], creatorIds: string[], onError: () => void) {
  const { session } = useAuth();
  const uid = session?.user.id;
  const qc = useQueryClient();
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const asked = useRef({ content: new Set<string>(), creators: new Set<string>() });
  const inflight = useRef(new Set<string>());

  const contentKey = contentIds.join(',');
  const creatorKey = creatorIds.join(',');
  useEffect(() => {
    if (!uid) return;
    const c = unseen(contentIds, asked.current.content);
    const f = unseen(creatorIds, asked.current.creators);
    c.forEach((i) => asked.current.content.add(i));
    f.forEach((i) => asked.current.creators.add(i));
    const pendingOf = (prefix: string) =>
      new Set(
        [...inflight.current]
          .filter((k) => k.startsWith(prefix))
          .map((k) => k.slice(prefix.length)),
      );
    (async () => {
      if (c.length) {
        const [l, s] = await Promise.all([
          supabase.from('likes').select('content_id').eq('user_id', uid).in('content_id', c),
          supabase.from('saves').select('content_id').eq('user_id', uid).in('content_id', c),
        ]);
        if (l.error || s.error) throw new Error('lookup');
        setLiked((cur) =>
          mergeFetched(
            cur,
            l.data.map((r) => r.content_id as string),
            pendingOf('likes:'),
            c,
          ),
        );
        setSaved((cur) =>
          mergeFetched(
            cur,
            s.data.map((r) => r.content_id as string),
            pendingOf('saves:'),
            c,
          ),
        );
      }
      if (f.length) {
        const r = await supabase
          .from('follows')
          .select('followee_id')
          .eq('follower_id', uid)
          .in('followee_id', f);
        if (r.error) throw new Error('lookup');
        setFollowed((cur) =>
          mergeFetched(
            cur,
            r.data.map((x) => x.followee_id as string),
            pendingOf('f:'),
            f,
          ),
        );
      }
    })().catch(() => {
      // lookup failed: forget that we asked so the next render/batch retries, instead of showing a wrong "off" forever
      c.forEach((i) => asked.current.content.delete(i));
      f.forEach((i) => asked.current.creators.delete(i));
    });
  }, [uid, contentKey, creatorKey]);

  const toggleContent = useCallback(
    async (table: Table, id: string, recommendationId?: string) => {
      if (!uid || inflight.current.has(`${table}:${id}`)) return;
      const set = table === 'likes' ? liked : saved;
      const setter = table === 'likes' ? setLiked : setSaved;
      const on = set.has(id);
      inflight.current.add(`${table}:${id}`);
      setter((cur) => toggled(cur, id));
      const { error } = on
        ? await supabase.from(table).delete().eq('user_id', uid).eq('content_id', id)
        : await supabase.from(table).insert({ user_id: uid, content_id: id });
      inflight.current.delete(`${table}:${id}`);
      const outcome = settleWrite(on ? 'remove' : 'add', error);
      if (outcome === 'failed') {
        setter((cur) => toggled(cur, id));
        onError();
        return;
      }
      if (table === 'saves') {
        // keep the Saved list and the profile's saved count in step (they are cached queries)
        void qc.invalidateQueries({ queryKey: ['saved', uid] });
        void qc.invalidateQueries({ queryKey: ['profile-stats', uid] });
      }
      if (outcome === 'already') return; // already on: no second engagement event
      const name = table === 'likes' ? (on ? 'unlike' : 'like') : on ? 'unsave' : 'save';
      track(name, { content_id: id, recommendation_id: recommendationId });
    },
    [uid, liked, saved, onError, qc],
  );

  const toggleFollow = useCallback(
    async (creatorId: string) => {
      if (!uid || creatorId === uid || inflight.current.has(`f:${creatorId}`)) return;
      const on = followed.has(creatorId);
      inflight.current.add(`f:${creatorId}`);
      setFollowed((cur) => toggled(cur, creatorId));
      const { error } = on
        ? await supabase
            .from('follows')
            .delete()
            .eq('follower_id', uid)
            .eq('followee_id', creatorId)
        : await supabase.from('follows').insert({ follower_id: uid, followee_id: creatorId });
      inflight.current.delete(`f:${creatorId}`);
      if (error) {
        setFollowed((cur) => toggled(cur, creatorId));
        onError();
        return;
      }
      track(on ? 'unfollow' : 'follow', { creator_id: creatorId });
    },
    [uid, followed, onError],
  );

  return {
    uid,
    liked,
    saved,
    followed,
    toggleLike: (id: string, rec?: string) => toggleContent('likes', id, rec),
    toggleSave: (id: string, rec?: string) => toggleContent('saves', id, rec),
    toggleFollow,
  };
}
