-- Content authorization: guard triggers, RLS, version handling and the publish function.

create or replace function app.owns_content(p_content uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from content_items c where c.id = p_content
    and ((c.ownership <> 'official' and c.owner_user_id = auth.uid())
      or (c.ownership = 'official' and app.can_author_as(c.publishing_identity_id))))
$$;

-- ---------------------------------------------------------------- content_items guards
create or replace function app.guard_content_insert() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare pi publishing_identities;
begin
  if auth.uid() is null then return new; end if;  -- service role / migrations: privileged path
  if exists (select 1 from profiles where id = auth.uid() and account_state <> 'active') then
    raise exception 'account not active' using errcode = '42501';
  end if;
  if exists (select 1 from creator_restrictions r where r.user_id = auth.uid() and r.kind in ('no_upload','suspended') and (r.until is null or r.until > now())) then
    raise exception 'uploads restricted' using errcode = '42501';
  end if;
  new.publishing := 'draft'; new.published_at := null; new.deleted_at := null;
  new.current_version_id := null; new.latest_version_no := 0;
  new.uploader_id := auth.uid();
  if new.ownership = 'official' then
    select * into pi from publishing_identities where id = new.publishing_identity_id;
    if not found or not app.can_author_as(pi.id) then raise exception 'forbidden: not a member of this publishing identity' using errcode = '42501'; end if;
    new.owner_org_id := pi.organization_id; new.owner_user_id := null;
    new.source_type := coalesce(new.source_type, 'original');
    new.verification := 'unverified';
  else
    new.owner_user_id := auth.uid(); new.owner_org_id := null; new.publishing_identity_id := null;
    new.verification := 'unverified';
    if new.source_type = 'community' then new.source_type := 'original'; end if;
  end if;
  new.moderation := 'none'; new.freshness := 'current';
  perform app.check_rate_limit(auth.uid(), 'content_upload');
  return new;
end $$;
create trigger content_items_guard_insert before insert on content_items for each row execute function app.guard_content_insert();

create or replace function app.guard_content_update() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare via_fn boolean := coalesce(current_setting('app.publish_fn', true), '') = 'on';
        via_mod boolean := coalesce(current_setting('app.moderation_fn', true), '') = 'on';
        via_ver boolean := coalesce(current_setting('app.version_fn', true), '') = 'on';
begin
  if auth.uid() is null then return new; end if;  -- service role / migrations
  -- immutable-for-clients columns
  if new.ownership is distinct from old.ownership or new.owner_user_id is distinct from old.owner_user_id
     or new.owner_org_id is distinct from old.owner_org_id or new.publishing_identity_id is distinct from old.publishing_identity_id
     or new.uploader_id is distinct from old.uploader_id or new.type is distinct from old.type then
    raise exception 'forbidden: immutable column' using errcode = '42501';
  end if;
  if new.latest_version_no is distinct from old.latest_version_no and not via_ver then
    raise exception 'forbidden: latest_version_no' using errcode = '42501';
  end if;
  -- moderation state changes only through the moderation / publish functions
  if new.moderation is distinct from old.moderation and not (via_mod or via_fn) then
    raise exception 'forbidden: moderation state' using errcode = '42501';
  end if;
  -- verification only via publish function or moderators
  if new.verification is distinct from old.verification and not (via_fn or app.has_permission('moderation.act')) then
    raise exception 'forbidden: verification' using errcode = '42501';
  end if;
  -- official freshness is staff-managed once flagged
  if new.freshness is distinct from old.freshness and old.ownership = 'official' and new.freshness = 'current'
     and old.freshness in ('outdated','needs_review') and not via_fn and not app.has_permission('content.manage_official') then
    raise exception 'forbidden: freshness' using errcode = '42501';
  end if;
  if new.current_version_id is distinct from old.current_version_id and not via_fn then
    raise exception 'forbidden: current_version_id is set by publish' using errcode = '42501';
  end if;
  if new.publishing is distinct from old.publishing then
    if new.publishing = 'published' and not via_fn then
      raise exception 'forbidden: publish through publish_content()' using errcode = '42501';
    end if;
    if new.publishing = 'deleted' then new.deleted_at := coalesce(new.deleted_at, now()); end if;
  end if;
  return new;
end $$;
create trigger content_items_guard_update before update on content_items for each row execute function app.guard_content_update();

-- ---------------------------------------------------------------- versions
create or replace function app.guard_version_insert() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare n int; ctype content_type;
begin
  select type into ctype from content_items where id = new.content_id;
  if auth.uid() is not null then
    if not app.owns_content(new.content_id) then raise exception 'forbidden' using errcode = '42501'; end if;
    if new.state <> 'draft' and coalesce(current_setting('app.publish_fn', true), '') <> 'on' then
      raise exception 'forbidden: versions start as drafts' using errcode = '42501';
    end if;
    new.created_by := auth.uid();
  end if;
  -- number versions server-side
  perform set_config('app.version_fn', 'on', true);
  update content_items set latest_version_no = latest_version_no + 1 where id = new.content_id returning latest_version_no into n;
  perform set_config('app.version_fn', 'off', true);
  new.version_no := n;
  -- answer keys/explanations never live in the public body
  if ctype in ('question') and (new.body ? 'answer' or new.body ? 'explanation') then
    raise exception 'question body must not contain answer/explanation (use content_answer_keys)';
  end if;
  return new;
