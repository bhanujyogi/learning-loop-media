-- Curriculum labels for the launch video reels (names only: no syllabus or exam-pattern claims; no exam mapping).
-- Idempotent; a no-op where the parent subject does not exist (e.g. a bare test database without the dev seed).
insert into chapters(id, subject_id, slug, name)
select v.id::uuid, s.id, v.slug, v.name from (values
  ('30000000-0000-0000-0000-000000000101', 'general-awareness', 'banking-awareness', 'Banking Awareness'),
  ('30000000-0000-0000-0000-000000000102', 'general-awareness', 'static-gk', 'Static GK'),
  ('30000000-0000-0000-0000-000000000103', 'quantitative-aptitude', 'time-speed-distance', 'Time, Speed and Distance')
) v(id, subj, slug, name) join subjects s on s.slug = v.subj
on conflict do nothing;

insert into topics(id, chapter_id, slug, name)
select v.id::uuid, c.id, v.slug, v.name from (values
  ('40000000-0000-0000-0000-000000000101', 'banking-awareness', 'rbi-and-banking', 'RBI and Banking'),
  ('40000000-0000-0000-0000-000000000102', 'static-gk', 'history-and-culture-gk', 'History, Culture and GK'),
  ('40000000-0000-0000-0000-000000000103', 'time-speed-distance', 'trains', 'Trains')
) v(id, chap, slug, name) join chapters c on c.slug = v.chap
on conflict do nothing;

insert into concepts(id, topic_id, slug, name, description, difficulty)
select v.id::uuid, t.id, v.slug, v.name, v.descr, v.diff from (values
  ('50000000-0000-0000-0000-000000000101', 'rbi-and-banking', 'rbi-and-banking-basics', 'RBI and banking basics', 'The Reserve Bank of India, its tools and banking terms.', 0.35),
  ('50000000-0000-0000-0000-000000000102', 'history-and-culture-gk', 'static-gk-mixed', 'Static GK (mixed)', 'Frequently asked history, culture, sports and general-knowledge facts.', 0.3),
  ('50000000-0000-0000-0000-000000000103', 'trains', 'train-speed-distance', 'Train speed and distance', 'Speed, time and distance problems involving trains.', 0.45)
) v(id, topic, slug, name, descr, diff) join topics t on t.slug = v.topic
on conflict do nothing;
