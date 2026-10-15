// Pure helpers for scripts/hosted-setup.mjs (unit-tested; no I/O, no network).
export const PROJECT_REF = 'qwgsabpiqexfhndojckv';
export const FUNCTIONS = ['onboarding', 'feed', 'events', 'submit-answer', 'create-content'];

/** `20260102000006_ugc_launch_safety.sql` → `ugc_launch_safety` (hosted history stores apply-time versions, so match by name). */
export const migrationName = (file) => file.replace(/^\d+_/, '').replace(/\.sql$/, '');
export const pendingMigrations = (files, appliedNames) =>
  files
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => !appliedNames.includes(migrationName(f)));

/** Strict: the email is inlined into SQL (the SQL endpoint has no parameters), so reject anything unusual. */
export const isSafeEmail = (e) =>
  typeof e === 'string' &&
  e.length <= 254 &&
  /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(e);

export const roleSql = (email) => {
  if (!isSafeEmail(email)) throw new Error('unsafe or invalid email');
  const e = email.toLowerCase();
  return `
insert into user_roles(user_id, role) select id, 'admin' from auth.users where lower(email) = '${e}' on conflict do nothing;
insert into user_roles(user_id, role) select id, 'moderator' from auth.users where lower(email) = '${e}' on conflict do nothing;
insert into creator_profiles(user_id, trust_level) select id, 'trusted' from auth.users where lower(email) = '${e}'
  on conflict (user_id) do update set trust_level = 'trusted';
select (select count(*) from auth.users where lower(email) = '${e}') as accounts_found,
       (select count(*) from user_roles r join auth.users u on u.id = r.user_id where lower(u.email) = '${e}' and r.role in ('admin','moderator')) as staff_roles,
       (select count(*) from creator_profiles c join auth.users u on u.id = c.user_id where lower(u.email) = '${e}' and c.trust_level = 'trusted') as trusted;`;
};

/** Files uploaded with a function: its folder, the shared runtime/import map, and package sources (no tests). */
export const includeInBundle = (path) =>
  (path.startsWith('supabase/functions/') && !path.endsWith('.lock')) ||
  (/^packages\/[^/]+\/src\//.test(path) && path.endsWith('.ts') && !path.endsWith('.test.ts'));

/** Refuses any ref other than this project's. */
export function assertProject(ref) {
  if (ref !== PROJECT_REF)
    throw new Error(`refusing to touch project "${ref}"; this script only manages ${PROJECT_REF}`);
}
