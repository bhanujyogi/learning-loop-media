-- Storage buckets (Supabase Storage is the MVP StorageProvider; app code only knows media_assets rows).
-- Private bucket: objects are read via short-lived signed URLs. Writes are owner-scoped by path prefix <user_id>/...

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('media', 'media', false, 209715200,
   array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm','audio/mpeg','audio/mp4','audio/ogg','audio/wav','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy media_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and name like auth.uid()::text || '/%');
create policy media_objects_update_own on storage.objects for update to authenticated
  using (bucket_id = 'media' and name like auth.uid()::text || '/%') with check (bucket_id = 'media' and name like auth.uid()::text || '/%');
create policy media_objects_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'media' and name like auth.uid()::text || '/%');
-- Read: your own uploads, or media attached to content you can see (visibility is enforced by content_items RLS in the subquery).
create policy media_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'media' and (
    name like auth.uid()::text || '/%'
    or exists (select 1 from public.media_assets m join public.content_items c on c.id = m.content_id
               where m.bucket = 'media' and m.storage_key = storage.objects.name and m.status = 'ready')));
