// Direct API checks for acceptance test 7: requests are sent straight to Supabase
// with each demo user's token (no UI), swapping in other users' IDs.
// Run: npm run test:rls   (needs the seeded demo data)
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !KEY) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (.env.local)");

const ALEX = "22222222-2222-2222-2222-222222222222";
const SAM = "33333333-3333-3333-3333-333333333333";

async function login(email) {
  const c = createClient(URL, KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: "demo-pass-123" });
  if (error) throw new Error(`${email}: ${error.message}`);
  return c;
}

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}
const rows = async (q) => {
  const { data, error } = await q;
  return { n: data?.length ?? 0, error };
};

const coach = await login("coach@demo.test");
const coach2 = await login("coach2@demo.test");
const alex = await login("alex@demo.test");
const sam = await login("sam@demo.test");
const anon = createClient(URL, KEY, { auth: { persistSession: false } });

// IDs belonging to Sam, looked up as Sam / Sam's coach
const samPlan = (await sam.from("plans").select("id, plan_days(id)").eq("client_id", SAM).eq("is_active", true).single()).data;
const samSession = (await sam.from("workout_sessions").select("id").eq("client_id", SAM).limit(1).single()).data;
const samConv = (await sam.from("conversations").select("id").eq("client_id", SAM).single()).data;
const samMeal = (await sam.from("meal_entries").select("id").eq("client_id", SAM).limit(1).single()).data;
const alexConv = (await alex.from("conversations").select("id").eq("client_id", ALEX).single()).data;
check("setup: found Sam's plan, session, conversation, meal", !!(samPlan && samSession && samConv && samMeal));

// Positive controls
check("Alex can read own sessions", (await rows(alex.from("workout_sessions").select("id").eq("client_id", ALEX))).n > 0);
check("Coach can read Alex's sessions", (await rows(coach.from("workout_sessions").select("id").eq("client_id", ALEX))).n > 0);

// Client → another client's data
for (const [label, q] of [
  ["profile", alex.from("profiles").select("id").eq("id", SAM)],
  ["plans", alex.from("plans").select("id").eq("client_id", SAM)],
  ["plan by id", alex.from("plans").select("id").eq("id", samPlan.id)],
  ["plan days", alex.from("plan_days").select("id").eq("plan_id", samPlan.id)],
  ["sessions", alex.from("workout_sessions").select("id").eq("client_id", SAM)],
  ["session by id", alex.from("workout_sessions").select("id").eq("id", samSession.id)],
  ["session exercises", alex.from("session_exercises").select("id").eq("session_id", samSession.id)],
  ["meals", alex.from("meal_entries").select("id").eq("client_id", SAM)],
  ["body weights", alex.from("body_weights").select("id").eq("client_id", SAM)],
  ["targets", alex.from("nutrition_targets").select("client_id").eq("client_id", SAM)],
  ["conversation", alex.from("conversations").select("id").eq("id", samConv.id)],
  ["messages", alex.from("messages").select("id").eq("conversation_id", samConv.id)],
  ["coach notes (any)", alex.from("coach_notes").select("id")],
]) {
  const r = await rows(q);
  check(`Alex cannot read Sam's ${label}`, r.n === 0, r.error?.message);
}

const w1 = await alex.from("meal_entries").insert({ client_id: SAM, entry_date: "2026-01-01", meal: "lunch", food_name: "x", serving: "1", calories: 1 });
check("Alex cannot insert a meal for Sam", !!w1.error, w1.error?.message);
const w2 = await alex.from("meal_entries").update({ calories: 9999 }).eq("id", samMeal.id).select();
check("Alex cannot edit Sam's meal", !!w2.error || (w2.data ?? []).length === 0);
const w3 = await alex.from("messages").insert({ id: crypto.randomUUID(), conversation_id: samConv.id, sender_id: ALEX, body: "hi" });
check("Alex cannot post into Sam's conversation", !!w3.error, w3.error?.message);
const w4 = await alex.from("messages").insert({ id: crypto.randomUUID(), conversation_id: alexConv.id, sender_id: SAM, body: "spoof" });
check("Alex cannot send as Sam", !!w4.error, w4.error?.message);
const w5 = await alex.rpc("start_session", { p_plan_day: samPlan.plan_days[0].id, p_date: "2026-01-05" });
check("Alex cannot start a session from Sam's plan", !!w5.error, w5.error?.message);
const w6 = await alex.from("profiles").update({ role: "coach" }).eq("id", ALEX);
check("Alex cannot change own role", !!w6.error, w6.error?.message);
const w7 = await alex.from("coach_clients").insert({ coach_id: "44444444-4444-4444-4444-444444444444", client_id: ALEX });
check("Alex cannot create a relationship directly", !!w7.error, w7.error?.message);

