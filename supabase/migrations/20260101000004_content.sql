-- Content model. Independent dimensions: ownership, source_type, verification, publishing, moderation, freshness.

create table content_items (
  id uuid primary key default gen_random_uuid(),
  type content_type not null,
  title text not null check (length(title) between 1 and 200),
  summary text not null default '' check (length(summary) <= 1000),
  language text not null default 'en' check (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  -- ownership (structural, never username-based)
  ownership ownership_kind not null,
  owner_user_id uuid references profiles(id) on delete set null,
  owner_org_id uuid references organizations(id),
  publishing_identity_id uuid references publishing_identities(id),
  uploader_id uuid references auth.users(id) on delete set null,
  -- independent state dimensions
  source_type source_type not null default 'original',
  verification verification_status not null default 'unverified',
  publishing publishing_status not null default 'draft',
  moderation moderation_status not null default 'none',
  freshness freshness_status not null default 'current',
  -- learning/feed metadata
  hook hook_type,
  format format_type,
  difficulty real check (difficulty is null or difficulty between 0 and 1),
  expected_seconds int check (expected_seconds is null or expected_seconds between 1 and 7200),
  learning_objective text check (learning_objective is null or length(learning_objective) <= 500),
  current_version_id uuid,
  latest_version_no int not null default 0,
  published_at timestamptz,
  deleted_at timestamptz,
  search tsvector generated always as (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(summary,''))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint official_needs_identity check (ownership <> 'official' or (owner_org_id is not null and publishing_identity_id is not null)),
  constraint non_official_needs_user check (ownership = 'official' or owner_user_id is not null),
  constraint official_not_user_owned check (ownership <> 'official' or owner_user_id is null)
);
create index content_items_feed_idx on content_items (published_at desc, id desc) where publishing = 'published' and deleted_at is null;
create index content_items_owner_idx on content_items (owner_user_id, updated_at desc);
create index content_items_type_idx on content_items (type, publishing);
create index content_items_search_idx on content_items using gin (search);
create index content_items_org_idx on content_items (owner_org_id) where owner_org_id is not null;
create trigger content_items_touch before update on content_items for each row execute function app.touch_updated_at();

-- Versions: exactly one mutable draft; published versions are frozen (audit-grade history).
create table content_versions (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references content_items(id) on delete cascade,
  version_no int not null,
  state text not null default 'draft' check (state in ('draft','published','superseded')),
  schema_version text not null default 'content_schema_v1',
  body jsonb not null check (pg_column_size(body) < 1048576),
  change_note text check (change_note is null or length(change_note) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  frozen_at timestamptz,
  unique (content_id, version_no)
);
create unique index content_versions_one_draft_idx on content_versions (content_id) where state = 'draft';
alter table content_items add constraint content_items_current_version_fk
  foreign key (current_version_id) references content_versions(id) deferrable initially deferred;
create trigger content_versions_touch before update on content_versions for each row execute function app.touch_updated_at();

-- Answer keys + explanations live apart from the public body so clients cannot read answers early.
create table content_answer_keys (
  content_version_id uuid primary key references content_versions(id) on delete cascade,
  answer jsonb not null,
  explanation text not null default ''
);

create or replace function app.freeze_versions() returns trigger language plpgsql as $$
begin
  if old.state <> 'draft' and (new.body is distinct from old.body or new.version_no is distinct from old.version_no or new.content_id is distinct from old.content_id) then
    raise exception 'published content versions are immutable (create a new version)' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger content_versions_freeze before update on content_versions for each row execute function app.freeze_versions();

create or replace function app.freeze_answer_keys() returns trigger language plpgsql as $$
declare st text;
begin
  select state into st from content_versions where id = coalesce(new.content_version_id, old.content_version_id);
  if st is not null and st <> 'draft' then raise exception 'answer key of a published version is immutable' using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;
create trigger answer_keys_freeze before update or delete on content_answer_keys for each row execute function app.freeze_answer_keys();

-- Graph links
create table content_concepts (
  content_id uuid not null references content_items(id) on delete cascade,
  concept_id uuid not null references concepts(id) on delete cascade,
  role text not null default 'primary' check (role in ('primary','secondary','prerequisite','assesses')),
  primary key (content_id, concept_id)
);
create index content_concepts_concept_idx on content_concepts (concept_id);
create table content_exams (
  content_id uuid not null references content_items(id) on delete cascade,
  exam_id uuid not null references exams(id) on delete cascade,
  primary key (content_id, exam_id)
);
create index content_exams_exam_idx on content_exams (exam_id);
create table content_relations (
  from_content_id uuid not null references content_items(id) on delete cascade,
  to_content_id uuid not null references content_items(id) on delete cascade,
  kind text not null check (kind in ('related_content','prerequisite_content','followup_content','alternative_explanation','related_question','related_quiz','related_flashcard','related_interactive')),
  primary key (from_content_id, to_content_id, kind),
  check (from_content_id <> to_content_id)
);
create index content_relations_to_idx on content_relations (to_content_id);

-- Courses: Course → Module → items. Items are REFERENCES to reusable content, never copies.
create table course_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references content_items(id) on delete cascade,
  position int not null default 0,
  title text not null check (length(title) between 1 and 200),
  unique (course_id, position)
);
create table module_items (
  module_id uuid not null references course_modules(id) on delete cascade,
  content_id uuid not null references content_items(id) on delete restrict,
  position int not null,
  primary key (module_id, position)
);
create index module_items_content_idx on module_items (content_id);

-- Media metadata (binary lives in a StorageProvider, never in Postgres).
create table media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete set null,
  owner_org_id uuid references organizations(id),
  content_id uuid references content_items(id) on delete set null,
  storage_provider text not null default 'supabase',
  bucket text not null,
  storage_key text not null,
  variant text not null default 'original' check (variant in ('original','processed','thumbnail','poster','caption')),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 2147483648),
  duration_ms int check (duration_ms is null or duration_ms >= 0),
  width int, height int,
  checksum_sha256 text check (checksum_sha256 is null or checksum_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending','ready','rejected')),
  created_at timestamptz not null default now(),
  unique (storage_provider, bucket, storage_key)
);
create index media_assets_content_idx on media_assets (content_id);
create index media_assets_owner_idx on media_assets (owner_user_id);

-- ---------------------------------------------------------------- guards
-- Visibility predicate shared by policies: post-moderation model (flagged/restricted/removed are hidden).
create or replace function app.content_visible(c content_items) returns boolean language sql stable as $$
  select c.publishing = 'published' and c.deleted_at is null
     and c.moderation in ('none','cleared','pending_review')
     and c.freshness <> 'archived'
     and not (c.owner_user_id is not null and app.is_blocked_between(auth.uid(), c.owner_user_id))
$$;
