-- Creator video: the app uploads to its OWN prefix of the private `media` bucket and registers a `pending` media_assets row
-- (both already allowed by RLS). Only the server may mark media `ready`; this function is that step for the caller's OWN
-- upload. It checks the object really exists in Storage with the size/type the row claims, so a client cannot publish a
-- row that points at nothing (or at someone else's file: the key must sit under the caller's prefix, enforced by the guard).
create or replace function public.finalize_my_video(p_media_id uuid, p_content_id uuid) returns void
language plpgsql security definer set search_path = public, app, storage as $$
declare m media_assets; o jsonb;
begin
  if auth.uid() is null then raise exception 'forbidden: sign in' using errcode = '42501'; end if;
  select * into m from media_assets where id = p_media_id for update;
  if not found or m.owner_user_id is distinct from auth.uid() then
    raise exception 'forbidden: not your upload' using errcode = '42501';
  end if;
  if not app.owns_content(p_content_id) then
    raise exception 'forbidden: not your content' using errcode = '42501';
  end if;
  if m.status <> 'pending' or m.content_id is not null then
    raise exception 'invalid_state: media already used' using errcode = '22023';
  end if;
  if m.mime_type <> 'video/mp4' or m.variant <> 'original' then
    raise exception 'unsupported_media: only mp4 video' using errcode = '22023';
  end if;
  select metadata into o from storage.objects where bucket_id = m.bucket and name = m.storage_key;
  if not found then raise exception 'upload_missing: file not found in storage' using errcode = '22023'; end if;
  if (o->>'size')::bigint is distinct from m.size_bytes or o->>'mimetype' is distinct from m.mime_type then
    raise exception 'upload_mismatch: stored file differs from the registered one' using errcode = '22023';
  end if;
  update media_assets set content_id = p_content_id, status = 'ready' where id = p_media_id;
end $$;
revoke all on function public.finalize_my_video(uuid, uuid) from public, anon;
grant execute on function public.finalize_my_video(uuid, uuid) to authenticated;
