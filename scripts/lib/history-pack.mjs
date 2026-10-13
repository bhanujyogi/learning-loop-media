// Converts the "Indian History pilot" files (questions.jsonl + units.jsonl) into creator submissions that the
// `create-content` function accepts. Pure functions; no I/O. The pack itself is NOT stored in this repository.
export const IDS = {
  subject: 'c695fe12-9d9b-5ad6-8b52-c9d0aba28ebb',
  chapter: 'e0e48310-1704-55f4-950c-2f2d4d415c0d',
  topic: '7d594b04-8718-55a5-bbfe-6d8c2a30bf61',
  overview: '4f99b9fc-fbd1-59d0-8c90-e19f8ccdd85b',
  alauddin: '073c9e88-fc6a-5005-85ce-e136aa1b4d24',
  tughlaq: '267eef29-1725-515c-a946-0458ed9fa6ba',
};
/** Editable: which curriculum concept each pilot question group teaches (a content judgement, easy to change). */
export const CONCEPT_OF = {
  'Khilji dynasty — start': 'overview',
  'Order of rulers': 'overview',
  'Order of events': 'overview',
  'Matching ideas to rulers': 'overview',
  'Contemporary southern kingdoms': 'overview',
  'Alauddin — Chittor': 'alauddin',
  'Alauddin — land revenue': 'alauddin',
  'Army — dagh': 'alauddin',
  'Monument — builder': 'alauddin',
  'Tughlaq dynasty — founder': 'tughlaq',
  'Muhammad bin Tughlaq — token currency': 'tughlaq',
  'Firuz Shah — Ashokan pillars': 'tughlaq',
  'Timur and the end of Tughlaq rule': 'tughlaq',
  'Evidence — Ibn Battuta': 'tughlaq',
};
const LANG = new Set(['en', 'hi']);
const difficultyOf = (d) => (d?.level <= 2 ? 'easy' : d?.level === 3 ? 'medium' : 'hard');
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');

export function questionSubmission(row) {
  const p = row.payload;
  if (!LANG.has(row.language)) throw new Error(`${row.object_id}: unsupported language`);
  if (p.question_type !== 'single_choice' || p.options.length < 2 || p.correct.length !== 1)
    throw new Error(`${row.object_id}: only single-choice questions are supported`);
  const conceptKey = CONCEPT_OF[row.concept];
  if (!conceptKey) throw new Error(`${row.object_id}: no concept mapping for "${row.concept}"`);
  const ids = p.options.map((o, i) => 'abcdefgh'[i]);
  const idx = p.options.findIndex((o) => o.key === p.correct[0]);
  if (idx < 0) throw new Error(`${row.object_id}: correct key not among options`);
  return {
    kind: 'question',
    title: clip(p.stem.replace(/\s+/g, ' ').trim(), 110),
    language: row.language,
    conceptId: IDS[conceptKey],
    difficulty: difficultyOf(row.difficulty),
    body: {
      type: 'single_choice',
      prompt: p.stem,
      options: p.options.map((o, i) => ({ id: ids[i], text: o.text })),
    },
    answer: { optionId: ids[idx] },
    explanation: p.explanation,
  };
}

/** One overview note per language from the unit's own definition and key facts. */
export function noteSubmissions(unit) {
  return ['en', 'hi'].map((lang) => ({
    kind: 'note',
    title: clip(`${unit.concept[lang]}`, 110),
    language: lang,
    conceptId: IDS.overview,
    difficulty: difficultyOf(unit.difficulty),
    body: {
      blocks: [
        { type: 'heading', level: 1, text: unit.concept[lang] },
        { type: 'paragraph', text: unit.definition[lang] },
        ...unit.key_facts.map((f) => ({ type: 'paragraph', text: f[lang] })),
      ],
    },
  }));
}

export function buildPack({ questions, units }) {
  const items = [...questions.map(questionSubmission), ...units.flatMap(noteSubmissions)];
  return { generatedFrom: 'indian_history pilot', count: items.length, items };
}

export function curriculumSql() {
  return `-- Indian History curriculum for the Khilji/Tughlaq pack. Idempotent. Run once in the Supabase SQL editor.
-- Hindi names are machine-drafted and NOT reviewed by a native educator.
insert into subjects(id, slug, name, name_i18n) values
  ('${IDS.subject}', 'indian-history', 'Indian History', '{"hi":"भारतीय इतिहास"}')
  on conflict (id) do nothing;
insert into chapters(id, subject_id, slug, name, name_i18n) values
  ('${IDS.chapter}', '${IDS.subject}', 'delhi-sultanate', 'Delhi Sultanate', '{"hi":"दिल्ली सल्तनत"}')
  on conflict (id) do nothing;
insert into topics(id, chapter_id, slug, name, name_i18n) values
  ('${IDS.topic}', '${IDS.chapter}', 'khilji-tughlaq', 'Khilji and Tughlaq dynasties', '{"hi":"खिलजी और तुगलक वंश"}')
  on conflict (id) do nothing;
insert into concepts(id, topic_id, slug, name, name_i18n, description, difficulty) values
  ('${IDS.overview}', '${IDS.topic}', 'khilji-tughlaq-overview', 'Khilji and Tughlaq: overview', '{"hi":"खिलजी और तुगलक: अवलोकन"}', 'Order of rulers, dates and the big picture of the two dynasties.', 0.3),
  ('${IDS.alauddin}', '${IDS.topic}', 'alauddin-khilji', 'Alauddin Khilji', '{"hi":"अलाउद्दीन खिलजी"}', 'Conquests, revenue and army reforms, and monuments.', 0.4),
  ('${IDS.tughlaq}', '${IDS.topic}', 'tughlaq-dynasty', 'The Tughlaq dynasty', '{"hi":"तुगलक वंश"}', 'Ghiyasuddin, Muhammad bin Tughlaq, Firuz Shah and the end of the dynasty.', 0.4)
  on conflict (id) do nothing;
`;
}
