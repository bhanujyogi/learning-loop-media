import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { supabase } from './supabase';
import { uuid } from './uuid';

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 3 * 1024 * 1024;

export interface PickedFile {
  uri: string;
  name: string;
  size: number;
  mimeType: string;
}

const ext = (mime: string) =>
  mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';

/** Opens the phone's own picker (no storage permission needed). Returns [] if cancelled. */
export async function pickImages(multiple = true): Promise<PickedFile[]> {
  const r = await DocumentPicker.getDocumentAsync({
    type: ['image/jpeg', 'image/png', 'image/webp'],
    multiple,
    copyToCacheDirectory: true,
  });
  if (r.canceled) return [];
  return r.assets.map((a) => ({
    uri: a.uri,
    name: a.name,
    size: a.size ?? 0,
    mimeType: a.mimeType ?? '',
  }));
}

/** Why a picked image can't be used (null = fine). */
export const imageProblem = (f: PickedFile, max = MAX_IMAGE_BYTES): 'type' | 'size' | null =>
  !(IMAGE_TYPES as readonly string[]).includes(f.mimeType)
    ? 'type'
    : f.size <= 0 || f.size > max
      ? 'size'
      : null;

/**
 * Uploads an image to the caller's OWN folder of the private `media` bucket and registers it as `pending`.
 * `create-content` verifies the stored file before the post goes live; nothing here can mark media ready.
 */
export async function uploadPostImage(f: PickedFile, userId: string): Promise<string> {
  const bytes = await new File(f.uri).arrayBuffer();
  const key = `${userId}/${uuid()}.${ext(f.mimeType)}`;
  const up = await supabase.storage.from('media').upload(key, bytes, { contentType: f.mimeType });
  if (up.error) throw up.error;
  const { data, error } = await supabase
    .from('media_assets')
    .insert({
      owner_user_id: userId,
      bucket: 'media',
      storage_key: key,
      mime_type: f.mimeType,
      size_bytes: bytes.byteLength,
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('register_failed');
  return data.id as string;
}

/** Uploads a profile picture to the public `avatars` bucket (own folder) and points the profile at it. Returns the new path. */
export async function uploadAvatar(f: PickedFile, userId: string): Promise<string> {
  const bytes = await new File(f.uri).arrayBuffer();
  const path = `${userId}/${uuid()}.${ext(f.mimeType)}`;
  const up = await supabase.storage
    .from('avatars')
    .upload(path, bytes, { contentType: f.mimeType });
  if (up.error) throw up.error;
  const { error } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', userId);
  if (error) throw error;
  return path;
}