// Coach outside the relationship
for (const [label, q] of [
  ["profile", coach2.from("profiles").select("id").eq("id", ALEX)],
  ["plans", coach2.from("plans").select("id").eq("client_id", ALEX)],
  ["sessions", coach2.from("workout_sessions").select("id").eq("client_id", ALEX)],
  ["meals", coach2.from("meal_entries").select("id").eq("client_id", ALEX)],
  ["body weights", coach2.from("body_weights").select("id").eq("client_id", ALEX)],
  ["messages", coach2.from("messages").select("id").eq("conversation_id", alexConv.id)],
  ["coach notes", coach2.from("coach_notes").select("id").eq("client_id", ALEX)],
]) {
  const r = await rows(q);
  check(`Other coach cannot read Alex's ${label}`, r.n === 0, r.error?.message);
}
const c1 = await coach2.from("nutrition_targets").upsert({ client_id: ALEX, calories: 1, protein_g: 1, carbs_g: 1, fat_g: 1, updated_by: "44444444-4444-4444-4444-444444444444" });
check("Other coach cannot set Alex's targets", !!c1.error, c1.error?.message);
const c2 = await coach2.from("coach_notes").insert({ coach_id: "44444444-4444-4444-4444-444444444444", client_id: ALEX, body: "x" });
check("Other coach cannot add notes on Alex", !!c2.error, c2.error?.message);
const tpl = (await coach2.from("plans").insert({ coach_id: "44444444-4444-4444-4444-444444444444", name: "tmp rls" }).select("id").single()).data;
const c3 = await coach2.rpc("copy_plan", { p_source: tpl.id, p_name: "x", p_client: ALEX, p_start_date: "2026-01-01" });
check("Other coach cannot assign a plan to Alex", !!c3.error, c3.error?.message);
await coach2.from("plans").delete().eq("id", tpl.id);
const c4 = await coach2.rpc("set_client_status", { p_client: ALEX, p_status: "archived" });
check("Other coach cannot archive Alex", !!c4.error, c4.error?.message);
const c5 = await coach2.from("plans").update({ name: "hijack" }).eq("client_id", ALEX).select();
check("Other coach cannot edit Alex's plan", (c5.data ?? []).length === 0);

// Coach's private notes are private from the client
check("Client cannot read coach notes about them", (await rows(alex.from("coach_notes").select("id").eq("client_id", ALEX))).n === 0);

// Message retries are idempotent: the same client-generated id twice → one row
const mid = crypto.randomUUID();
const msg = { id: mid, conversation_id: alexConv.id, sender_id: ALEX, body: "Retry idempotency check (test)" };
const r1 = await alex.from("messages").upsert(msg, { onConflict: "id", ignoreDuplicates: true });
const r2 = await alex.from("messages").upsert(msg, { onConflict: "id", ignoreDuplicates: true });
const stored = await rows(alex.from("messages").select("id").eq("id", mid));
check("Retrying a send never duplicates the message", !r1.error && !r2.error && stored.n === 1, r1.error?.message || r2.error?.message);

// Profile header fields: coaching details only by the client's own coach; profiles only by their owner
const p1 = await coach2.rpc("coach_update_client", { p_client: ALEX, p_goal_type: "strength", p_experience_level: null, p_injuries: "x", p_training_days: 3 });
check("Other coach cannot edit Alex's coaching details", !!p1.error, p1.error?.message);
const p2 = await coach.from("profiles").update({ injuries: "hijack" }).eq("id", ALEX).select();
check("Coach cannot write Alex's profile row directly", (p2.data ?? []).length === 0);
const p3 = await sam.from("profiles").select("date_of_birth").eq("id", ALEX);
check("Client cannot read another client's profile", (p3.data ?? []).length === 0);

// Exercise library: only coaches add movements and exercise media
const m1 = await alex.from("movements").insert({ name: "rls tmp", pattern: "push", created_by: ALEX });
check("Client cannot add movements", !!m1.error, m1.error?.message);
const m2 = await alex.storage.from("exercise-media").upload(`${ALEX}/rls.png`, new Blob(["x"], { type: "image/png" }), { contentType: "image/png" });
check("Client cannot upload exercise media", !!m2.error, m2.error?.message);
const m3 = await alex.storage.from("avatars").upload(`${SAM}/rls.png`, new Blob(["x"], { type: "image/png" }), { contentType: "image/png" });
check("Client cannot upload into another user's avatar folder", !!m3.error, m3.error?.message);
const ownPath = `${ALEX}/rls-check-${Date.now()}.png`;
const m4 = await alex.storage.from("avatars").upload(ownPath, new Blob(["x"], { type: "image/png" }), { contentType: "image/png" });
check("Client can upload their own avatar", !m4.error, m4.error?.message);
const m5 = await alex.storage.from("avatars").remove([ownPath]);
check("Client can delete their own avatar", !m5.error && (m5.data ?? []).length === 1, m5.error?.message);

// Analytics: completed sets follow the same access rules as sessions
const allTime = { p_client: ALEX, p_from: "2000-01-01", p_to: "2100-01-01" };
const a1 = await coach2.rpc("completed_sets", allTime);
check("Other coach gets none of Alex's completed sets", !a1.error && (a1.data ?? []).length === 0, a1.error?.message);
const a2 = await sam.rpc("completed_sets", allTime);
check("Another client gets none of Alex's completed sets", !a2.error && (a2.data ?? []).length === 0, a2.error?.message);
const a3 = await coach.rpc("completed_sets", allTime);
check("Alex's coach sees Alex's completed sets", !a3.error && (a3.data ?? []).length > 0, a3.error?.message);
const a4 = await anon.rpc("completed_sets", allTime);
check("Anonymous cannot call completed_sets", !!a4.error || (a4.data ?? []).length === 0, a4.error?.message);

// Signed-out requests
check("Anonymous cannot read sessions", (await rows(anon.from("workout_sessions").select("id"))).n === 0);
check("Anonymous cannot read messages", (await rows(anon.from("messages").select("id"))).n === 0);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll access checks passed");
process.exit(failures ? 1 : 0);
