-- Defense in depth: the app never uses the anonymous role. Supabase's default privileges grant it table access
-- (RLS then returns nothing); remove the grants entirely, including for future tables.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;
