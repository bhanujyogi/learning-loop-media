-- Source registry, provenance (never discarded), pipeline jobs, quality gates.

create table sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,80}$'),
  name text not null,
  url text not null check (url ~ '^https?://'),
  source_type text not null default 'website' check (source_type in ('website','dataset','repository','document','api','manual')),
  publisher text, author text,
  language text not null default 'en',
  subjects text[] not null default '{}',
  license license_code not null default 'unknown',
  license_url text,
  attribution_required boolean not null default true,
  commercial_use_allowed boolean,     -- null = unknown (treated as NOT allowed by the license gate)
  redistribution_allowed boolean,
  modification_allowed boolean,
  trust trust_level not null default 'needs_review',
  status text not null default 'pending' check (status in ('pending','active','paused','blocked')),
  last_checked_at timestamptz,
  notes text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger sources_touch before update on sources for each row execute function app.touch_updated_at();

-- Source permission changes are never silent.
create or replace function app.audit_source_terms() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if (new.license, new.license_url, new.commercial_use_allowed, new.redistribution_allowed, new.modification_allowed, new.trust, new.status)
     is distinct from (old.license, old.license_url, old.commercial_use_allowed, old.redistribution_allowed, old.modification_allowed, old.trust, old.status) then
    insert into audit_log(actor_id, actor_kind, action, target_kind, target_id, metadata)
    values (auth.uid(), case when auth.uid() is null then 'service' else 'user' end, 'source.terms_changed', 'source', new.id::text,
      jsonb_build_object('old', jsonb_build_object('license', old.license, 'redistribution', old.redistribution_allowed, 'commercial', old.commercial_use_allowed, 'modification', old.modification_allowed, 'trust', old.trust, 'status', old.status),
                         'new', jsonb_build_object('license', new.license, 'redistribution', new.redistribution_allowed, 'commercial', new.commercial_use_allowed, 'modification', new.modification_allowed, 'trust', new.trust, 'status', new.status)));
  end if;
  return new;
end $$;
create trigger sources_audit after update on sources for each row execute function app.audit_source_terms();

-- Each retrieval is a document snapshot with the terms in force at that time.
create table source_documents (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  url text not null,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  retrieved_at timestamptz not null default now(),
  license_snapshot jsonb not null,   -- terms as recorded at retrieval
  status text not null default 'fetched' check (status in ('fetched','extracted','rejected','superseded')),
  unique (source_id, content_hash)    -- idempotent re-ingest
);
create index source_documents_source_idx on source_documents (source_id, retrieved_at desc);

create table content_provenance (
  id uuid primary key default gen_random_uuid(),
  content_version_id uuid not null unique references content_versions(id) on delete cascade,
  transformation text,
  generated_by text not null check (generated_by in ('human','pipeline','model')),
  model_identifier text, model_version text, prompt_version text, process_name text,
  generated_at timestamptz not null default now(),
  publishing_identity_id uuid references publishing_identities(id),
  validation_status text not null default 'pending' check (validation_status in ('pending','passed','failed')),
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed','reviewed','needs_review')),
  constraint ai_provenance_complete check (generated_by <> 'model' or (model_identifier is not null and prompt_version is not null))
);
create table content_provenance_sources (
  provenance_id uuid not null references content_provenance(id) on delete cascade,
  source_id uuid not null references sources(id),
  source_document_id uuid references source_documents(id),
  license_snapshot jsonb not null,    -- terms frozen at time of derivation (history survives later source edits)
  primary key (provenance_id, source_id)
);

create table pipeline_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('discover_sources','fetch_source','extract_content','normalize_content','generate_learning_objects','validate_content','deduplicate_content','publish_content')),
  status job_status not null default 'queued',
  source_id uuid references sources(id),
  content_id uuid references content_items(id),
  publishing_identity_id uuid references publishing_identities(id),
  idempotency_key text not null unique,
  attempts int not null default 0,
  max_attempts int not null default 5,
  payload jsonb not null default '{}',
  result jsonb,
  error text check (error is null or length(error) <= 2000),   -- sanitized (content-engine sanitizeError)
  run_after timestamptz not null default now(),
  started_at timestamptz, finished_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pipeline_jobs_queue_idx on pipeline_jobs (status, run_after) where status in ('queued','retrying');
