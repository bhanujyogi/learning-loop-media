-- Consumer-MVP additions (all additive; nothing shipped is changed in meaning).
--  1. Learner language preference = profiles.locale (already exists) — now validated, and readable/writable by the
--     server role for ONLY the verified user, so onboarding and the feed can honour it.
--  2. learner_profiles.preparation_level — self-reported approximate level (seeds the cold-start ability prior).
--  3. The feed reads the learner's own follows (followed_creator candidate source no longer depends on a client event
--     that the taxonomy never carried a content id for).

alter table profiles add constraint profiles_locale_format check (locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$');

alter table learner_profiles add column preparation_level text
  check (preparation_level is null or preparation_level in ('beginner','intermediate','advanced'));

-- app_server: column-scoped access to profiles.locale, row-scoped to the bound user (auth.uid() is set by asUser).
grant select (id, locale), update (locale) on public.profiles to app_server;
create policy profiles_app_server_select on public.profiles for select to app_server using (id = auth.uid());
create policy profiles_app_server_update on public.profiles for update to app_server
  using (id = auth.uid()) with check (id = auth.uid());

-- app_server: read the bound user's own follow edges (never anyone else's).
grant select on public.follows to app_server;
create policy follows_app_server_select on public.follows for select to app_server using (follower_id = auth.uid());
