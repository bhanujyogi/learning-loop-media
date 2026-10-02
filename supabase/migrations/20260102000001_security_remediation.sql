-- Security remediation (audit 2026-10-01): C1, C2, H1, H2, H3 + medium hardening.
-- Additive: replaces functions/policies from earlier migrations; no table is dropped.

-- =====================================================================================
-- C1  A conversation member must not be able to re-point their membership row.
-- =====================================================================================
create or replace function app.guard_member_update() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and (
       new.conversation_id is distinct from old.conversation_id
    or new.user_id is distinct from old.user_id
    or new.member_role is distinct from old.member_role) then
    raise exception 'forbidden: membership identity fields are immutable' using errcode = '42501';
  end if;
  if new.last_read_at is not null and new.last_read_at > now() then new.last_read_at := now(); end if;
  return new;
end $$;
create trigger conversation_members_guard before update on conversation_members
  for each row execute function app.guard_member_update();

-- Message timestamps are server-assigned (senders cannot back/forward-date messages).
create or replace function app.force_message_ts() returns trigger language plpgsql as $$
begin new.created_at := now(); return new; end $$;
create trigger messages_force_ts before insert on messages for each row execute function app.force_message_ts();

-- =====================================================================================
-- C2  Bind quality-gate results to the EXACT content that was validated.
--     version_hash covers body, answer key/explanation, provenance (+source license snapshots),
--     metadata and graph links. Gate rows get their hash assigned server-side (the validator cannot
--     lie), and publish_content() requires hash == current hash. The author cannot be the validator.
-- =====================================================================================
create or replace function app.version_hash(p_version uuid) returns text
language sql stable security definer set search_path = public, app as $$
  select encode(sha256(convert_to(concat_ws('|',
    v.body::text,
    coalesce((select k.answer::text || '~' || k.explanation from content_answer_keys k where k.content_version_id = v.id), ''),
    coalesce((select concat_ws('~', p.transformation, p.generated_by, p.model_identifier, p.model_version, p.prompt_version, p.process_name, p.publishing_identity_id::text)
                from content_provenance p where p.content_version_id = v.id), ''),
    coalesce((select string_agg(ps.source_id::text || ':' || ps.license_snapshot::text, ',' order by ps.source_id)
                from content_provenance p join content_provenance_sources ps on ps.provenance_id = p.id where p.content_version_id = v.id), ''),
    c.type::text, c.title, c.summary, c.language, c.source_type::text, coalesce(c.hook::text, ''), coalesce(c.format::text, ''),
    coalesce(c.difficulty::text, ''), coalesce(c.learning_objective, ''),
    coalesce((select string_agg(cc.concept_id::text || ':' || cc.role, ',' order by cc.concept_id) from content_concepts cc where cc.content_id = c.id), ''),
    coalesce((select string_agg(ce.exam_id::text, ',' order by ce.exam_id) from content_exams ce where ce.content_id = c.id), '')
  ), 'utf8')), 'hex')
  from content_versions v join content_items c on c.id = v.content_id where v.id = p_version
$$;

alter table quality_gate_results add column content_hash text;

create or replace function app.guard_gate_result() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare author uuid; cid uuid; uploader uuid;
begin
  select v.created_by, v.content_id, c.uploader_id into author, cid, uploader
    from content_versions v join content_items c on c.id = v.content_id where v.id = new.content_version_id;
  if auth.uid() is not null then
    -- independence: whoever authored/uploaded/can-author the content can never satisfy a gate for it
    if auth.uid() is not distinct from author or auth.uid() is not distinct from uploader or app.owns_content(cid) then
      raise exception 'forbidden: a gate must be checked by someone other than the content author' using errcode = '42501';
    end if;
    new.checked_by := auth.uid();
  end if;
  new.content_hash := app.version_hash(new.content_version_id);
  new.checked_at := now();
  return new;
end $$;
create trigger quality_gate_results_guard before insert or update on quality_gate_results
  for each row execute function app.guard_gate_result();

-- publish_content: gates must match the current content hash (stale gates fail closed).
-- H1: new versions of non-official content re-enter review unless the creator is trusted/verified.
create or replace function public.publish_content(p_content uuid, p_idempotency_key text default null)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare c content_items; v content_versions; key text; existing uuid; missing text[]; trust text; new_mod moderation_status; h text;
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

  select * into v from content_versions where content_id = p_content and state = 'draft' for update;
  if not found then
    select * into v from content_versions where id = c.current_version_id for update;
    if not found then raise exception 'nothing to publish: no draft version'; end if;
  end if;

  key := coalesce(p_idempotency_key, encode(sha256(convert_to(p_content::text || ':' || v.id::text, 'utf8')), 'hex'));
  select content_version_id into existing from publish_log where idempotency_key = key;
  if existing is not null then return existing; end if;

  if c.ownership = 'official' then
    h := app.version_hash(v.id);
    select array_agg(g) into missing from unnest(app.required_gates()) g
      where not exists (select 1 from quality_gate_results q where q.content_version_id = v.id and q.gate = g and q.passed and q.content_hash = h);
    if missing is not null then
      raise exception 'quality gates not passed or stale (content changed after validation): %', array_to_string(missing, ',') using errcode = '23514';
    end if;
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
  if c.ownership <> 'official' and c.moderation in ('none','cleared','pending_review') then
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
    jsonb_build_object('version_id', v.id, 'version_no', v.version_no, 'ownership', c.ownership, 'identity', c.publishing_identity_id, 'content_hash', h));
  perform set_config('app.publish_fn', 'off', true);
  return v.id;
