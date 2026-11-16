// Logic checks for migrations 016–018 on an in-memory Postgres (PGlite): coach switching,
// paging long set histories, a former coach's history cutoff, archive/undo/leave, anon grants
// and push endpoint cleanup. Nothing touches Supabase or the network.
// Earlier migrations depend on Supabase's auth and storage schemas, so the tables and
// functions these migrations build on are stubbed with just the columns they use.
// Run: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
const q = (sql, params) => db.query(sql, params);
const migration = (name) => db.exec(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}
async function as(uid, sql, params) {
  await db.exec(`set role authenticated; set app.uid = '${uid}'`);
  try { return (await q(sql, params)).rows; } finally { await db.exec("reset role"); }
}
async function asError(uid, sql) {
  try { await as(uid, sql); return ""; } catch (e) { return e.message; }
}

// ───────────────────────── Stub schema (what 016–018 build on) ─────────────────────────
await db.exec(`
create role anon; create role authenticated;
create schema auth; create schema storage;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create type public.relationship_status as enum ('active','archived');
create type public.user_role as enum ('coach','client');
create table public.profiles (id uuid primary key, role public.user_role, full_name text default '',
  goal_type text, experience_level text, injuries text, training_days_per_week smallint);
create table public.coach_clients (id uuid primary key default gen_random_uuid(), coach_id uuid references public.profiles(id),
  client_id uuid references public.profiles(id), status public.relationship_status not null default 'active',
  created_at timestamptz default now(), archived_at timestamptz);
create unique index coach_clients_one_active on public.coach_clients (client_id) where status = 'active';
create table public.invitations (id uuid primary key default gen_random_uuid(), coach_id uuid, token text,
  expires_at timestamptz default now() + interval '7 days', accepted_by uuid, accepted_at timestamptz, revoked boolean default false);
create table public.plans (id uuid primary key default gen_random_uuid(), coach_id uuid, client_id uuid, name text, is_active boolean default false);
create unique index plans_one_active_per_client on public.plans (client_id) where is_active;
create table public.nutrition_plans (id uuid primary key default gen_random_uuid(), coach_id uuid, client_id uuid, name text);
create unique index nutrition_plans_one_per_client on public.nutrition_plans (client_id) where client_id is not null;
create table public.nutrition_plan_meals (id uuid primary key default gen_random_uuid(),
  plan_id uuid references public.nutrition_plans(id) on delete cascade);
create table public.movements (id uuid primary key, name text);
create table public.exercises (id uuid primary key, movement_id uuid, primary_muscles text[], secondary_muscles text[]);
create table public.workout_sessions (id uuid primary key default gen_random_uuid(), client_id uuid, scheduled_date date,
  name text default 'W', started_at timestamptz default now());
create table public.session_exercises (id uuid primary key default gen_random_uuid(), session_id uuid, exercise_id uuid,
  exercise_name text default 'Ex', is_bodyweight boolean default false, position int default 0);
create table public.session_sets (id uuid primary key default gen_random_uuid(), session_exercise_id uuid, set_number int,
  weight_kg numeric, reps int default 5, completed boolean default true, set_type text default 'normal');
create table public.meal_entries (id uuid primary key default gen_random_uuid(), client_id uuid, entry_date date);
create table public.body_weights (id uuid primary key default gen_random_uuid(), client_id uuid, entry_date date);
create table public.body_measurements (id uuid primary key default gen_random_uuid(), client_id uuid, entry_date date);
create table public.progress_photos (id uuid primary key default gen_random_uuid(), client_id uuid, taken_on date, storage_path text);
create table public.nutrition_targets (client_id uuid primary key, updated_at timestamptz default now());
create table public.muscle_targets (client_id uuid, muscle text, updated_at timestamptz default now());
create table public.push_subscriptions (id uuid primary key default gen_random_uuid(), user_id uuid, endpoint text unique);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
create function public.is_coach_of(p_client uuid, p_active_only boolean default false) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.coach_clients cc where cc.coach_id = auth.uid() and cc.client_id = p_client
    and (not p_active_only or cc.status = 'active')); $$;
create function public.my_role() returns public.user_role language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid(); $$;
create function public.get_invitation(p_token text) returns text language sql as $$ select 'valid' $$;
-- placeholders that 017/018 replace
create function public.session_access(p_session uuid, p_write boolean) returns boolean language sql as $$ select false $$;
create function public.set_client_status(p_client uuid, p_status public.relationship_status) returns void language sql as $$ select $$;
create function public.coach_update_client(p_client uuid, p_goal_type text, p_experience_level text, p_injuries text, p_training_days smallint)
  returns void language sql as $$ select $$;
create function public.accept_invitation(p_token text) returns uuid language sql as $$ select null::uuid $$;
create function public.forget_push_endpoints(p_endpoints text[]) returns void language sql as $$ select $$;
create function public.is_coach_of_folder(p_folder text) returns boolean language sql as $$ select true $$;
grant usage on schema storage, auth to authenticated, anon;
grant execute on all functions in schema auth to authenticated;
grant select on storage.objects to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated, anon;
alter table storage.objects enable row level security;
create policy "progress photos: client and coach read" on storage.objects for select to authenticated using (true);
`);
for (const [table, policy] of [
  ["workout_sessions", "read sessions"], ["meal_entries", "read meals"], ["body_weights", "read body weight"],
  ["body_measurements", "read body measurements"], ["progress_photos", "read progress photos"],
  ["nutrition_targets", "read targets"], ["muscle_targets", "read muscle targets"],
]) {
  await db.exec(`alter table public.${table} enable row level security;
    create policy "${policy}" on public.${table} for select to authenticated using (true);`);
}

