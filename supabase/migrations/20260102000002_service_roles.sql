-- H6: least-privilege database roles for server-side code (Edge Functions / scheduled jobs).
-- Before: services connected with a privileged role that bypasses RLS and every guard trigger (auth.uid() is null).
-- Now: services `SET LOCAL ROLE app_server` (or `app_jobs`) inside each transaction and bind the VERIFIED user id into
-- `request.jwt.claim.sub`. These roles are NOT superusers and do NOT have BYPASSRLS: they can only touch the tables and
-- columns granted below, through explicit policies. They cannot change roles, permissions, content, moderation, audit,
-- publishing identities, sources or pipeline jobs.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_server') then create role app_server nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'app_jobs') then create role app_jobs nologin noinherit; end if;
end $$;
-- the connection role must be able to SET ROLE to them (Supabase: postgres)
grant app_server to current_user;
grant app_jobs to current_user;

grant usage on schema public to app_server, app_jobs;
grant usage on schema app to app_server, app_jobs;
grant usage on schema auth to app_server, app_jobs; -- guard triggers call auth.uid() as the caller
grant execute on function app.is_blocked_between(uuid, uuid) to app_server;

do $$
declare r record;
begin
  for r in select * from (values
    -- (role, table, privileges)
    ('app_server', 'content_items', 'select'), ('app_server', 'content_versions', 'select'),
    ('app_server', 'content_answer_keys', 'select'), ('app_server', 'content_concepts', 'select'),
    ('app_server', 'content_exams', 'select'), ('app_server', 'content_relations', 'select'),
    ('app_server', 'concepts', 'select'), ('app_server', 'topics', 'select'), ('app_server', 'chapters', 'select'),
    ('app_server', 'subjects', 'select'), ('app_server', 'exam_concepts', 'select'),
    ('app_server', 'concept_prerequisites', 'select'), ('app_server', 'saves', 'select'),
    ('app_server', 'experiments', 'select'), ('app_server', 'ranking_versions', 'select'),
    ('app_server', 'learner_profiles', 'select, insert, update'), ('app_server', 'concept_mastery', 'select, insert, update'),
    ('app_server', 'content_stats', 'select, insert, update'), ('app_server', 'review_items', 'select, insert, update'),
    ('app_server', 'user_progress', 'select, insert, update'), ('app_server', 'user_features', 'select, insert, update'),
    ('app_server', 'xp_ledger', 'select, insert'), ('app_server', 'experiment_assignments', 'select, insert'),
    ('app_server', 'question_attempts', 'select, insert'), ('app_server', 'recommendations', 'select, insert'),
    ('app_server', 'recommendation_items', 'select, insert'), ('app_server', 'review_history', 'select, insert'),
    ('app_server', 'user_achievements', 'select, insert'), ('app_server', 'events', 'insert'),
    ('app_jobs', 'events', 'select, delete'), ('app_jobs', 'question_attempts', 'select'),
    ('app_jobs', 'content_items', 'select'), ('app_jobs', 'reports', 'select'),
    ('app_jobs', 'review_items', 'select'), ('app_jobs', 'notification_preferences', 'select'),
    ('app_jobs', 'rate_limit_events', 'select, delete'), ('app_jobs', 'content_quality_signals', 'select, insert, update'),
    ('app_jobs', 'content_stats', 'select, insert, update'), ('app_jobs', 'notifications', 'select, insert')
  ) as t(role, tbl, privs) loop
    execute format('grant %s on public.%I to %I', r.privs, r.tbl, r.role);
    -- RLS stays ON for these roles (no BYPASSRLS): an explicit policy is required, scoped to exactly this role.
    execute format('create policy %I on public.%I for all to %I using (true) with check (true)', r.tbl || '_' || r.role, r.tbl, r.role);
  end loop;
end $$;

-- Narrow the content policies further: the service role needs PUBLISHED material only (feed, grading) — never drafts,
-- unpublished versions or their answer keys. 'superseded' stays readable so idempotent replays of old attempts still resolve.
drop policy content_items_app_server on content_items;
create policy content_items_app_server on content_items for select to app_server
  using (publishing = 'published' and deleted_at is null);
drop policy content_versions_app_server on content_versions;
create policy content_versions_app_server on content_versions for select to app_server
  using (state in ('published', 'superseded'));
drop policy content_answer_keys_app_server on content_answer_keys;
create policy content_answer_keys_app_server on content_answer_keys for select to app_server
  using (exists (select 1 from content_versions v where v.id = content_version_id and v.state in ('published', 'superseded')));

-- Derived learner fields are server-managed: allow the service role, still forbid every end-user session.
create or replace function app.guard_learner_profile() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and current_user <> 'app_server'
     and (new.ability is distinct from old.ability or new.frustration is distinct from old.frustration) then
    raise exception 'forbidden: derived learner fields are server-managed' using errcode = '42501';
  end if;
  return new;
end $$;

-- Hardening: the service roles never inherit anything from PUBLIC beyond what is granted explicitly.
revoke all on all tables in schema public from public;