end $$;
revoke all on function public.publish_content(uuid, text) from public;
grant execute on function public.publish_content(uuid, text) to authenticated, service_role;

-- =====================================================================================
-- H1  Material edits to already-cleared content return it to pending review.
-- =====================================================================================
create or replace function app.guard_content_update() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare via_fn boolean := coalesce(current_setting('app.publish_fn', true), '') = 'on';
        via_mod boolean := coalesce(current_setting('app.moderation_fn', true), '') = 'on';
        via_ver boolean := coalesce(current_setting('app.version_fn', true), '') = 'on';
begin
  if auth.uid() is null then return new; end if;
  if new.ownership is distinct from old.ownership or new.owner_user_id is distinct from old.owner_user_id
     or new.owner_org_id is distinct from old.owner_org_id or new.publishing_identity_id is distinct from old.publishing_identity_id
     or new.uploader_id is distinct from old.uploader_id or new.type is distinct from old.type then
    raise exception 'forbidden: immutable column' using errcode = '42501';
  end if;
  if new.latest_version_no is distinct from old.latest_version_no and not via_ver then
    raise exception 'forbidden: latest_version_no' using errcode = '42501';
  end if;
  if new.moderation is distinct from old.moderation and not (via_mod or via_fn) then
    raise exception 'forbidden: moderation state' using errcode = '42501';
  end if;
  if new.verification is distinct from old.verification and not (via_fn or app.has_permission('moderation.act')) then
    raise exception 'forbidden: verification' using errcode = '42501';
  end if;
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
  -- H1: a material change to approved user content invalidates the approval (staff edits excepted).
  if old.moderation = 'cleared' and old.ownership <> 'official' and not (via_mod or via_fn) and not app.has_permission('moderation.act')
     and (new.title is distinct from old.title or new.summary is distinct from old.summary or new.language is distinct from old.language
          or new.hook is distinct from old.hook or new.format is distinct from old.format or new.learning_objective is distinct from old.learning_objective) then
    new.moderation := 'pending_review';
  end if;
  return new;
end $$;

-- =====================================================================================
-- H3  Reports are weighted; tiny numbers of throwaway accounts cannot auto-hide content, and
--     official or human-approved content is never auto-hidden (it is escalated to the queue instead).
-- =====================================================================================
alter table reports add column weight real not null default 1 check (weight between 0 and 1);
alter table moderation_cases add column escalated boolean not null default false;
create index moderation_cases_queue_idx on moderation_cases (status, priority desc, created_at);

create or replace function app.on_report_insert() returns trigger language plpgsql security definer set search_path = public, app as $$
declare w real; age interval; total real; c content_items; threshold real := 3.0;
begin
  if auth.uid() is not null then perform app.check_rate_limit(auth.uid(), 'report_submit'); end if;
  select now() - created_at into age from profiles where id = new.reporter_id;
  -- accounts younger than 7 days count for little; weight is server-assigned (clients cannot set it)
  w := case when age is null or age < interval '7 days' then 0.2 else 1.0 end;
  new.weight := w;
  select coalesce(sum(weight), 0) + w into total from reports where target_kind = new.target_kind and target_id = new.target_id and status = 'open';
  insert into moderation_cases(target_kind, target_id) values (new.target_kind, new.target_id) on conflict do nothing;
  update moderation_cases set priority = greatest(priority, ceil(total * 10)::int), escalated = escalated or total >= threshold
   where target_kind = new.target_kind and target_id = new.target_id;
  if new.target_kind = 'content' and total >= threshold then
    select * into c from content_items where id = new.target_id;
    -- never auto-hide official or already-approved content: a human decides (case is escalated above)
    if found and c.ownership <> 'official' and c.moderation in ('none','pending_review') then
      perform set_config('app.moderation_fn', 'on', true);
      update content_items set moderation = 'flagged' where id = new.target_id;
      perform set_config('app.moderation_fn', 'off', true);
    end if;
  end if;
  return new;
end $$;