const A = "00000000-0000-0000-0000-0000000000a1"; // coach
const B = "00000000-0000-0000-0000-0000000000b1"; // coach
const C = "00000000-0000-0000-0000-0000000000c1"; // client who already switched A → B before 016
const D = "00000000-0000-0000-0000-0000000000d1"; // client still with A
const E = "00000000-0000-0000-0000-0000000000e1"; // client for the 017 checks
await db.exec(`insert into public.profiles (id, role) values ('${A}','coach'),('${B}','coach'),('${C}','client'),('${D}','client'),('${E}','client');`);

// ───────────────────────── 016: coach switch + paging ─────────────────────────
console.log("\n016 coach switch and paging");
await db.exec(`
insert into public.coach_clients (coach_id, client_id, status, archived_at) values ('${A}','${C}','archived', now()), ('${B}','${C}','active', null), ('${A}','${D}','active', null);
insert into public.plans (coach_id, client_id, name, is_active) values ('${A}','${C}','A plan for C', true), ('${A}','${D}','A plan for D', true);
insert into public.nutrition_plans (coach_id, client_id, name) values ('${A}','${C}','A diet for C'), ('${A}','${D}','A diet for D');
insert into public.nutrition_plan_meals (plan_id) select id from public.nutrition_plans;`);
await migration("20261116000016_paging_and_coach_switch.sql");

let r = await q(`select client_id, is_active from public.plans`);
check("cleanup deactivates the old coach's plan for a switched client", r.rows.find((x) => x.client_id === C).is_active === false);
check("cleanup keeps the plan of a client who didn't switch", r.rows.find((x) => x.client_id === D).is_active === true);
r = await q(`select client_id from public.nutrition_plans`);
check("cleanup removes the old coach's diet only for the switched client", r.rows.length === 1 && r.rows[0].client_id === D);
check("meals of a removed diet go with it", (await q(`select count(*)::int n from public.nutrition_plan_meals`)).rows[0].n === 1);
let err = "";
try {
  await q(`insert into public.plans (coach_id, client_id, name, is_active) values ($1,$2,'B plan',true)`, [B, C]);
  await q(`insert into public.nutrition_plans (coach_id, client_id, name) values ($1,$2,'B diet')`, [B, C]);
} catch (e) { err = e.message; }
check("new coach can assign a plan and a diet after the switch", err === "", err);

