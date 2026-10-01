-- Curriculum / content graph spine: Exam → Subject → Chapter → Topic → Concept (+ prerequisites).
-- Exam structure is DATA, never code (no hardcoded exam patterns).

create table exams (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  name text not null,
  name_i18n jsonb not null default '{}',
  region text,
  level text,
  description text not null default '',
  metadata jsonb not null default '{}',   -- pattern/stages as data, with source info in metadata.source
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table subjects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  name text not null,
  name_i18n jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table exam_subjects (
  exam_id uuid not null references exams(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  weight real check (weight is null or weight between 0 and 1),
  primary key (exam_id, subject_id)
);
create table chapters (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9-]{2,80}$'),
  name text not null,
  name_i18n jsonb not null default '{}',
  position int not null default 0,
  unique (subject_id, slug)
);
create table topics (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9-]{2,80}$'),
  name text not null,
  name_i18n jsonb not null default '{}',
  position int not null default 0,
  unique (chapter_id, slug)
);
create table concepts (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references topics(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,100}$'),
  name text not null,
  name_i18n jsonb not null default '{}',
  description text not null default '',
  difficulty real not null default 0.5 check (difficulty between 0 and 1),
  misconceptions jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index concepts_topic_idx on concepts (topic_id);
create table concept_prerequisites (
  concept_id uuid not null references concepts(id) on delete cascade,
  prerequisite_id uuid not null references concepts(id) on delete cascade,
  primary key (concept_id, prerequisite_id),
  check (concept_id <> prerequisite_id)
);
create index concept_prereq_rev_idx on concept_prerequisites (prerequisite_id);
create table concept_relations (
  concept_id uuid not null references concepts(id) on delete cascade,
  related_id uuid not null references concepts(id) on delete cascade,
  kind text not null default 'related' check (kind in ('related','application','contrast')),
  primary key (concept_id, related_id, kind),
  check (concept_id <> related_id)
);
-- Syllabus mapping: which concepts matter for which exam, and how much.
create table exam_concepts (
  exam_id uuid not null references exams(id) on delete cascade,
  concept_id uuid not null references concepts(id) on delete cascade,
  relevance real not null default 0.5 check (relevance between 0 and 1),
  source_note text,
  primary key (exam_id, concept_id)
);
create index exam_concepts_concept_idx on exam_concepts (concept_id);

-- Prevent prerequisite cycles.
create or replace function app.prevent_prereq_cycle() returns trigger language plpgsql as $$
begin
  if exists (
    with recursive up(id) as (
      select new.prerequisite_id
      union
      select cp.prerequisite_id from concept_prerequisites cp join up on cp.concept_id = up.id
    ) select 1 from up where id = new.concept_id
  ) then raise exception 'prerequisite cycle detected'; end if;
  return new;
end $$;
create trigger concept_prereq_acyclic before insert or update on concept_prerequisites
  for each row execute function app.prevent_prereq_cycle();

do $$ declare t text; begin
  foreach t in array array['exams','subjects','exam_subjects','chapters','topics','concepts','concept_prerequisites','concept_relations','exam_concepts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_read', t);
    -- Curriculum writes: service role / migrations / seed only (no client write policies).
  end loop;
end $$;