end $$;
create trigger content_versions_guard_insert before insert on content_versions for each row execute function app.guard_version_insert();

create or replace function app.guard_version_update() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare ctype content_type;
begin
  if auth.uid() is null then return new; end if;
  if new.state is distinct from old.state and coalesce(current_setting('app.publish_fn', true), '') <> 'on' then
    raise exception 'forbidden: state changes through app.publish_content()' using errcode = '42501';
  end if;
  select type into ctype from content_items where id = new.content_id;
  if ctype = 'question' and (new.body ? 'answer' or new.body ? 'explanation') then
    raise exception 'question body must not contain answer/explanation (use content_answer_keys)';
  end if;
  return new;
end $$;
create trigger content_versions_guard_update before update on content_versions for each row execute function app.guard_version_update();

-- ---------------------------------------------------------------- publish
create table publish_log (
  id bigint generated always as identity primary key,
  idempotency_key text not null unique,
  content_id uuid not null references content_items(id),
  content_version_id uuid not null references content_versions(id),
  published_by uuid,
  publishing_identity_id uuid,
  created_at timestamptz not null default now()
);
alter table publish_log enable row level security;
create policy publish_log_read on publish_log for select to authenticated using (app.has_permission('audit.read') or app.owns_content(content_id));

-- Required official gates (parity with packages/content-engine GATE_NAMES; tested).
create or replace function app.required_gates() returns text[] language sql immutable as $$
  select array['schema_valid','source_valid','license_valid','metadata_valid','answer_keys_valid','duplicate_check_passed','content_quality_check_passed']
$$;

create or replace function public.publish_content(p_content uuid, p_idempotency_key text default null)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare c content_items; v content_versions; key text; existing uuid; missing text[]; trust text; new_mod moderation_status;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into c from content_items where id = p_content for update;
  if not found then raise exception 'content not found'; end if;
  if c.ownership = 'official' then
    if not app.can_publish_as(c.publishing_identity_id) then raise exception 'forbidden: cannot publish as this identity' using errcode = '42501'; end if;
  elsif c.owner_user_id <> auth.uid() then raise exception 'forbidden' using errcode = '42501';
  end if;
  if c.moderation in ('removed','restricted') then raise exception 'forbidden: removed by moderation' using errcode = '42501'; end if;
  if exists (select 1 from profiles where id = auth.uid() and account_state <> 'active') then raise exception 'account not active' using errcode = '42501'; end if;

  select * into v from content_versions where content_id = p_content and state = 'draft';
  if not found then
    -- republish of an unpublished item: reuse current published version
    select * into v from content_versions where id = c.current_version_id;
    if not found then raise exception 'nothing to publish: no draft version'; end if;
  end if;

  key := coalesce(p_idempotency_key, encode(sha256(convert_to(p_content::text || ':' || v.id::text, 'utf8')), 'hex'));
  select content_version_id into existing from publish_log where idempotency_key = key;
  if existing is not null then return existing; end if;  -- idempotent retry

  if c.ownership = 'official' then
    select array_agg(g) into missing from unnest(app.required_gates()) g
      where not exists (select 1 from quality_gate_results q where q.content_version_id = v.id and q.gate = g and q.passed);
    if missing is not null then raise exception 'quality gates not passed: %', array_to_string(missing, ',') using errcode = '23514'; end if;
    if not exists (select 1 from content_provenance p where p.content_version_id = v.id) then
      raise exception 'official content requires provenance' using errcode = '23514';
    end if;
    perform app.check_rate_limit(auth.uid(), 'official_publish');
  end if;

  perform set_config('app.publish_fn', 'on', true);
  if v.state = 'draft' then
    update content_versions set state = 'superseded' where content_id = p_content and state = 'published';
    update content_versions set state = 'published', frozen_at = now() where id = v.id;
  end if;
  new_mod := c.moderation;
  if c.ownership <> 'official' and c.moderation = 'none' then
    select trust_level into trust from creator_profiles where user_id = c.owner_user_id;
    new_mod := case when trust in ('trusted','verified') then 'cleared' else 'pending_review' end;
  end if;
  update content_items set publishing = 'published', current_version_id = v.id, published_at = coalesce(published_at, now()),
    moderation = new_mod,
    verification = case when ownership = 'official' then 'official' else verification end
    where id = p_content;
  insert into publish_log(idempotency_key, content_id, content_version_id, published_by, publishing_identity_id)
    values (key, p_content, v.id, auth.uid(), c.publishing_identity_id);
  perform app.write_audit('content.publish', 'content', p_content::text, null,
    jsonb_build_object('version_id', v.id, 'version_no', v.version_no, 'ownership', c.ownership, 'identity', c.publishing_identity_id));
  perform set_config('app.publish_fn', 'off', true);
  return v.id;
