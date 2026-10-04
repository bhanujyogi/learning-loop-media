-- Direct messaging foundation. Conversations are created ONLY via start_direct_conversation() so that
-- block lists, recipient privacy (dm_policy), restrictions and rate limits cannot be bypassed by raw client calls.

create table conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'direct' check (kind in ('direct','group')),
  direct_key text unique,                       -- "<smaller uuid>:<larger uuid>" dedupes 1:1 threads
  created_by uuid references auth.users(id),
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);
create table conversation_members (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null default 'member' check (member_role in ('member','admin')),
  last_read_at timestamptz,
  left_at timestamptz,
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on conversation_members (user_id) where left_at is null;
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index messages_conv_idx on messages (conversation_id, created_at desc);
create table message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('spam','harassment','inappropriate','other')),
  details text check (details is null or length(details) <= 1000),
  created_at timestamptz not null default now(),
  unique (message_id, reporter_id)
);

create or replace function app.is_member(p_conv uuid) returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from conversation_members where conversation_id = p_conv and user_id = auth.uid() and left_at is null)
$$;

create or replace function public.start_direct_conversation(p_other uuid) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare me uuid := auth.uid(); k text; cid uuid; pol text; follows_me boolean;
begin
  if me is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_other is null or p_other = me then raise exception 'invalid recipient'; end if;
  if exists (select 1 from profiles where id = me and account_state <> 'active') then raise exception 'account not active' using errcode = '42501'; end if;
  if exists (select 1 from creator_restrictions r where r.user_id = me and r.kind in ('no_message','suspended') and (r.until is null or r.until > now())) then
    raise exception 'messaging restricted' using errcode = '42501'; end if;
  if app.is_blocked_between(me, p_other) then raise exception 'forbidden' using errcode = '42501'; end if;
  select dm_policy into pol from profiles where id = p_other and account_state = 'active';
  if pol is null then raise exception 'recipient unavailable'; end if;
  follows_me := exists (select 1 from follows where follower_id = p_other and followee_id = me)
             or exists (select 1 from follows where follower_id = me and followee_id = p_other);
  if pol = 'nobody' or (pol = 'followers' and not follows_me) then raise exception 'recipient does not accept messages from you' using errcode = '42501'; end if;
  k := least(me::text, p_other::text) || ':' || greatest(me::text, p_other::text);
  select id into cid from conversations where direct_key = k;
  if cid is null then
    insert into conversations(kind, direct_key, created_by) values ('direct', k, me) returning id into cid;
    insert into conversation_members(conversation_id, user_id) values (cid, me), (cid, p_other);
  else
    update conversation_members set left_at = null where conversation_id = cid and user_id = me;
  end if;
  return cid;
end $$;
revoke all on function public.start_direct_conversation(uuid) from public;
grant execute on function public.start_direct_conversation(uuid) to authenticated;

create or replace function app.guard_message_insert() returns trigger language plpgsql security definer set search_path = public, app as $$
declare other uuid;
begin
  if not exists (select 1 from conversation_members where conversation_id = new.conversation_id and user_id = new.sender_id and left_at is null) then
    raise exception 'not a member' using errcode = '42501'; end if;
  if exists (select 1 from creator_restrictions r where r.user_id = new.sender_id and r.kind in ('no_message','suspended') and (r.until is null or r.until > now())) then
    raise exception 'messaging restricted' using errcode = '42501'; end if;
  -- blocked users cannot bypass via an old conversation
  for other in select user_id from conversation_members where conversation_id = new.conversation_id and user_id <> new.sender_id loop
    if app.is_blocked_between(new.sender_id, other) then raise exception 'forbidden' using errcode = '42501'; end if;
  end loop;
  perform app.check_rate_limit(new.sender_id, 'message_send');
  update conversations set last_message_at = now() where id = new.conversation_id;
  return new;
end $$;
create trigger messages_guard before insert on messages for each row execute function app.guard_message_insert();

alter table conversations enable row level security;
alter table conversation_members enable row level security;
alter table messages enable row level security;
alter table message_reports enable row level security;

create policy conversations_read on conversations for select to authenticated using (app.is_member(id));
create policy members_read on conversation_members for select to authenticated using (user_id = auth.uid() or app.is_member(conversation_id));
create policy members_update_own on conversation_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy messages_read on messages for select to authenticated using (app.is_member(conversation_id) and deleted_at is null);
create policy messages_insert on messages for insert to authenticated with check (sender_id = auth.uid() and app.is_member(conversation_id));
create policy messages_delete_own on messages for update to authenticated using (sender_id = auth.uid()) with check (sender_id = auth.uid());
create policy message_reports_insert on message_reports for insert to authenticated with check (reporter_id = auth.uid() and exists (select 1 from messages m where m.id = message_id and app.is_member(m.conversation_id)));
create policy message_reports_read on message_reports for select to authenticated using (reporter_id = auth.uid() or app.has_permission('moderation.review'));
-- No direct INSERT on conversations/conversation_members: start_direct_conversation() only.

create or replace function app.guard_message_update() returns trigger language plpgsql as $$
begin
  if new.body is distinct from old.body or new.sender_id is distinct from old.sender_id or new.conversation_id is distinct from old.conversation_id then
    raise exception 'messages are immutable (delete only)' using errcode = '42501'; end if;
  return new;
end $$;
create trigger messages_guard_update before update on messages for each row execute function app.guard_message_update();
