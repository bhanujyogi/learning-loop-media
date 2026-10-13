-- Public-launch safety for user-generated content (all additive / tightening).
--
--  1. PRE-MODERATION: other learners see user content only after approval (`cleared`: a moderator approved it, or the
--     creator is trusted/verified). Until now new creators' content was `pending_review` AND visible to everyone
--     (post-moderation). Owners still see their own content; moderators see everything. Official content is unaffected
--     (its moderation state is 'none'). To return to post-moderation, re-add 'pending_review' here, in the feed query
--     and in the answer-grading query (packages/database/src/services).
--  2. ACCOUNT DELETION (store policy + privacy law): delete_my_account() soft-deletes the caller's content, removes the
--     caller's appeals and deletes the auth user (profile, learning data, follows, saves, … cascade). User-owned content
--     must keep an owner except once deleted, so the ownership rule is relaxed for publishing = 'deleted' only.

create or replace function app.content_visible(c content_items) returns boolean language sql stable as $$
  select c.publishing = 'published' and c.deleted_at is null
     and c.moderation in ('none','cleared')
     and c.freshness <> 'archived'
     and not (c.owner_user_id is not null and app.is_blocked_between(auth.uid(), c.owner_user_id))
$$;

alter table content_items drop constraint non_official_needs_user;
alter table content_items add constraint non_official_needs_user
  check (ownership = 'official' or owner_user_id is not null or publishing = 'deleted');

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, app as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  -- staff accounts hold references (audit trail, role grants, moderation actions) that must be handled by an admin
  if exists (select 1 from user_roles where user_id = uid and role not in ('student','creator')) then
    raise exception 'staff accounts cannot be deleted from the app' using errcode = '42501';
  end if;
  perform app.write_audit('account.delete', 'user', uid::text, null, '{}'::jsonb);
  delete from appeals where user_id = uid;
  update content_items set publishing = 'deleted', deleted_at = now() where owner_user_id = uid and publishing <> 'deleted';
  -- from here on the work is a privileged cascade, not a user action: guard triggers treat auth.uid() = null as that path
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  delete from auth.users where id = uid;
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
