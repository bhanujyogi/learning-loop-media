import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { createVideoPlayer } from 'expo-video';
import type { PickedVideo } from './creator-form';
import { supabase } from './supabase';
import { uuid } from './uuid';

/** Opens the phone's own file picker (no storage permission needed). Returns undefined if the user cancels. */
export async function pickVideo(): Promise<PickedVideo | undefined> {
  const r = await DocumentPicker.getDocumentAsync({
    type: 'video/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  const a = r.canceled ? undefined : r.assets[0];
  if (!a) return undefined;
  return { uri: a.uri, name: a.name, size: a.size ?? 0, mimeType: a.mimeType ?? '' };
}

/** Length in ms read from the file itself (display only); falls back to 30 s if the player can't tell in time. */
async function durationMs(uri: string): Promise<number> {
  const player = createVideoPlayer(uri);
  try {
    for (let i = 0; i < 20; i++) {
      if (player.duration > 0)
        return Math.min(Math.max(Math.round(player.duration * 1000), 1000), 15 * 60_000);
      await new Promise((r) => setTimeout(r, 200));
    }
    return 30_000;
  } finally {
    player.release();
  }
}

/**
 * Uploads to the caller's OWN folder of the private bucket and registers it as `pending`; the server (create-content →
 * finalize_my_video) verifies the stored file before the post goes live. Nothing here can mark media ready.
 */
export async function uploadVideo(
  v: PickedVideo,
  userId: string,
  /** when the length is already known (bulk import manifest) the file is not opened in a player */
  knownDurationMs?: number,
): Promise<{ mediaId: string; durationMs: number }> {
  const bytes = await new File(v.uri).arrayBuffer();
  const key = `${userId}/${uuid()}.mp4`;
  const up = await supabase.storage.from('media').upload(key, bytes, { contentType: 'video/mp4' });
  if (up.error) throw up.error;
  const duration = knownDurationMs ?? (await durationMs(v.uri));
  const { data, error } = await supabase
    .from('media_assets')
    .insert({
      owner_user_id: userId,
      bucket: 'media',
      storage_key: key,
      mime_type: 'video/mp4',
      size_bytes: bytes.byteLength,
      duration_ms: duration,
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('register_failed');
  return { mediaId: data.id as string, durationMs: duration };
}
