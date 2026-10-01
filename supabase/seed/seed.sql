-- Learning Loop DEV SEED. Synthetic/demo data only (docs/DEVELOPMENT.md). Never run against production.
-- Exam entries carry NO syllabus/pattern claims: they are placeholders to be populated from authoritative,
-- cited sources by the content pipeline (docs/CONTENT_INGESTION.md).

-- Official organization + publishing identities (permissions are granted via roles, not names)
insert into organizations(id, slug, name, kind) values ('00000000-0000-0000-0000-0000000000a1', 'learning-loop', 'Learning Loop', 'official');
insert into publishing_identities(id, organization_id, slug, name, kind) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'll-official', 'Learning Loop Official', 'service');

insert into exams(id, slug, name, region, level, description, metadata) values
  ('10000000-0000-0000-0000-000000000001', 'ssc-cgl', 'SSC CGL', 'IN', 'graduate', 'DEV PLACEHOLDER', '{"synthetic": true}'),
  ('10000000-0000-0000-0000-000000000002', 'rrb-ntpc', 'Railway RRB NTPC', 'IN', 'graduate', 'DEV PLACEHOLDER', '{"synthetic": true}'),
  ('10000000-0000-0000-0000-000000000003', 'ibps-po', 'Banking IBPS PO', 'IN', 'graduate', 'DEV PLACEHOLDER', '{"synthetic": true}'),
  ('10000000-0000-0000-0000-000000000004', 'rajasthan-ras', 'Rajasthan RAS', 'IN-RJ', 'graduate', 'DEV PLACEHOLDER', '{"synthetic": true}');

insert into subjects(id, slug, name) values
  ('20000000-0000-0000-0000-000000000001', 'quantitative-aptitude', 'Quantitative Aptitude'),
  ('20000000-0000-0000-0000-000000000002', 'general-science', 'General Science'),
  ('20000000-0000-0000-0000-000000000003', 'general-awareness', 'General Awareness'),
  ('20000000-0000-0000-0000-000000000004', 'reasoning', 'Reasoning');
insert into exam_subjects(exam_id, subject_id) select e.id, s.id from exams e cross join subjects s;

insert into chapters(id, subject_id, slug, name) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'arithmetic', 'Arithmetic'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'physics', 'Physics'),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'indian-geography', 'Indian Geography'),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', 'series', 'Series');
insert into topics(id, chapter_id, slug, name) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'percentages', 'Percentages'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'interest', 'Interest'),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', 'electricity', 'Electricity'),
  ('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000003', 'states-and-capitals', 'States and Capitals'),
  ('40000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000004', 'number-series', 'Number Series');
insert into concepts(id, topic_id, slug, name, description, difficulty) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'percentage-basics', 'Percentage basics', 'A percentage is a number expressed as a fraction of 100.', 0.2),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'percentage-change', 'Percentage change', 'Increase or decrease relative to the original value.', 0.45),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000002', 'simple-interest', 'Simple interest', 'SI = P × R × T / 100.', 0.4),
  ('50000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000003', 'ohms-law', 'Ohm''s law', 'V = I × R for ohmic conductors.', 0.35),
  ('50000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000004', 'state-capitals', 'State capitals', 'Capital cities of Indian states.', 0.25),
  ('50000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000005', 'arithmetic-series', 'Arithmetic series', 'Sequences with a constant difference.', 0.3);
insert into concept_prerequisites(concept_id, prerequisite_id) values
  ('50000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001');
insert into exam_concepts(exam_id, concept_id, relevance, source_note)
  select e.id, c.id, 0.5, 'dev placeholder — replace with cited syllabus mapping' from exams e cross join concepts c;

-- Official demo content (synthetic). Inserted as the privileged seed path; real official content goes through publish_content().
do $$
declare
  org uuid := '00000000-0000-0000-0000-0000000000a1'; pid uuid := '00000000-0000-0000-0000-0000000000b1';
  c_note uuid := '60000000-0000-0000-0000-000000000001'; c_q1 uuid := '60000000-0000-0000-0000-000000000002';
  c_q2 uuid := '60000000-0000-0000-0000-000000000003'; c_q3 uuid := '60000000-0000-0000-0000-000000000004';
  c_fc uuid := '60000000-0000-0000-0000-000000000005'; c_int uuid := '60000000-0000-0000-0000-000000000006';
  v uuid;
  rec record;
