-- Identity, roles/permissions, organizations, creator profiles, publishing identities.

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text not null default '',
  bio text not null default '' check (length(bio) <= 500),
  avatar_media_id uuid,
  locale text not null default 'en',
  dm_policy text not null default 'followers' check (dm_policy in ('everyone','followers','nobody')),
  account_state text not null default 'active' check (account_state in ('active','suspended','banned')),
  is_creator boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-z0-9_]{3,30}$')
);
create unique index profiles_username_lower_idx on profiles (lower(username));
create trigger profiles_touch before update on profiles for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------- roles & permissions
create table roles (name text primary key, description text not null default '');
create table permissions (name text primary key, description text not null default '');
create table role_permissions (
  role text not null references roles(name) on delete cascade,
  permission text not null references permissions(name) on delete cascade,
  primary key (role, permission)
);
create table user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null references roles(name) on delete cascade,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  primary key (user_id, role)
);
create index user_roles_role_idx on user_roles (role);

insert into roles(name, description) values
  ('student','Default learner'),
  ('creator','Learner who publishes content'),
  ('moderator','Reviews reports and acts on content'),
  ('admin','Operates the platform; grants roles'),
  ('official_content_creator','May author/publish official content via a publishing identity'),
  ('service','Marker for non-human identities'),
  ('content_ingestion_worker','Service identity: ingestion/generation jobs'),
  ('official_publisher','Service identity: publishes validated official content'),
  ('analytics_worker','Service identity: aggregates analytics/features'),
  ('moderation_worker','Service identity: automated moderation triage');

insert into permissions(name, description) values
  ('content.manage_official','Create/edit official content drafts'),
  ('content.publish_official','Publish official content (also needs publishing-identity membership)'),
  ('moderation.review','Read reports and moderation cases'),
  ('moderation.act','Apply moderation actions'),
  ('users.manage','View users, restrict accounts'),
  ('roles.grant','Grant/revoke roles'),
  ('audit.read','Read audit log'),
  ('sources.manage','Manage source registry'),
  ('pipeline.run','Create/advance pipeline jobs'),
  ('ranking.manage','Manage ranking versions, candidate sources, flags'),
  ('experiments.manage','Manage experiments'),
  ('analytics.read','Read aggregate analytics and diagnostics');

insert into role_permissions(role, permission) values
  ('moderator','moderation.review'), ('moderator','moderation.act'),
  ('admin','moderation.review'), ('admin','moderation.act'), ('admin','users.manage'), ('admin','roles.grant'),
  ('admin','audit.read'), ('admin','sources.manage'), ('admin','ranking.manage'), ('admin','experiments.manage'),
  ('admin','analytics.read'), ('admin','pipeline.run'),
  ('official_content_creator','content.manage_official'), ('official_content_creator','content.publish_official'),
  ('official_content_creator','sources.manage'),
  -- NOTE: authors never get pipeline.run: quality gates must be written by an independent validator, not the author.
  -- service identities: narrowly scoped
  ('content_ingestion_worker','sources.manage'), ('content_ingestion_worker','pipeline.run'),
  ('content_ingestion_worker','content.manage_official'),
  ('official_publisher','content.publish_official'), ('official_publisher','content.manage_official'),
  ('analytics_worker','analytics.read'),
  ('moderation_worker','moderation.review');

create or replace function app.has_permission(p text) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from user_roles ur
    join role_permissions rp on rp.role = ur.role
    where ur.user_id = auth.uid() and rp.permission = p
      and (ur.expires_at is null or ur.expires_at > now())
  )
$$;

create or replace function app.is_staff() returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from user_roles ur where ur.user_id = auth.uid()
    and ur.role in ('moderator','admin','official_content_creator','service','content_ingestion_worker','official_publisher','analytics_worker','moderation_worker')
    and (ur.expires_at is null or ur.expires_at > now()))
$$;

-- New auth user → profile + default student role.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare base text; candidate text; i int := 0;
begin
  base := lower(regexp_replace(coalesce(split_part(new.email,'@',1), 'user'), '[^a-z0-9_]', '', 'gi'));
  if length(base) < 3 then base := base || 'user'; end if;
  base := left(base, 24); candidate := base;
  while exists (select 1 from profiles where lower(username) = candidate) loop
    i := i + 1; candidate := base || i::text;
  end loop;
  insert into profiles(id, username, display_name) values (new.id, candidate, candidate);
  insert into user_roles(user_id, role) values (new.id, 'student');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function app.handle_new_user();

-- Users may not elevate their own account_state or creator flag-bypass; only users.manage may.
create or replace function app.guard_profile_update() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if new.account_state is distinct from old.account_state and not app.has_permission('users.manage') then
    raise exception 'forbidden: account_state' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then raise exception 'forbidden: id' using errcode = '42501'; end if;
  return new;
end $$;
create trigger profiles_guard before update on profiles for each row execute function app.guard_profile_update();

