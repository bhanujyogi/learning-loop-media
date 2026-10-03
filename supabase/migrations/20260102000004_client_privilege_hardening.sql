-- Hosted-verification finding: Supabase's default privileges grant `authenticated` ALL (incl. TRUNCATE/REFERENCES/TRIGGER) on every new
-- public table. RLS already denies client writes on learner-integrity tables (no write policy), but TRUNCATE is not subject to RLS and
-- "clients hold no privilege on attempts/mastery/XP/features/events" (CLAUDE.md rule 3) was only true by policy, not by grant.
-- 1) No client role may TRUNCATE / REFERENCES / TRIGGER on any public table.
-- 2) Any public table with no write policy for authenticated/public loses INSERT/UPDATE/DELETE for `authenticated`
--    (these are written only by server paths running as app_server/app_jobs/SECURITY DEFINER functions).
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;

do $$
declare r record;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
          and (p.roles && array['authenticated', 'public']::name[]))
  loop
    execute format('revoke insert, update, delete on public.%I from authenticated', r.relname);
  end loop;
end $$;
