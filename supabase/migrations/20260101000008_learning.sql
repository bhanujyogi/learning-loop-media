-- Learner model + learning records. Integrity rule: attempts and mastery are written ONLY by server-side
-- paths (Edge Function with service role / security definer), never directly by clients, so users cannot forge mastery.

create table learner_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  exam_id uuid references exams(id),
  exam_date date,
  education_level text,
  interests text[] not null default '{}',
  ability real not null default 0.5 check (ability between 0 and 1),
  frustration real not null default 0 check (frustration between 0 and 1),
  onboarding_completed boolean not null default false,
  diagnostic_completed boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger learner_profiles_touch before update on learner_profiles for each row execute function app.touch_updated_at();

create table concept_mastery (
  user_id uuid not null references auth.users(id) on delete cascade,
  concept_id uuid not null references concepts(id) on delete cascade,
  alpha real not null default 1, beta real not null default 1,
  exposures int not null default 0, correct int not null default 0, incorrect int not null default 0,
  mistake_streak int not null default 0, repeated_mistakes int not null default 0,
  last_evidence_at timestamptz,
  algorithm_version text not null default 'mastery_v1',
  updated_at timestamptz not null default now(),
  primary key (user_id, concept_id)
);
create index concept_mastery_user_idx on concept_mastery (user_id, updated_at desc);

create table question_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references content_items(id),
  content_version_id uuid not null references content_versions(id),
  response jsonb not null,
  correct boolean not null,
  score real not null check (score between 0 and 1),
  response_ms int check (response_ms is null or response_ms >= 0),
  hints_used int not null default 0 check (hints_used >= 0),
  confidence real check (confidence is null or confidence between 0 and 1),
  attempt_no int not null default 1,
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index question_attempts_user_idx on question_attempts (user_id, created_at desc);
create index question_attempts_question_idx on question_attempts (question_id, created_at desc);

create table quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  quiz_id uuid not null references content_items(id),
  content_version_id uuid not null references content_versions(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  score real, max_score real
);
create index quiz_attempts_user_idx on quiz_attempts (user_id, started_at desc);

-- Spaced repetition state (FSRS via ts-fsrs; scheduler_version recorded)
create table review_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_id uuid not null references content_items(id) on delete cascade,   -- flashcard or question
  concept_id uuid references concepts(id),
  due_at timestamptz not null default now(),
  stability real not null default 0, difficulty real not null default 0,
  elapsed_days real not null default 0, scheduled_days real not null default 0,
  reps int not null default 0, lapses int not null default 0, learning_steps int not null default 0,
  state text not null default 'new' check (state in ('new','learning','review','relearning')),
  last_review_at timestamptz,
  scheduler_version text not null default 'fsrs_v1',
  unique (user_id, content_id)
);
create index review_items_due_idx on review_items (user_id, due_at);
create table review_history (
  id bigint generated always as identity primary key,
  review_item_id uuid not null references review_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  grade text not null check (grade in ('again','hard','good','easy')),
  reviewed_at timestamptz not null default now(),
  prev_state jsonb, scheduler_version text not null default 'fsrs_v1'
);
create index review_history_user_idx on review_history (user_id, reviewed_at desc);

create table interaction_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_id uuid not null references content_items(id),
  kind text not null,
  score real check (score is null or score between 0 and 1),
  duration_ms int,
  payload jsonb not null default '{}' check (pg_column_size(payload) < 8192),
  created_at timestamptz not null default now()
);
create index interaction_results_user_idx on interaction_results (user_id, created_at desc);

-- Raw behavioural events. Aggregation + retention happen in jobs (docs/ANALYTICS.md).
create table events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (name ~ '^[a-z_]{3,48}$'),
  payload jsonb not null default '{}' check (pg_column_size(payload) < 2048),
  client_at timestamptz,
  created_at timestamptz not null default now()
);
create index events_user_time_idx on events (user_id, created_at desc);
create index events_name_time_idx on events (name, created_at desc);

do $$ declare t text; begin
  foreach t in array array['learner_profiles','concept_mastery','question_attempts','quiz_attempts','review_items','review_history','interaction_results','events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (user_id = auth.uid() or app.has_permission(''analytics.read''))', t || '_read', t);
  end loop;
end $$;
-- Learner profile: user manages own onboarding data (not ability/frustration, which are derived).
create policy learner_profiles_insert on learner_profiles for insert to authenticated with check (user_id = auth.uid() and ability = 0.5 and frustration = 0);
create policy learner_profiles_update on learner_profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create or replace function app.guard_learner_profile() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and (new.ability is distinct from old.ability or new.frustration is distinct from old.frustration) then
    raise exception 'forbidden: derived learner fields are server-managed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger learner_profiles_guard before update on learner_profiles for each row execute function app.guard_learner_profile();
-- Clients may append their own events (taxonomy sanitising happens client-side + server aggregation ignores unknown names).
create policy events_insert on events for insert to authenticated with check (user_id = auth.uid());
-- Attempts/mastery/reviews/history/interactions: NO client write policies (server path only).
