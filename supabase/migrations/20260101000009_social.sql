-- Social layer: follows, likes, saves, comments, shares, notifications, content stats.

create table follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followee_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id), check (follower_id <> followee_id)
);
create index follows_followee_idx on follows (followee_id);
create table likes (
  user_id uuid not null references auth.users(id) on delete cascade,
  content_id uuid not null references content_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, content_id)
);
create index likes_content_idx on likes (content_id);
create table saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  content_id uuid not null references content_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, content_id)
);
create index saves_user_idx on saves (user_id, created_at desc);
create table shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_id uuid not null references content_items(id) on delete cascade,
  channel text not null default 'link' check (channel in ('link','dm','external')),
  created_at timestamptz not null default now()
);
create table comments (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references content_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references comments(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 2000),
  status text not null default 'published' check (status in ('published','removed')),
  created_at timestamptz not null default now()
);
create index comments_content_idx on comments (content_id, created_at desc);

create table notification_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('social','learning_reminder','review_due','achievement','course','creator','moderation','system')),
  enabled boolean not null default true,
  primary key (user_id, category)
);
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  kind text not null,
  payload jsonb not null default '{}',
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on notifications (user_id, created_at desc);

-- Denormalised read model (counts) maintained by triggers; platform learning stats by analytics jobs.
create table content_stats (
  content_id uuid primary key references content_items(id) on delete cascade,
  like_count int not null default 0, save_count int not null default 0, comment_count int not null default 0, share_count int not null default 0,
  impressions bigint not null default 0, views bigint not null default 0, completes bigint not null default 0,
  answers bigint not null default 0, correct_answers bigint not null default 0,
  learning_gain real, quality_score real,
  updated_at timestamptz not null default now()
);

create or replace function app.bump_stat() returns trigger language plpgsql security definer set search_path = public, app as $$
declare col text := tg_argv[0]; d int; cid uuid;
begin
  d := case tg_op when 'INSERT' then 1 else -1 end;
  cid := coalesce(new.content_id, old.content_id);
  insert into content_stats(content_id) values (cid) on conflict do nothing;
  execute format('update content_stats set %I = greatest(0, %I + $1), updated_at = now() where content_id = $2', col, col) using d, cid;
  return coalesce(new, old);
end $$;
create trigger likes_stat after insert or delete on likes for each row execute function app.bump_stat('like_count');
create trigger saves_stat after insert or delete on saves for each row execute function app.bump_stat('save_count');
create trigger comments_stat after insert or delete on comments for each row execute function app.bump_stat('comment_count');
create trigger shares_stat after insert on shares for each row execute function app.bump_stat('share_count');

-- Social write guards: rate limits, blocks, restrictions.
create or replace function app.guard_comment_insert() returns trigger language plpgsql security definer set search_path = public, app as $$
declare owner uuid;
begin
  if exists (select 1 from creator_restrictions r where r.user_id = new.user_id and r.kind in ('no_comment','suspended') and (r.until is null or r.until > now())) then
    raise exception 'commenting restricted' using errcode = '42501';
  end if;
  select owner_user_id into owner from content_items where id = new.content_id;
  if owner is not null and app.is_blocked_between(new.user_id, owner) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app.check_rate_limit(new.user_id, 'comment_create');
  return new;
end $$;
create trigger comments_guard before insert on comments for each row execute function app.guard_comment_insert();

create or replace function app.guard_follow() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if app.is_blocked_between(new.follower_id, new.followee_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  return new;
end $$;
create trigger follows_guard before insert on follows for each row execute function app.guard_follow();

do $$ declare t text; begin
  foreach t in array array['follows','likes','saves','shares','comments','notification_preferences','notifications','content_stats'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

create policy follows_read on follows for select to authenticated using (follower_id = auth.uid() or followee_id = auth.uid());
create policy follows_insert on follows for insert to authenticated with check (follower_id = auth.uid());
create policy follows_delete on follows for delete to authenticated using (follower_id = auth.uid());

create policy likes_read on likes for select to authenticated using (user_id = auth.uid());
create policy likes_insert on likes for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from content_items c where c.id = content_id));
create policy likes_delete on likes for delete to authenticated using (user_id = auth.uid());
create policy saves_read on saves for select to authenticated using (user_id = auth.uid());
create policy saves_insert on saves for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from content_items c where c.id = content_id));
create policy saves_delete on saves for delete to authenticated using (user_id = auth.uid());
create policy shares_read on shares for select to authenticated using (user_id = auth.uid());
create policy shares_insert on shares for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from content_items c where c.id = content_id));

create policy comments_read on comments for select to authenticated using (
  (status = 'published' and exists (select 1 from content_items c where c.id = content_id) and not app.is_blocked_between(auth.uid(), user_id))
  or user_id = auth.uid() or app.has_permission('moderation.review'));
create policy comments_insert on comments for insert to authenticated with check (user_id = auth.uid() and status = 'published' and exists (select 1 from content_items c where c.id = content_id));
create policy comments_update on comments for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and status = 'published');
create policy comments_delete on comments for delete to authenticated using (user_id = auth.uid());

create policy notif_prefs_all on notification_preferences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_read on notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- notifications are created server-side only (respecting preferences).
create policy content_stats_read on content_stats for select to authenticated using (exists (select 1 from content_items c where c.id = content_id));