await q(`update public.coach_clients set status = 'archived' where coach_id = $1 and client_id = $2`, [A, D]);
check("archiving alone leaves the plan alone", (await q(`select is_active from public.plans where client_id = $1`, [D])).rows[0].is_active);
await q(`insert into public.coach_clients (coach_id, client_id) values ($1,$2)`, [B, D]);
check("joining a new coach deactivates the old coach's plan", !(await q(`select is_active from public.plans where client_id = $1`, [D])).rows[0].is_active);
check("joining a new coach removes the old coach's diet", (await q(`select count(*)::int n from public.nutrition_plans where client_id = $1`, [D])).rows[0].n === 0);

// More than 1,000 sets, paged 1,000 at a time like rpcAll(): every row exactly once, newest included.
const days = 120, exercisesPerDay = 4, setsPerExercise = 6; // 2,880 sets
await q(`insert into public.workout_sessions (client_id, scheduled_date, started_at)
  select $1, current_date - g, now() - g * interval '1 day' from generate_series(0, ${days - 1}) g`, [D]);
await q(`insert into public.session_exercises (session_id, exercise_name, position)
  select s.id, 'Ex' || g, 0 from public.workout_sessions s cross join generate_series(1, ${exercisesPerDay}) g where s.client_id = $1`, [D]); // ties on position
await q(`insert into public.session_sets (session_exercise_id, set_number)
  select se.id, n from public.session_exercises se join public.workout_sessions s on s.id = se.session_id
  cross join generate_series(1, ${setsPerExercise}) n where s.client_id = $1`, [D]);
const total = days * exercisesPerDay * setsPerExercise;
const pageAll = async () => {
  const keys = [];
  for (let from = 0; ; from += 1000) {
    const page = (await q(`select session_id || '|' || exercise_name || '|' || set_number k, performed_on::text d
      from public.completed_sets($1, current_date - 365, current_date) offset ${from} limit 1000`, [D])).rows;
    keys.push(...page);
    if (page.length < 1000) break;
  }
  return keys;
};
const paged = await pageAll();
check(`paging ${total} sets in pages of 1000 returns each exactly once`,
  paged.length === total && new Set(paged.map((x) => x.k)).size === total, `${paged.length} rows, ${new Set(paged.map((x) => x.k)).size} distinct`);
const today = (await q(`select current_date::text d`)).rows[0].d;
check("the newest day's sets are included", paged.some((x) => x.d === today));
check("pages come back in the same order every time", (await pageAll()).map((x) => x.k).join() === paged.map((x) => x.k).join());

// ───────────────────────── 017: former coach access ─────────────────────────
console.log("\n017 former coach access");
await migration("20261116000017_former_coach_access.sql");
await db.exec(`
insert into public.coach_clients (coach_id, client_id, status, archived_at) values ('${A}','${E}','archived', now() - interval '10 days'), ('${B}','${E}','active', null);
insert into public.workout_sessions (client_id, scheduled_date) values ('${E}', current_date - 20), ('${E}', current_date - 2);
insert into public.meal_entries (client_id, entry_date) values ('${E}', current_date - 20), ('${E}', current_date - 2);
insert into public.body_weights (client_id, entry_date) values ('${E}', current_date - 20), ('${E}', current_date - 2);
insert into public.progress_photos (client_id, taken_on, storage_path) values ('${E}', current_date - 20, '${E}/old.jpg'), ('${E}', current_date - 2, '${E}/new.jpg');
insert into storage.objects (bucket_id, name) values ('progress-photos','${E}/old.jpg'), ('progress-photos','${E}/new.jpg');
insert into public.nutrition_targets (client_id) values ('${E}');`);

