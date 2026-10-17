-- Community posts: free-text topics, image posts, a catch-all concept, and a generic finaliser for the caller's own uploads.

alter table content_items add column topic_label text check (topic_label is null or length(btrim(topic_label)) between 2 and 80);

-- Catch-all curriculum slot for posts whose topic matches no curriculum concept (the typed topic is kept in topic_label).
insert into subjects(id, slug, name) values ('20000000-0000-0000-0000-000000000099', 'community', 'Community') on conflict do nothing;
insert into chapters(id, subject_id, slug, name) values ('30000000-0000-0000-0000-000000000099', '20000000-0000-0000-0000-000000000099', 'community-posts', 'Community posts') on conflict do nothing;
insert into topics(id, chapter_id, slug, name) values ('40000000-0000-0000-0000-000000000099', '30000000-0000-0000-0000-000000000099', 'community-general', 'Community') on conflict do nothing;
insert into concepts(id, topic_id, slug, name, description, difficulty)
  values ('50000000-0000-0000-0000-000000000999', '40000000-0000-0000-0000-000000000099', 'community-general', 'Community topics', 'Posts from the community on topics outside the curated curriculum.', 0.4)
  on conflict do nothing;

-- finalize_my_media: like finalize_my_video, for videos AND images (the caller's own pending upload, verified in Storage).
create or replace function public.finalize_my_media(p_media_id uuid, p_content_id uuid) returns void
language plpgsql security definer set search_path = public, app, storage as $$
declare m media_assets; o jsonb;
begin
  if app.uid() is null then raise exception 'forbidden: sign in' using errcode = '42501'; end if;
  select * into m from media_assets where id = p_media_id for update;
  if not found or m.owner_user_id is distinct from app.uid() then
    raise exception 'forbidden: not your upload' using errcode = '42501';
  end if;
  if not app.owns_content(p_content_id) then
    raise exception 'forbidden: not your content' using errcode = '42501';
  end if;
  if m.status <> 'pending' or m.content_id is not null then
    raise exception 'invalid_state: media already used' using errcode = '22023';
  end if;
  if m.mime_type not in ('video/mp4','image/jpeg','image/png','image/webp') or m.variant <> 'original' then
    raise exception 'unsupported_media: only mp4 video or jpeg/png/webp images' using errcode = '22023';
  end if;
  select metadata into o from storage.objects where bucket_id = m.bucket and name = m.storage_key;
  if not found then raise exception 'upload_missing: file not found in storage' using errcode = '22023'; end if;
  if (o->>'size')::bigint is distinct from m.size_bytes or o->>'mimetype' is distinct from m.mime_type then
    raise exception 'upload_mismatch: stored file differs from the registered one' using errcode = '22023';
  end if;
  update media_assets set content_id = p_content_id, status = 'ready' where id = p_media_id;
end $$;
revoke all on function public.finalize_my_media(uuid, uuid) from public, anon;
grant execute on function public.finalize_my_media(uuid, uuid) to authenticated;

-- Profile pictures: a PUBLIC bucket (avatars are meant to be seen), writable only inside the owner's own folder.
alter table profiles add column avatar_path text check (avatar_path is null or (length(avatar_path) <= 200 and avatar_path not like '%..%'));
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('avatars', 'avatars', true, 3145728, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and name like app.uid()::text || '/%');
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and name like app.uid()::text || '/%') with check (bucket_id = 'avatars' and name like app.uid()::text || '/%');
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and name like app.uid()::text || '/%');
-- a profile may only point at a file in its own avatar folder
create or replace function app.guard_avatar_path() returns trigger language plpgsql as $$
begin
  if new.avatar_path is not null and new.avatar_path not like new.id::text || '/%' then
    raise exception 'forbidden: avatar must be in your own folder' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_avatar_guard before insert or update on profiles for each row execute function app.guard_avatar_path();

-- ---------------------------------------------------------------- friends
create table friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_user <> to_user)
);
create unique index friend_requests_pending_idx on friend_requests (least(from_user, to_user), greatest(from_user, to_user)) where status in ('pending','accepted');
create index friend_requests_to_idx on friend_requests (to_user, status);
alter table friend_requests enable row level security;
create policy friend_requests_read on friend_requests for select to authenticated using (from_user = app.uid() or to_user = app.uid());
-- no direct writes: send_friend_request / respond_friend_request only

create or replace function public.send_friend_request(p_to uuid) returns text
language plpgsql security definer set search_path = public, app as $$
declare me uuid := app.uid(); r friend_requests;
begin
  if me is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_to is null or p_to = me then raise exception 'invalid recipient'; end if;
  if exists (select 1 from profiles where id = me and account_state <> 'active') then raise exception 'account not active' using errcode = '42501'; end if;
  if app.is_blocked_between(me, p_to) or not exists (select 1 from profiles where id = p_to and account_state = 'active') then
    raise exception 'recipient unavailable' using errcode = '42501'; end if;
  perform app.check_rate_limit(me, 'friend_action');
  select * into r from friend_requests where least(from_user, to_user) = least(me, p_to) and greatest(from_user, to_user) = greatest(me, p_to) and status in ('pending','accepted');
  if found then
    if r.status = 'accepted' then return 'friends'; end if;
    if r.from_user = me then return 'pending'; end if;
    -- they already asked me: sending a request back accepts theirs
    update friend_requests set status = 'accepted', responded_at = now() where id = r.id;
    insert into follows(follower_id, followee_id) values (me, p_to), (p_to, me) on conflict do nothing;
    return 'friends';
  end if;
  insert into friend_requests(from_user, to_user) values (me, p_to);
  return 'pending';
