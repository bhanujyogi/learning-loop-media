-- Moderation: reports, cases, actions, creator restrictions, appeals. Action path is a server-side function.

create table creator_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('no_upload','no_comment','no_message','suspended')),
  reason text not null,
  until timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index creator_restrictions_user_idx on creator_restrictions (user_id);

create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_kind text not null check (target_kind in ('content','user','comment','message')),
  target_id uuid not null,
  reason text not null check (reason in ('spam','harassment','inappropriate','misinformation','copyright','self_harm','other')),
  details text check (details is null or length(details) <= 1000),
  status text not null default 'open' check (status in ('open','actioned','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
-- one open report per reporter/target (duplicate-report abuse control)
create unique index reports_one_open_idx on reports (reporter_id, target_kind, target_id) where status = 'open';
create index reports_target_idx on reports (target_kind, target_id, status);

create table moderation_cases (
  id uuid primary key default gen_random_uuid(),
  target_kind text not null, target_id uuid not null,
  status text not null default 'open' check (status in ('open','in_review','resolved')),
  priority int not null default 0,
  assigned_to uuid references auth.users(id),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (target_kind, target_id)
);
create trigger moderation_cases_touch before update on moderation_cases for each row execute function app.touch_updated_at();

create table moderation_actions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references moderation_cases(id),
  actor_id uuid not null references auth.users(id),
  target_kind text not null, target_id uuid not null,
  action text not null check (action in ('approve','restrict','remove','restore','warn','suspend_creator')),
  reason text not null check (length(reason) between 3 and 1000),
  created_at timestamptz not null default now()
);
create table appeals (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references moderation_actions(id),
  user_id uuid not null references auth.users(id),
  message text not null check (length(message) between 5 and 2000),
  status text not null default 'open' check (status in ('open','upheld','overturned')),
  created_at timestamptz not null default now(),
  unique (action_id, user_id)
);

-- Auto-flag: N distinct open reports hide content pending review.
create or replace function app.on_report_insert() returns trigger language plpgsql security definer set search_path = public, app as $$
declare n int; threshold int := 3;
begin
  if auth.uid() is not null then perform app.check_rate_limit(auth.uid(), 'report_submit'); end if;
  insert into moderation_cases(target_kind, target_id) values (new.target_kind, new.target_id) on conflict do nothing;
  if new.target_kind = 'content' then
    select count(*) into n from reports where target_kind = 'content' and target_id = new.target_id and status = 'open';
    if n + 1 >= threshold then
      perform set_config('app.moderation_fn', 'on', true);
      update content_items set moderation = 'flagged' where id = new.target_id and moderation in ('none','pending_review','cleared');
      perform set_config('app.moderation_fn', 'off', true);
    end if;
  end if;
  return new;
end $$;
create trigger reports_after_insert before insert on reports for each row execute function app.on_report_insert();

create or replace function public.apply_moderation_action(p_target_kind text, p_target_id uuid, p_action text, p_reason text)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare act uuid; mod moderation_status;
begin
  if not app.has_permission('moderation.act') then raise exception 'forbidden: moderation.act required' using errcode = '42501'; end if;
  insert into moderation_cases(target_kind, target_id, status) values (p_target_kind, p_target_id, 'in_review') on conflict (target_kind, target_id) do update set status = 'in_review';
  insert into moderation_actions(case_id, actor_id, target_kind, target_id, action, reason)
    values ((select id from moderation_cases where target_kind = p_target_kind and target_id = p_target_id), auth.uid(), p_target_kind, p_target_id, p_action, p_reason)
    returning id into act;
  if p_target_kind = 'content' then
    mod := case p_action when 'approve' then 'cleared' when 'restore' then 'cleared' when 'restrict' then 'restricted' when 'remove' then 'removed' else null end;
    if mod is not null then
      perform set_config('app.moderation_fn', 'on', true);
      update content_items set moderation = mod where id = p_target_id;
      perform set_config('app.moderation_fn', 'off', true);
    end if;
  elsif p_target_kind = 'user' and p_action = 'suspend_creator' then
    insert into creator_restrictions(user_id, kind, reason, created_by) values (p_target_id, 'no_upload', p_reason, auth.uid());
  end if;
  update reports set status = case when p_action in ('approve','restore') then 'dismissed' else 'actioned' end, resolved_at = now()
    where target_kind = p_target_kind and target_id = p_target_id and status = 'open';
  update moderation_cases set status = 'resolved' where target_kind = p_target_kind and target_id = p_target_id;
  perform app.write_audit('moderation.' || p_action, p_target_kind, p_target_id::text, p_reason, '{}');
  return act;
end $$;
revoke all on function public.apply_moderation_action(text, uuid, text, text) from public;
grant execute on function public.apply_moderation_action(text, uuid, text, text) to authenticated, service_role;

do $$ declare t text; begin
  foreach t in array array['creator_restrictions','reports','moderation_cases','moderation_actions','appeals'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
create policy reports_insert on reports for insert to authenticated with check (reporter_id = auth.uid() and status = 'open');
create policy reports_read_own on reports for select to authenticated using (reporter_id = auth.uid() or app.has_permission('moderation.review'));
create policy cases_staff_read on moderation_cases for select to authenticated using (app.has_permission('moderation.review'));
create policy actions_staff_read on moderation_actions for select to authenticated using (app.has_permission('moderation.review') or exists (
  select 1 from content_items c where moderation_actions.target_kind = 'content' and c.id = moderation_actions.target_id and c.owner_user_id = auth.uid()));
create policy restrictions_read on creator_restrictions for select to authenticated using (user_id = auth.uid() or app.has_permission('users.manage') or app.has_permission('moderation.review'));
create policy appeals_insert on appeals for insert to authenticated with check (user_id = auth.uid());
create policy appeals_read on appeals for select to authenticated using (user_id = auth.uid() or app.has_permission('moderation.review'));
-- Cases/actions/restrictions are written only via apply_moderation_action (security definer) or service role.