check("former coach sees sessions only up to the end", (await as(A, `select 1 from public.workout_sessions where client_id = $1`, [E])).length === 1);
check("former coach sees meals only up to the end", (await as(A, `select 1 from public.meal_entries`)).length === 1);
check("former coach sees weights only up to the end", (await as(A, `select 1 from public.body_weights`)).length === 1);
check("former coach sees photo rows only up to the end", (await as(A, `select 1 from public.progress_photos`)).length === 1);
const files = await as(A, `select name from storage.objects`);
check("former coach reads only the older photo file", files.length === 1 && files[0].name.endsWith("old.jpg"));
check("former coach can't see targets changed after the end", (await as(A, `select 1 from public.nutrition_targets`)).length === 0);
check("current coach sees everything", (await as(B, `select 1 from public.workout_sessions where client_id = $1`, [E])).length === 2);
check("client reads their own files", (await as(E, `select 1 from storage.objects`)).length === 2);

check("former coach can't edit coaching details", /Not your client/.test(await asError(A, `select public.coach_update_client('${E}','strength',null,null,null)`)));
check("current coach can edit coaching details", (await asError(B, `select public.coach_update_client('${E}','strength',null,null,null)`)) === "");
check("an old archive can't be restored by the coach", /new invite/.test(await asError(A, `select public.set_client_status('${E}','active')`)));
await as(B, `select public.set_client_status('${E}','archived')`);
check("coach can undo their own archive straight away", (await asError(B, `select public.set_client_status('${E}','active')`)) === "");
await as(E, `select public.leave_coach()`);
r = await q(`select status, archived_by from public.coach_clients where coach_id = $1 and client_id = $2`, [B, E]);
check("client can leave their coach", r.rows[0].status === "archived" && r.rows[0].archived_by === E);
check("coach can't undo a client leaving", /new invite/.test(await asError(B, `select public.set_client_status('${E}','active')`)));
check("leaving without a coach errors", /don't have a coach/.test(await asError(E, `select public.leave_coach()`)));
await db.exec(`update public.coach_clients set status='archived', archived_at=now(), archived_by='${A}' where coach_id='${A}' and client_id='${E}';
  update public.coach_clients set status='active', archived_at=null, archived_by=null where coach_id='${B}' and client_id='${E}';`);
check("undo is blocked once the client has another coach", /another coach/.test(await asError(A, `select public.set_client_status('${E}','active')`)));

// ───────────────────────── 018: anon lockdown, push endpoints ─────────────────────────
console.log("\n018 anon lockdown and push endpoints");
await migration("20261116000018_anon_lockdown_push.sql");
const anonTables = (await q(`select count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege('anon', c.oid, 'select')`)).rows[0].n;
check("anon can't read any public table", anonTables === 0, `${anonTables} readable`);
const anonFns = (await q(`select coalesce(string_agg(p.proname, ', '), '') s from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype and has_function_privilege('anon', p.oid, 'execute')`)).rows[0].s;
check("anon can only call get_invitation", anonFns === "get_invitation", anonFns);
check("signed-in users can still call the access helpers", (await q(`select has_function_privilege('authenticated', 'public.coach_can_see(uuid, date)', 'execute') v`)).rows[0].v);
check("clear_previous_coach_plans stays closed", !(await q(`select has_function_privilege('authenticated', 'public.clear_previous_coach_plans()', 'execute') v`)).rows[0].v);
await db.exec(`create table public.added_later (id int); `);
check("tables added later aren't granted to anon", !(await q(`select has_table_privilege('anon', 'public.added_later', 'select') v`)).rows[0].v);

await db.exec(`insert into public.push_subscriptions (user_id, endpoint) values
  ('${E}', 'https://push.example/e'), ('${A}', 'https://push.example/a'), ('${B}', 'https://push.example/b'), ('${D}', 'https://push.example/d');`);
// E's active coach is B; A is E's former coach; D is another client of B.
await as(E, `select public.forget_push_endpoints(array['https://push.example/a', 'https://push.example/d'])`);
check("can't remove devices of a former coach or of someone else's client", (await q(`select count(*)::int n from public.push_subscriptions`)).rows[0].n === 4);
await as(E, `select public.forget_push_endpoints(array['https://push.example/b', 'https://push.example/e'])`);
check("can remove your own and your coach's devices", (await q(`select count(*)::int n from public.push_subscriptions`)).rows[0].n === 2);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll database checks passed");
process.exit(failures ? 1 : 0);