end $$;
revoke all on function public.publish_content(uuid, text) from public;
grant execute on function public.publish_content(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------- RLS
alter table content_items enable row level security;
alter table content_versions enable row level security;
alter table content_answer_keys enable row level security;
alter table content_concepts enable row level security;
alter table content_exams enable row level security;
alter table content_relations enable row level security;
alter table course_modules enable row level security;
alter table module_items enable row level security;
alter table media_assets enable row level security;

-- NOTE: row-local checks (not owns_content(id)) so INSERT ... RETURNING can see the row being written.
create policy content_items_select on content_items for select to authenticated using (
  app.content_visible(content_items)
  or (ownership <> 'official' and owner_user_id = auth.uid())
  or (ownership = 'official' and app.can_author_as(publishing_identity_id))
  or app.has_permission('moderation.review'));
create policy content_items_insert on content_items for insert to authenticated with check (
  (ownership in ('user','creator') and owner_user_id = auth.uid())
  or (ownership = 'official' and app.can_author_as(publishing_identity_id)));
create policy content_items_update on content_items for update to authenticated
  using ((ownership <> 'official' and owner_user_id = auth.uid())
      or (ownership = 'official' and app.can_author_as(publishing_identity_id))
      or app.has_permission('moderation.act'))
  with check ((ownership <> 'official' and owner_user_id = auth.uid())
      or (ownership = 'official' and app.can_author_as(publishing_identity_id))
      or app.has_permission('moderation.act'));
-- No DELETE policy: removal is a soft state ('deleted'); hard delete is service-role only.

create policy content_versions_select on content_versions for select to authenticated using (
  app.owns_content(content_id) or app.has_permission('moderation.review')
  or (state = 'published' and exists (select 1 from content_items ci where ci.id = content_versions.content_id)));  -- inner select is RLS-filtered → visible only
create policy content_versions_insert on content_versions for insert to authenticated with check (app.owns_content(content_id));
create policy content_versions_update on content_versions for update to authenticated using (app.owns_content(content_id)) with check (app.owns_content(content_id));

create policy answer_keys_select on content_answer_keys for select to authenticated using (
  exists (select 1 from content_versions v where v.id = content_version_id and (app.owns_content(v.content_id) or app.has_permission('moderation.review'))));
create policy answer_keys_insert on content_answer_keys for insert to authenticated with check (
  exists (select 1 from content_versions v where v.id = content_version_id and app.owns_content(v.content_id)));
create policy answer_keys_update on content_answer_keys for update to authenticated using (
  exists (select 1 from content_versions v where v.id = content_version_id and app.owns_content(v.content_id)));

-- Graph links: readable when the content is readable; writable by owners.
create policy cc_select on content_concepts for select to authenticated using (exists (select 1 from content_items ci where ci.id = content_id));
create policy cc_write on content_concepts for all to authenticated using (app.owns_content(content_id)) with check (app.owns_content(content_id));
create policy ce_select on content_exams for select to authenticated using (exists (select 1 from content_items ci where ci.id = content_id));
create policy ce_write on content_exams for all to authenticated using (app.owns_content(content_id)) with check (app.owns_content(content_id));
create policy cr_select on content_relations for select to authenticated using (exists (select 1 from content_items ci where ci.id = from_content_id));
create policy cr_write on content_relations for all to authenticated using (app.owns_content(from_content_id)) with check (app.owns_content(from_content_id));
create policy cm_select on course_modules for select to authenticated using (exists (select 1 from content_items ci where ci.id = course_id));
create policy cm_write on course_modules for all to authenticated using (app.owns_content(course_id)) with check (app.owns_content(course_id));
create policy mi_select on module_items for select to authenticated using (exists (select 1 from course_modules m where m.id = module_id));
create policy mi_write on module_items for all to authenticated
  using (exists (select 1 from course_modules m where m.id = module_id and app.owns_content(m.course_id)))
  with check (exists (select 1 from course_modules m where m.id = module_id and app.owns_content(m.course_id)));

create policy media_select on media_assets for select to authenticated using (
  owner_user_id = auth.uid() or (content_id is not null and exists (select 1 from content_items ci where ci.id = content_id)) or app.has_permission('moderation.review'));
create policy media_insert on media_assets for insert to authenticated with check (owner_user_id = auth.uid() and owner_org_id is null and status = 'pending');
-- status transitions (pending→ready/rejected) happen after server-side validation (service role).
create policy media_delete on media_assets for delete to authenticated using (owner_user_id = auth.uid());