-- =====================================================================================
-- H2  Clients may not insert raw analytics events through the database API. The sanitising server path
--     (recordEvents / submitAnswer, running as app_server) is the only writer.
-- =====================================================================================
drop policy events_insert on events;
revoke insert on events from authenticated;
-- Defence in depth: an expression index also supports recommendation-outcome attribution and quality jobs (H5/H9).
create index events_content_idx on events ((payload ->> 'content_id'), name, created_at desc);
create index events_recommendation_idx on events ((payload ->> 'recommendation_id')) where payload ? 'recommendation_id';

-- =====================================================================================
-- Medium: privacy / spoofing / least-visibility hardening
-- =====================================================================================
-- Public handles must not leak the email local-part; random handle, user can rename (reserved names blocked).
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare candidate text;
begin
  loop
    candidate := 'learner_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    exit when not exists (select 1 from profiles where lower(username) = candidate);
  end loop;
  insert into profiles(id, username, display_name) values (new.id, candidate, 'Learner');
  insert into user_roles(user_id, role) values (new.id, 'student');
  return new;
end $$;

create or replace function app.guard_profile_update() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if new.account_state is distinct from old.account_state and not app.has_permission('users.manage') then
    raise exception 'forbidden: account_state' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then raise exception 'forbidden: id' using errcode = '42501'; end if;
  if new.is_creator is distinct from old.is_creator and not app.has_permission('users.manage') then
    raise exception 'forbidden: is_creator is staff-managed' using errcode = '42501';
  end if;
  if new.username is distinct from old.username and not app.has_permission('users.manage')
     and lower(new.username) ~ '(learningloop|learning_loop|official|admin|moderator|support|staff|system|root)' then
    raise exception 'forbidden: reserved username' using errcode = '42501';
  end if;
  return new;
end $$;

-- Media rows: key must live under the uploader's own prefix; content attachment requires owning the content.
create or replace function app.guard_media_asset() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if auth.uid() is null then return new; end if;
  if new.bucket <> 'media' or new.storage_key not like auth.uid()::text || '/%' or position('..' in new.storage_key) > 0 then
    raise exception 'forbidden: storage key must be under your own prefix' using errcode = '42501';
  end if;
  if new.content_id is not null and not app.owns_content(new.content_id) then
    raise exception 'forbidden: cannot attach media to content you do not own' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger media_assets_guard before insert or update on media_assets for each row execute function app.guard_media_asset();

-- Moderators review published/reported material, not other people's private drafts.
drop policy content_items_select on content_items;
create policy content_items_select on content_items for select to authenticated using (
  app.content_visible(content_items)
  or (ownership <> 'official' and owner_user_id = auth.uid())
  or (ownership = 'official' and app.can_author_as(publishing_identity_id))
  or (app.has_permission('moderation.review') and publishing <> 'draft'));
drop policy content_versions_select on content_versions;
create policy content_versions_select on content_versions for select to authenticated using (
  app.owns_content(content_id)
  or (app.has_permission('moderation.review') and state <> 'draft')
  or (state = 'published' and exists (select 1 from content_items ci where ci.id = content_versions.content_id)));
drop policy answer_keys_select on content_answer_keys;
create policy answer_keys_select on content_answer_keys for select to authenticated using (
  exists (select 1 from content_versions v where v.id = content_version_id
          and (app.owns_content(v.content_id) or (app.has_permission('moderation.review') and v.state <> 'draft'))));

-- Rate-limit check is serialised per (user, action): no count-then-insert race.
create or replace function app.check_rate_limit(p_user uuid, p_action text) returns void
language plpgsql security definer set search_path = public, app as $$
declare r rate_limit_rules; n int;
begin
  select * into r from rate_limit_rules where action = p_action;
  if not found then raise exception 'unknown rate limit action %', p_action; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_action, 0));
  select count(*) into n from rate_limit_events
    where user_id = p_user and action = p_action and created_at > now() - make_interval(secs => r.window_seconds);
  if n >= r.max_count then
    raise exception 'rate_limited: % (max % per % s)', p_action, r.max_count, r.window_seconds using errcode = '54000';
  end if;
  insert into rate_limit_events(user_id, action) values (p_user, p_action);
end $$;

-- Creator trust is staff-managed: give staff an explicit policy (previously nobody could change it) and let the
-- privileged path (no end-user JWT) through the guard like every other guard trigger.
create policy creator_profiles_staff_update on creator_profiles for update to authenticated
  using (app.has_permission('users.manage')) with check (app.has_permission('users.manage'));
create or replace function app.guard_creator_profile() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if auth.uid() is not null
     and (new.trust_level is distinct from old.trust_level or new.verified_at is distinct from old.verified_at)
     and not app.has_permission('users.manage') then
    raise exception 'forbidden: trust/verification is staff-managed' using errcode = '42501';
  end if;
  return new;
end $$;
