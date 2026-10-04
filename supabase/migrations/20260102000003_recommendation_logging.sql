-- H9: make the recommendation system trainable and auditable.
--  * ranking_versions.algorithm becomes the AUTHORITATIVE ranking configuration (validated on load; code is only seed/fallback)
--    and is immutable once the version leaves 'draft'
--  * each served batch records: resolved config snapshot, learner feature snapshot/version, policy, candidate count
--  * a bounded candidate log with score components (selected and not selected)
--  * per-item decision (exploit/explore) and propensity — the inputs off-policy evaluation / contextual bandits need
--  * outcome events (carrying recommendation_id) are attributable back to (recommendation, content) via a view

alter table recommendations
  add column ranking_config jsonb,
  add column features_version text,
  add column feature_snapshot jsonb,
  add column candidate_count int check (candidate_count is null or candidate_count >= 0),
  add column policy jsonb;
create index recommendations_version_idx on recommendations (ranking_version, created_at desc);
create index recommendations_experiment_idx on recommendations (experiment_id, variant, created_at desc) where experiment_id is not null;

alter table recommendation_items
  add column decision text check (decision in ('exploit','explore')),
  add column propensity real check (propensity > 0 and propensity <= 1),
  add column served_at timestamptz not null default now();

create table recommendation_candidates (
  recommendation_id uuid not null references recommendations(id) on delete cascade,
  content_id uuid not null references content_items(id) on delete cascade,
  rank int not null check (rank >= 0),
  score real not null,
  sources text[] not null default '{}',
  is_exploration boolean not null default false,
  selected boolean not null default false,
  contributions jsonb not null default '{}',     -- signed score components (features + repetition penalties)
  primary key (recommendation_id, content_id)
);
create index recommendation_candidates_content_idx on recommendation_candidates (content_id);
create index recommendation_candidates_selected_idx on recommendation_candidates (recommendation_id) where selected;
alter table recommendation_candidates enable row level security;
create policy recommendation_candidates_staff on recommendation_candidates for select to authenticated using (app.has_permission('analytics.read'));
grant select, insert on public.recommendation_candidates to app_server;
create policy recommendation_candidates_app_server on recommendation_candidates for all to app_server using (true) with check (true);

-- ---------------------------------------------------------------------------------------------------- authoritative config
alter table ranking_versions add constraint ranking_algorithm_shape check (
  jsonb_typeof(algorithm) = 'object' and algorithm ?& array['weights','explorationRatio','repetition','diversity','batchSize']);

create or replace function app.guard_ranking_version() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if old.status <> 'draft' and new.algorithm is distinct from old.algorithm then
    raise exception 'ranking algorithm of a non-draft version is immutable: create a new version' using errcode = '42501';
  end if;
  if new.version is distinct from old.version then raise exception 'ranking version id is immutable' using errcode = '42501'; end if;
  if new.status is distinct from old.status then
    if not ((old.status, new.status) in (('draft','active'), ('draft','retired'), ('active','retired'))) then
      raise exception 'illegal ranking version status transition % -> %', old.status, new.status;
    end if;
    if new.status = 'active' then new.activated_at := coalesce(new.activated_at, now()); end if;
    insert into audit_log(actor_id, actor_kind, action, target_kind, target_id, metadata)
    values (auth.uid(), case when auth.uid() is null then 'service' else 'user' end, 'ranking.status_changed', 'ranking_version', old.version,
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end $$;
create trigger ranking_versions_guard before update on ranking_versions for each row execute function app.guard_ranking_version();

-- ranking_v1: the initial interpretable formulation (packages/config RANKING_V1; equality is parity-tested).
insert into ranking_versions(version, algorithm, status, activated_at, notes) values (
  'ranking_v1',
  '{"weights":{"predicted_engagement":0.18,"predicted_learning_gain":0.18,"learning_need":0.14,"personal_interest":0.1,"hook_affinity":0.08,"difficulty_fit":0.08,"content_quality":0.06,"novelty":0.05,"social_signal":0.05,"exploration":0.08},
    "explorationRatio":0.15,
    "repetition":{"content":0.5,"concept":0.15,"creator":0.08,"hook":0.05,"format":0.05},
    "diversity":{"maxPerCreator":2,"maxPerSubject":4,"maxPerFormat":4},
    "batchSize":10}'::jsonb,
  'active', now(), 'Initial interpretable ranking; weights are configurable starting points, not proven optimal.')
on conflict (version) do nothing;

-- ---------------------------------------------------------------------------------------------------- outcome attribution
-- One row per served (recommendation, item) with the outcomes the learner produced for it. Staff-only (security_invoker:
-- the underlying RLS applies, so analytics.read is required). Events are matched on user + recommendation_id + content/question id,
-- so a user cannot attribute outcomes to someone else's recommendation.
create view recommendation_outcomes with (security_invoker = true) as
select r.id as recommendation_id, r.user_id, r.ranking_version, r.experiment_id, r.variant,
       ri.content_id, ri.position, ri.decision, ri.propensity, ri.score, ri.is_exploration, ri.served_at,
       count(e.id) filter (where e.name = 'feed_impression') as impressions,
       count(e.id) filter (where e.name = 'watch_complete') as completes,
       count(e.id) filter (where e.name = 'like') as likes,
       count(e.id) filter (where e.name = 'save') as saves,
       count(e.id) filter (where e.name = 'share') as shares,
       count(e.id) filter (where e.name = 'skip') as skips,
       count(e.id) filter (where e.name = 'skip' and coalesce((e.payload ->> 'immediate')::boolean, false)) as immediate_skips,
       count(e.id) filter (where e.name = 'question_answered') as answered,
       count(e.id) filter (where e.name = 'answer_correct') as correct,
       count(e.id) filter (where e.name = 'answer_incorrect') as incorrect
  from recommendations r
  join recommendation_items ri on ri.recommendation_id = r.id
  left join events e on e.user_id = r.user_id
                    and e.payload ->> 'recommendation_id' = r.id::text
                    and coalesce(e.payload ->> 'content_id', e.payload ->> 'question_id') = ri.content_id::text
 group by r.id, ri.recommendation_id, ri.position;