-- Role grants only through roles.grant (never self-service), with audit.
create or replace function app.guard_user_roles() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if current_user in ('postgres','service_role','supabase_admin') and auth.uid() is null then return coalesce(new, old); end if;
  if not app.has_permission('roles.grant') then raise exception 'forbidden: roles.grant required' using errcode = '42501'; end if;
  perform app.write_audit(case tg_op when 'DELETE' then 'role.revoke' else 'role.grant' end, 'user', coalesce(new.user_id, old.user_id)::text, null,
    jsonb_build_object('role', coalesce(new.role, old.role)));
  return coalesce(new, old);
end $$;
create trigger user_roles_guard before insert or update or delete on user_roles for each row execute function app.guard_user_roles();

-- ---------------------------------------------------------------- organizations & publishing identities
create table organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,50}$'),
  name text not null,
  kind text not null default 'official' check (kind in ('official','partner','community')),
  created_at timestamptz not null default now()
);
create table organization_members (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null default 'member' check (member_role in ('owner','editor','member')),
  primary key (organization_id, user_id)
);
-- A PublishingIdentity is the structural "who published" for official content. Human or service.
create table publishing_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9_-]{3,50}$'),
  name text not null,
  kind text not null check (kind in ('human','service')),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now()
);
create table publishing_identity_members (
  identity_id uuid not null references publishing_identities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (identity_id, user_id)
);

create or replace function app.can_publish_as(p_identity uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.has_permission('content.publish_official') and exists (
    select 1 from publishing_identity_members m join publishing_identities i on i.id = m.identity_id
    where m.identity_id = p_identity and m.user_id = auth.uid() and i.status = 'active')
$$;
create or replace function app.can_author_as(p_identity uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.has_permission('content.manage_official') and exists (
    select 1 from publishing_identity_members m join publishing_identities i on i.id = m.identity_id
    where m.identity_id = p_identity and m.user_id = auth.uid() and i.status = 'active')
$$;

create table creator_profiles (
  user_id uuid primary key references profiles(id) on delete cascade,
  headline text not null default '' check (length(headline) <= 160),
  trust_level text not null default 'new' check (trust_level in ('new','standard','trusted','verified')),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- RLS
alter table profiles enable row level security;
alter table roles enable row level security;
alter table permissions enable row level security;
alter table role_permissions enable row level security;
alter table user_roles enable row level security;
alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table publishing_identities enable row level security;
alter table publishing_identity_members enable row level security;
alter table creator_profiles enable row level security;

create policy profiles_read on profiles for select to authenticated using (account_state <> 'banned' or id = auth.uid() or app.has_permission('users.manage'));
create policy profiles_update_own on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_update on profiles for update to authenticated using (app.has_permission('users.manage')) with check (app.has_permission('users.manage'));
-- inserts happen only via handle_new_user (security definer); no insert policy.

create policy roles_read on roles for select to authenticated using (true);
create policy permissions_read on permissions for select to authenticated using (true);
create policy role_permissions_read on role_permissions for select to authenticated using (true);
create policy user_roles_read_own on user_roles for select to authenticated using (user_id = auth.uid() or app.has_permission('roles.grant') or app.has_permission('users.manage'));
create policy user_roles_write on user_roles for all to authenticated using (app.has_permission('roles.grant')) with check (app.has_permission('roles.grant'));

create policy orgs_read on organizations for select to authenticated using (true);
create policy org_members_read on organization_members for select to authenticated using (user_id = auth.uid() or app.has_permission('users.manage'));
create policy pub_identities_read on publishing_identities for select to authenticated using (app.has_permission('content.manage_official') or app.has_permission('users.manage'));
create policy pub_identity_members_read on publishing_identity_members for select to authenticated using (user_id = auth.uid() or app.has_permission('users.manage'));
-- Writes to orgs/identities/memberships: service role (migrations/admin tooling) only. No client policies.

create policy creator_profiles_read on creator_profiles for select to authenticated using (true);
create policy creator_profiles_insert_own on creator_profiles for insert to authenticated with check (user_id = auth.uid() and trust_level = 'new' and verified_at is null);
create policy creator_profiles_update_own on creator_profiles for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());
create or replace function app.guard_creator_profile() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if (new.trust_level is distinct from old.trust_level or new.verified_at is distinct from old.verified_at) and not app.has_permission('users.manage') then
    raise exception 'forbidden: trust/verification is staff-managed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger creator_profiles_guard before update on creator_profiles for each row execute function app.guard_creator_profile();

create policy audit_read on audit_log for select to authenticated using (app.has_permission('audit.read'));

-- ---------------------------------------------------------------- blocks (used by content visibility, social, messaging)
create table user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index user_blocks_blocked_idx on user_blocks (blocked_id);
alter table user_blocks enable row level security;
-- A user sees only blocks they created (they must not learn who blocked them).
create policy user_blocks_select on user_blocks for select to authenticated using (blocker_id = auth.uid());
create policy user_blocks_insert on user_blocks for insert to authenticated with check (blocker_id = auth.uid());
create policy user_blocks_delete on user_blocks for delete to authenticated using (blocker_id = auth.uid());

create or replace function app.is_blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from user_blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
$$;
