-- The server roles (app_server / app_jobs) have no USAGE on Supabase's `auth` schema (it belongs to supabase_admin, so it cannot be
-- granted from here), which made every guard/visibility function that calls auth.uid() fail with "permission denied for schema auth"
-- on the hosted project (PGlite's stub schema hid it). app.uid() reads the same request claims auth.uid() reads, without touching
-- the auth schema; every function in app/public is re-created to use it. Idempotent.
create or replace function app.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')
  )::uuid
$$;

do $$
declare f record;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public') and p.prokind = 'f' and p.proname <> 'uid'
      and pg_get_functiondef(p.oid) like '%auth.uid()%'
  loop
    execute replace(pg_get_functiondef(f.oid), 'auth.uid()', 'app.uid()');
  end loop;
end $$;