create trigger pipeline_jobs_touch before update on pipeline_jobs for each row execute function app.touch_updated_at();

create or replace function app.guard_job_transition() returns trigger language plpgsql as $$
declare ok boolean;
begin
  if new.status = old.status then return new; end if;
  ok := (old.status, new.status) in (('queued','running'),('queued','cancelled'),('running','completed'),('running','failed'),('running','retrying'),('running','cancelled'),('retrying','running'),('retrying','failed'),('retrying','cancelled'),('failed','retrying'));
  if not ok then raise exception 'illegal job transition % -> %', old.status, new.status; end if;
  return new;
end $$;
create trigger pipeline_jobs_transition before update on pipeline_jobs for each row execute function app.guard_job_transition();

create table quality_gate_results (
  content_version_id uuid not null references content_versions(id) on delete cascade,
  gate text not null,
  passed boolean not null,
  messages text[] not null default '{}',
  checked_at timestamptz not null default now(),
  checked_by uuid,
  primary key (content_version_id, gate)
);

do $$ declare t text; begin
  foreach t in array array['sources','source_documents','content_provenance','content_provenance_sources','pipeline_jobs','quality_gate_results'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Source registry & jobs: staff only. Provenance: readable for visible content (attribution is public).
create policy sources_staff on sources for all to authenticated using (app.has_permission('sources.manage')) with check (app.has_permission('sources.manage'));
create policy source_docs_staff on source_documents for all to authenticated using (app.has_permission('sources.manage')) with check (app.has_permission('sources.manage'));
create policy jobs_staff_read on pipeline_jobs for select to authenticated using (app.has_permission('pipeline.run') or app.has_permission('analytics.read'));
create policy jobs_staff_insert on pipeline_jobs for insert to authenticated with check (app.has_permission('pipeline.run') and status = 'queued');
create policy jobs_staff_update on pipeline_jobs for update to authenticated using (app.has_permission('pipeline.run')) with check (app.has_permission('pipeline.run'));

create policy provenance_read on content_provenance for select to authenticated using (
  exists (select 1 from content_versions v where v.id = content_version_id and (v.state = 'published' or app.owns_content(v.content_id) or app.has_permission('moderation.review'))));
create policy provenance_write on content_provenance for all to authenticated
  using (exists (select 1 from content_versions v where v.id = content_version_id and app.owns_content(v.content_id) and v.state = 'draft'))
  with check (exists (select 1 from content_versions v where v.id = content_version_id and app.owns_content(v.content_id) and v.state = 'draft'));
create policy provenance_sources_read on content_provenance_sources for select to authenticated using (exists (select 1 from content_provenance p where p.id = provenance_id));
create policy provenance_sources_write on content_provenance_sources for all to authenticated
  using (exists (select 1 from content_provenance p join content_versions v on v.id = p.content_version_id where p.id = provenance_id and app.owns_content(v.content_id) and v.state = 'draft'))
  with check (exists (select 1 from content_provenance p join content_versions v on v.id = p.content_version_id where p.id = provenance_id and app.owns_content(v.content_id) and v.state = 'draft'));

-- Gate results are written ONLY by the validation pipeline (pipeline.run) — never by the content's author.
create policy gates_read on quality_gate_results for select to authenticated using (
  exists (select 1 from content_versions v where v.id = content_version_id and (app.owns_content(v.content_id) or app.has_permission('moderation.review') or app.has_permission('pipeline.run'))));
create policy gates_write on quality_gate_results for all to authenticated using (app.has_permission('pipeline.run')) with check (app.has_permission('pipeline.run'));
