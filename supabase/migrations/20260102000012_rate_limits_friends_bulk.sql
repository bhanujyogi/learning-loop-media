-- Friend/group actions get their own limit; trusted/verified creators may bulk-import (content_upload ×50 per window) so the
-- owner's quiz libraries can be loaded in one go. Ordinary accounts keep 20 uploads/hour.
insert into rate_limit_rules(action, max_count, window_seconds) values ('friend_action', 60, 3600) on conflict do nothing;

create or replace function app.check_rate_limit(p_user uuid, p_action text) returns void
language plpgsql security definer set search_path = public, app as $$
declare r rate_limit_rules; n int; cap int;
begin
  select * into r from rate_limit_rules where action = p_action;
  if not found then raise exception 'unknown rate limit action %', p_action; end if;
  cap := r.max_count;
  if p_action = 'content_upload' and exists (select 1 from creator_profiles where user_id = p_user and trust_level in ('trusted','verified')) then
    cap := r.max_count * 50;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_action, 0));
  select count(*) into n from rate_limit_events
    where user_id = p_user and action = p_action and created_at > now() - make_interval(secs => r.window_seconds);
  if n >= cap then
    raise exception 'rate_limited: % (max % per % s)', p_action, cap, r.window_seconds using errcode = '54000';
  end if;
  insert into rate_limit_events(user_id, action) values (p_user, p_action);
end $$;