end $$;

create or replace function public.respond_friend_request(p_id uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public, app as $$
declare me uuid := app.uid(); r friend_requests;
begin
  if me is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into r from friend_requests where id = p_id for update;
  if not found or r.to_user <> me or r.status <> 'pending' then raise exception 'request not found' using errcode = '42501'; end if;
  if p_accept then
    if app.is_blocked_between(me, r.from_user) then raise exception 'forbidden' using errcode = '42501'; end if;
    update friend_requests set status = 'accepted', responded_at = now() where id = p_id;
    insert into follows(follower_id, followee_id) values (me, r.from_user), (r.from_user, me) on conflict do nothing;
    return 'friends';
  end if;
  update friend_requests set status = 'declined', responded_at = now() where id = p_id;
  return 'declined';
end $$;
revoke all on function public.send_friend_request(uuid), public.respond_friend_request(uuid, boolean) from public, anon;
grant execute on function public.send_friend_request(uuid), public.respond_friend_request(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- groups (conversations of kind 'group')
alter table conversations add column title text check (title is null or length(btrim(title)) between 1 and 60);
create or replace function app.are_friends(a uuid, b uuid) returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from follows where follower_id = a and followee_id = b) and exists (select 1 from follows where follower_id = b and followee_id = a)
$$;

create or replace function public.create_group(p_title text, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare me uuid := app.uid(); cid uuid; u uuid;
begin
  if me is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 60 then raise exception 'invalid title'; end if;
  if coalesce(array_length(p_members, 1), 0) not between 1 and 49 then raise exception 'a group needs 1 to 49 other members'; end if;
  if exists (select 1 from profiles where id = me and account_state <> 'active') then raise exception 'account not active' using errcode = '42501'; end if;
  if exists (select 1 from creator_restrictions r where r.user_id = me and r.kind in ('no_message','suspended') and (r.until is null or r.until > now())) then
    raise exception 'messaging restricted' using errcode = '42501'; end if;
  perform app.check_rate_limit(me, 'friend_action');
  foreach u in array p_members loop
    if u = me or not app.are_friends(me, u) or app.is_blocked_between(me, u) then
      raise exception 'you can only add friends' using errcode = '42501'; end if;
  end loop;
  insert into conversations(kind, created_by, title) values ('group', me, btrim(p_title)) returning id into cid;
  insert into conversation_members(conversation_id, user_id, member_role) values (cid, me, 'admin');
  insert into conversation_members(conversation_id, user_id) select cid, x from (select distinct unnest(p_members) x) s;
  return cid;
end $$;

create or replace function public.add_group_member(p_conv uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare me uuid := app.uid();
begin
  if me is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not exists (select 1 from conversations c join conversation_members m on m.conversation_id = c.id
                 where c.id = p_conv and c.kind = 'group' and m.user_id = me and m.member_role = 'admin' and m.left_at is null) then
    raise exception 'only a group admin can add people' using errcode = '42501'; end if;
  if not app.are_friends(me, p_user) or app.is_blocked_between(me, p_user) then raise exception 'you can only add friends' using errcode = '42501'; end if;
  if (select count(*) from conversation_members where conversation_id = p_conv and left_at is null) >= 50 then raise exception 'group is full'; end if;
  insert into conversation_members(conversation_id, user_id) values (p_conv, p_user)
    on conflict (conversation_id, user_id) do update set left_at = null;
end $$;
revoke all on function public.create_group(text, uuid[]), public.add_group_member(uuid, uuid) from public, anon;
grant execute on function public.create_group(text, uuid[]), public.add_group_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- inbox
create or replace function public.my_conversations() returns jsonb
language sql stable security definer set search_path = public, app as $$
  select coalesce(jsonb_agg(row order by sort_at desc nulls last), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', c.id, 'kind', c.kind, 'title', c.title, 'lastMessageAt', c.last_message_at,
      'lastBody', (select left(m.body, 120) from messages m where m.conversation_id = c.id and m.deleted_at is null order by m.created_at desc limit 1),
      'unread', (select count(*) from messages m where m.conversation_id = c.id and m.deleted_at is null and m.sender_id <> app.uid() and m.created_at > coalesce(me.last_read_at, 'epoch')),
      'members', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'displayName', p.display_name, 'avatarPath', p.avatar_path)), '[]'::jsonb)
                  from conversation_members cm join profiles p on p.id = cm.user_id where cm.conversation_id = c.id and cm.left_at is null and cm.user_id <> app.uid())
    ) as row, coalesce(c.last_message_at, c.created_at) as sort_at
    from conversations c join conversation_members me on me.conversation_id = c.id and me.user_id = app.uid() and me.left_at is null
  ) s
$$;
revoke all on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;
