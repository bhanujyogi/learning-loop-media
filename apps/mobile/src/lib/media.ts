import { useEffect, useState } from 'react';
import { env } from './env';
import { supabase } from './supabase';

/** Public URL of a profile picture (the `avatars` bucket is public; the path is `<user id>/<file>`). */
export const avatarUrl = (path: string | null | undefined): string | null =>
  path ? `${env.supabaseUrl}/storage/v1/object/public/avatars/${path}` : null;

/** Resolves a media_assets id to a short-lived signed URL (private bucket; RLS decides what the user may read). */
export function useMediaUrl(mediaId: string | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!mediaId) return;
    let live = true;
    (async () => {
      const { data: m } = await supabase
        .from('media_assets')
        .select('bucket, storage_key')
        .eq('id', mediaId)
        .maybeSingle();
      if (!m) {
        if (live) setFailed(true);
        return;
      }
      const { data, error } = await supabase.storage
        .from(m.bucket)
        .createSignedUrl(m.storage_key, 3600);
      if (live) {
        if (error || !data) setFailed(true);
        else setUrl(data.signedUrl);
      }
    })().catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [mediaId]);
  return { url, failed };
}
