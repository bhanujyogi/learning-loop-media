-- Learning Loop — foundation: enums, helper schema, rate limiting, audit log.
-- Enums mirror packages/shared/src/domain.ts (parity enforced by packages/database tests).

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

create type content_type as enum ('video','note','question','quiz','flashcard','lesson','course','pdf','audio','image','interactive');
create type ownership_kind as enum ('official','creator','user');
create type source_type as enum ('original','imported','ai_generated','ai_assisted','community');
create type verification_status as enum ('unverified','source_backed','reviewed','official');
create type publishing_status as enum ('draft','published','unpublished','archived','deleted');
create type moderation_status as enum ('none','pending_review','flagged','restricted','removed','appealed','cleared');
create type freshness_status as enum ('current','needs_review','outdated','archived');
create type hook_type as enum ('curiosity','challenge','surprise','prediction','mistake','exam','myth','real_world','comparison','speed','story','question');
create type format_type as enum ('animation','video','diagram','question','interactive','challenge','story','map','timeline','note','flashcard');
create type license_code as enum ('public_domain','cc0','cc_by','cc_by_sa','cc_by_nc','cc_by_nd','cc_by_nc_sa','cc_by_nc_nd','open_government','mit','apache_2','proprietary','unknown');
create type trust_level as enum ('high','standard','needs_review','blocked');
create type job_status as enum ('queued','running','completed','failed','retrying','cancelled');

-- Current user id as seen by RLS (Supabase's auth.uid()).
create or replace function app.uid() returns uuid language sql stable as $$ select auth.uid() $$;

create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------- audit log (append-only)
create table audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_kind text not null default 'user' check (actor_kind in ('user','service','system')),
  action text not null check (length(action) between 1 and 100),
  target_kind text,
  target_id text,
  reason text check (reason is null or length(reason) <= 1000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_actor_idx on audit_log (actor_id, created_at desc);
create index audit_log_target_idx on audit_log (target_kind, target_id, created_at desc);
create index audit_log_action_idx on audit_log (action, created_at desc);

create or replace function app.audit_immutable() returns trigger language plpgsql as $$
begin raise exception 'audit_log is append-only'; end $$;
create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function app.audit_immutable();

create or replace function app.write_audit(
  p_action text, p_target_kind text, p_target_id text, p_reason text default null, p_metadata jsonb default '{}'
) returns void language plpgsql security definer set search_path = public, app as $$
begin
  insert into audit_log(actor_id, actor_kind, action, target_kind, target_id, reason, metadata)
  values (auth.uid(), case when auth.uid() is null then 'system' else 'user' end, p_action, p_target_kind, p_target_id, p_reason, coalesce(p_metadata,'{}'));
end $$;

-- ---------------------------------------------------------------- rate limiting
create table rate_limit_rules (
  action text primary key,
  max_count int not null check (max_count > 0),
  window_seconds int not null check (window_seconds > 0)
);
-- Mirrors packages/config RATE_LIMITS (parity tested). Normal educational consumption is never limited.
insert into rate_limit_rules(action, max_count, window_seconds) values
  ('message_send', 30, 60), ('comment_create', 10, 60), ('report_submit', 10, 3600),
  ('content_upload', 20, 3600), ('official_publish', 50, 3600);

create table rate_limit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  action text not null references rate_limit_rules(action),
  created_at timestamptz not null default now()
);
create index rate_limit_events_idx on rate_limit_events (user_id, action, created_at desc);

create or replace function app.check_rate_limit(p_user uuid, p_action text) returns void
language plpgsql security definer set search_path = public, app as $$
declare r rate_limit_rules; n int;
begin
  select * into r from rate_limit_rules where action = p_action;
  if not found then raise exception 'unknown rate limit action %', p_action; end if;
  select count(*) into n from rate_limit_events
    where user_id = p_user and action = p_action and created_at > now() - make_interval(secs => r.window_seconds);
  if n >= r.max_count then
    raise exception 'rate_limited: % (max % per % s)', p_action, r.max_count, r.window_seconds using errcode = '54000';
  end if;
  insert into rate_limit_events(user_id, action) values (p_user, p_action);
end $$;

alter table audit_log enable row level security;
alter table rate_limit_rules enable row level security;
alter table rate_limit_events enable row level security;
-- No policies for rate_limit_*: only security-definer functions / service role touch them.