begin
  -- notes / flashcard / interactive
  for rec in select * from (values
    (c_note, 'note', 'Ohm''s law in 60 seconds', 'curiosity', 'note', 0.3, '50000000-0000-0000-0000-000000000004'::uuid, '{"blocks":[{"type":"heading","level":1,"text":"Ohm''s law"},{"type":"paragraph","text":"For an ohmic conductor, voltage V equals current I times resistance R."},{"type":"formula","latex":"V = I \\times R"},{"type":"callout","kind":"example","text":"A 2 A current through a 5 ohm resistor needs 10 V."},{"type":"revision_prompt","prompt":"If V stays fixed and R doubles, what happens to I?"}]}'::jsonb),
    (c_fc, 'flashcard', 'Simple interest formula', 'speed', 'flashcard', 0.3, '50000000-0000-0000-0000-000000000003'::uuid, '{"front":"Simple interest formula?","back":"SI = P × R × T / 100"}'::jsonb),
    (c_int, 'interactive', 'Tap to reveal: Ohm''s law units', 'curiosity', 'interactive', 0.25, '50000000-0000-0000-0000-000000000004'::uuid, '{"kind":"tap_reveal","items":[{"id":"v","label":"V","reveal":"Voltage, measured in volts"},{"id":"i","label":"I","reveal":"Current, measured in amperes"},{"id":"r","label":"R","reveal":"Resistance, measured in ohms"}]}'::jsonb)
  ) as t(id, type, title, hook, format, difficulty, concept, body) loop
    insert into content_items(id, type, title, ownership, owner_org_id, publishing_identity_id, source_type, verification, publishing, moderation, hook, format, difficulty, learning_objective, published_at, latest_version_no)
      values (rec.id, rec.type::content_type, rec.title, 'official', org, pid, 'original', 'official', 'published', 'none', rec.hook::hook_type, rec.format::format_type, rec.difficulty, 'Synthetic dev content', now(), 1);
    insert into content_versions(content_id, version_no, state, body, frozen_at) values (rec.id, 1, 'published', rec.body, now()) returning id into v;
    update content_items set current_version_id = v where id = rec.id;
    insert into content_concepts(content_id, concept_id) values (rec.id, rec.concept);
    insert into content_exams(content_id, exam_id) select rec.id, id from exams;
    insert into content_provenance(content_version_id, generated_by, process_name, publishing_identity_id, validation_status, review_status)
      values (v, 'human', 'dev-seed', pid, 'passed', 'reviewed');
  end loop;

  -- questions: public body WITHOUT answer; key + explanation separate
  for rec in select * from (values
    (c_q1, 'Resistance unit', 'challenge', 0.25, '50000000-0000-0000-0000-000000000004'::uuid,
      '{"type":"single_choice","prompt":"What is the SI unit of electrical resistance?","options":[{"id":"a","text":"Ohm"},{"id":"b","text":"Volt"},{"id":"c","text":"Ampere"},{"id":"d","text":"Watt"}]}'::jsonb,
      '{"optionId":"a"}'::jsonb, 'Resistance is measured in ohms (symbol Ω), named after Georg Ohm.'),
    (c_q2, 'Ohm''s law calculation', 'challenge', 0.4, '50000000-0000-0000-0000-000000000004'::uuid,
      '{"type":"numerical","prompt":"A 2 A current flows through a 5 ohm resistor. What is the voltage across it, in volts?"}'::jsonb,
      '{"value":10,"tolerance":0}'::jsonb, 'By Ohm''s law V = I × R = 2 × 5 = 10 volts.'),
    (c_q3, 'Rajasthan capital', 'question', 0.15, '50000000-0000-0000-0000-000000000005'::uuid,
      '{"type":"fill_blank","prompt":"The capital of Rajasthan is ____."}'::jsonb,
      '{"accepted":["Jaipur"],"caseSensitive":false}'::jsonb, 'Jaipur, also called the Pink City, is the capital of Rajasthan.')
  ) as t(id, title, hook, difficulty, concept, body, answer, explanation) loop
    insert into content_items(id, type, title, ownership, owner_org_id, publishing_identity_id, source_type, verification, publishing, moderation, hook, format, difficulty, learning_objective, published_at, latest_version_no)
      values (rec.id, 'question', rec.title, 'official', org, pid, 'original', 'official', 'published', 'none', rec.hook::hook_type, 'question', rec.difficulty, 'Synthetic dev content', now(), 1);
    insert into content_versions(content_id, version_no, state, body, frozen_at) values (rec.id, 1, 'published', rec.body, now()) returning id into v;
    update content_items set current_version_id = v where id = rec.id;
    insert into content_answer_keys(content_version_id, answer, explanation) values (v, rec.answer, rec.explanation);
    insert into content_concepts(content_id, concept_id, role) values (rec.id, rec.concept, 'assesses');
    insert into content_exams(content_id, exam_id) select rec.id, id from exams;
    insert into content_provenance(content_version_id, generated_by, process_name, publishing_identity_id, validation_status, review_status)
      values (v, 'human', 'dev-seed', pid, 'passed', 'reviewed');
  end loop;
end $$;

insert into ranking_versions(version, algorithm, status, activated_at, notes) values
  ('ranking_v1', '{"source":"packages/config RANKING_V1"}', 'active', now(), 'Initial interpretable ranking; weights are configurable starting points, not proven optimal.');

insert into achievements(code, name, description, criteria) values
  ('first_correct', 'First correct answer', 'Answer your first question correctly', '{"correct_answers": 1}'),
  ('streak_3', 'Three-day streak', 'Learn on three consecutive days', '{"streak": 3}'),
  ('concept_mastered_1', 'Concept mastered', 'Demonstrate mastery of a concept', '{"mastered": 1}'),
  ('review_10', 'Review habit', 'Complete 10 spaced-repetition reviews', '{"reviews": 10}');
