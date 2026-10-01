-- Recommendation system data (versioned, explainable), experiments, flags, gamification.
-- All writes here are server-side (service role / staff). Learners never read other learners' features.

create table ranking_versions (
  version text primary key check (version ~ '^ranking_v[0-9]+$'),
  algorithm jsonb not null,            -- weights, features, candidate strategy, exploration ratio (mirrors packages/config)
  status text not null default 'draft' check (status in ('draft','active','retired')),
  activated_at timestamptz,
  experiment_id uuid,
  outcome_metrics jsonb not null default '{}',
  notes text not null default '',
  created_at timestamptz not null default now()
);
create unique index ranking_versions_one_active_idx on ranking_versions ((true)) where status = 'active';

create table candidate_sources (
  code text primary key,
  description text not null,
  enabled boolean not null default true,
  quota real check (quota is null or quota between 0 and 1)
);
insert into candidate_sources(code, description) values
  ('weak_concept','Concepts the learner is weak at'),('review_due','Spaced-repetition reviews due'),
  ('exam_requirement','Syllabus-relevant for the learner exam'),('interest','Subjects/formats the learner engages with'),
  ('followed_creator','Followed creators'),('saved_topic','Topics saved'),('new_content','Fresh content'),
  ('high_quality','High-quality content'),('adjacent_concept','Adjacent to known concepts'),('challenge','Stretch difficulty'),
  ('exploration','Exploration candidates'),('trending','Trending (still filtered for quality/fit/safety)'),('related','Related to recent content');

create table user_features (
  user_id uuid primary key references auth.users(id) on delete cascade,
  features jsonb not null,             -- LearnerFeatures (packages/recommendation-engine); bounded, aggregated, not raw events
  features_version text not null default 'features_v1',
  updated_at timestamptz not null default now(),
  constraint features_size check (pg_column_size(features) < 262144)
);

create table recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ranking_version text not null references ranking_versions(version),
  experiment_id uuid,
  variant text,
  seed bigint,
  diagnostics jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index recommendations_user_idx on recommendations (user_id, created_at desc);
create table recommendation_items (
  recommendation_id uuid not null references recommendations(id) on delete cascade,
  content_id uuid not null references content_items(id) on delete cascade,
  position int not null,
  score real not null,
  is_exploration boolean not null default false,
  sources text[] not null default '{}',
  why_shown jsonb not null default '{}',          -- signed feature contributions (mandatory for debugging)
  primary key (recommendation_id, position)
);
create index recommendation_items_content_idx on recommendation_items (content_id);

create table experiments (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]{3,60}$'),
  hypothesis text not null,
  status text not null default 'draft' check (status in ('draft','running','stopped','concluded')),
  population jsonb not null default '{}',
  variants jsonb not null,                        -- [{name, weight, ranking_version?, config?}]
  starts_at timestamptz, ends_at timestamptz,
  metrics jsonb not null default '[]',
  results jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table ranking_versions add constraint ranking_versions_experiment_fk foreign key (experiment_id) references experiments(id);
alter table recommendations add constraint recommendations_experiment_fk foreign key (experiment_id) references experiments(id);
create table experiment_assignments (
  experiment_id uuid not null references experiments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  variant text not null,
  assigned_at timestamptz not null default now(),
  primary key (experiment_id, user_id)
);

create table feature_flags (
  key text primary key,
  enabled boolean not null default false,
  rollout_percent int not null default 100 check (rollout_percent between 0 and 100),
  description text not null default ''
);
insert into feature_flags(key, enabled, description) values
  ('local_ai', false, 'On-device AI assistant'), ('ranking_v2', false, 'Second ranking version'),
  ('interactive_map', true, 'Interactive map content'), ('dm_enabled', true, 'Direct messaging');

-- Content-quality evidence loop (content improvement candidates)
create table content_quality_signals (
  content_id uuid primary key references content_items(id) on delete cascade,
  confusion_rate real, incorrect_rate real, abandonment_rate real, negative_feedback_rate real, learning_gain real,
  needs_revision boolean not null default false,
  evidence jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- Gamification: ledger is append-only and idempotent; progress is derived.
create table xp_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  amount int not null,
  ref_kind text, ref_id text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index xp_ledger_user_idx on xp_ledger (user_id, created_at desc);
create table user_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  xp int not null default 0, level int not null default 1,
  streak_current int not null default 0, streak_longest int not null default 0, last_active_day int,
  updated_at timestamptz not null default now()
);
create table achievements (code text primary key, name text not null, description text not null, criteria jsonb not null default '{}');
create table user_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null references achievements(code),
  earned_at timestamptz not null default now(),
  primary key (user_id, code)
);

do $$ declare t text; begin
  foreach t in array array['ranking_versions','candidate_sources','user_features','recommendations','recommendation_items','experiments','experiment_assignments','feature_flags','content_quality_signals','xp_ledger','user_progress','achievements','user_achievements'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

create policy flags_read on feature_flags for select to authenticated using (true);
create policy flags_write on feature_flags for all to authenticated using (app.has_permission('ranking.manage')) with check (app.has_permission('ranking.manage'));
create policy ranking_staff on ranking_versions for all to authenticated using (app.has_permission('ranking.manage') or app.has_permission('analytics.read')) with check (app.has_permission('ranking.manage'));
create policy candidate_sources_read on candidate_sources for select to authenticated using (true);
create policy candidate_sources_write on candidate_sources for all to authenticated using (app.has_permission('ranking.manage')) with check (app.has_permission('ranking.manage'));
create policy experiments_staff on experiments for all to authenticated using (app.has_permission('experiments.manage') or app.has_permission('analytics.read')) with check (app.has_permission('experiments.manage'));
create policy assignments_read on experiment_assignments for select to authenticated using (user_id = auth.uid() or app.has_permission('analytics.read'));
-- user_features / recommendations / items: diagnostics are for staff (analytics.read); learners do not read raw features or why_shown.
create policy user_features_staff on user_features for select to authenticated using (app.has_permission('analytics.read'));
create policy recommendations_staff on recommendations for select to authenticated using (app.has_permission('analytics.read'));
create policy recommendation_items_staff on recommendation_items for select to authenticated using (app.has_permission('analytics.read'));
create policy quality_signals_staff on content_quality_signals for select to authenticated using (app.has_permission('analytics.read') or app.has_permission('moderation.review'));
create policy xp_ledger_read on xp_ledger for select to authenticated using (user_id = auth.uid());
create policy user_progress_read on user_progress for select to authenticated using (user_id = auth.uid() or exists (select 1 from profiles p where p.id = user_id));
create policy achievements_read on achievements for select to authenticated using (true);
create policy user_achievements_read on user_achievements for select to authenticated using (user_id = auth.uid() or exists (select 1 from profiles p where p.id = user_id));
