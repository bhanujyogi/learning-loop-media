-- Owner decision (2026-10-17): community posts go live immediately, with no approval step. Safety net stays: reports escalate
-- live content to moderators (H3), moderators can remove/restrict, upload rate limits and creator restrictions still apply.
-- To restore pre-moderation, re-create publish_content() with the trusted/verified check.
do $$
declare f record; def text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%when trust in (''trusted'',''verified'') then ''cleared'' else ''pending_review'' end%'
  loop
    def := replace(pg_get_functiondef(f.oid),
      'case when trust in (''trusted'',''verified'') then ''cleared'' else ''pending_review'' end', '''cleared''');
    execute def;
  end loop;
end $$;

-- With no approval step nobody would ever re-approve an edited post, so edits must not hide it (H1 off), and community reports
-- must be able to hide a non-trusted creator's live post (weighted reports, threshold 3, as before).
do $$
declare f record;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('app','public') and p.prokind = 'f'
             and pg_get_functiondef(p.oid) like '%new.moderation := ''pending_review'';%'
  loop
    execute replace(pg_get_functiondef(f.oid), 'new.moderation := ''pending_review'';', 'null;');
  end loop;
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('app','public') and p.prokind = 'f'
             and pg_get_functiondef(p.oid) like '%c.moderation in (''none'',''pending_review'')%'
  loop
    execute replace(pg_get_functiondef(f.oid), 'c.moderation in (''none'',''pending_review'')',
      'c.moderation in (''none'',''pending_review'',''cleared'') and not exists (select 1 from creator_profiles cp where cp.user_id = c.owner_user_id and cp.trust_level in (''trusted'',''verified''))');
  end loop;
end $$;
