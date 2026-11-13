import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

// End-to-end acceptance flows from the brief, run with SEPARATE browser contexts
// (separate cookies/sessions) for the coach and the client.
// Needs: seeded demo data, `npm run dev` on BASE_URL (default http://localhost:3000).

const PASSWORD = "demo-pass-123";
const ALEX = "22222222-2222-2222-2222-222222222222";
const stamp = Date.now();
const client = { name: `Taylor Test ${stamp}`, email: `taylor.${stamp}@test.dev`, password: "test-pass-123" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const todayIso = (() => { const d = new Date().getDay(); return d === 0 ? 7 : d; })();

let coachCtx: BrowserContext, clientCtx: BrowserContext;
let coach: Page, cli: Page;
let clientId = "";
let workoutDay = "";
let firstExercise = "";
let originalTarget = "";

async function login(browser: Browser, email: string, mobile: boolean) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true } : { viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return { ctx, page };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  ({ ctx: coachCtx, page: coach } = await login(browser, "coach@demo.test", false));
  clientCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  cli = await clientCtx.newPage();
});

test.afterAll(async () => {
  await coachCtx?.close();
  await clientCtx?.close();
});

test("1. coach invites a client, client accepts, both see the relationship", async () => {
  await coach.goto("/coach/invite");
  await coach.getByLabel(/Who is this for/).fill(client.name);
  await coach.getByRole("button", { name: /Create & copy link/ }).click();
  const link = await coach.getByTestId("invite-link").first().textContent();
  expect(link).toContain("/invite/");

  await cli.goto(link!.replace(/^https?:\/\/[^/]+/, ""));
  await expect(cli.getByRole("heading", { name: /Demo Coach \(Sample\) invited you/ })).toBeVisible();
  await cli.getByRole("link", { name: "Create client account" }).click();
  await cli.getByLabel("Full name").fill(client.name);
  await cli.getByLabel("Email").fill(client.email);
  await cli.getByLabel("Password").fill(client.password);
  await cli.getByRole("button", { name: "Create account" }).click();

  await cli.getByRole("button", { name: "Accept invitation" }).click();
  await cli.waitForURL("**/onboarding");
  await cli.getByLabel("Fitness goal").fill("Get stronger (test)");
  await cli.getByRole("radio", { name: "lb" }).click();
  await cli.getByRole("button", { name: "Continue" }).click();
  await cli.waitForURL("**/today");
  await expect(cli.getByText(/Demo Coach \(Sample\) hasn't assigned a plan yet/)).toBeVisible();

  // Invite links are single-use
  await cli.goto(link!.replace(/^https?:\/\/[^/]+/, ""));
  await expect(cli.getByText(/already been used/)).toBeVisible();

  await coach.goto("/coach/clients");
  await coach.getByRole("link", { name: new RegExp(client.name) }).click();
  await coach.waitForURL(/\/coach\/clients\/[0-9a-f-]{36}/);
  clientId = coach.url().split("/coach/clients/")[1].split(/[?#]/)[0];
  await expect(coach.getByRole("heading", { name: client.name })).toBeVisible();
});

test("2. coach assigns a split; the correct workout appears on the client's Today screen", async () => {
  await coach.getByRole("tab", { name: "Plan" }).click();
  await coach.getByLabel("Template").selectOption({ label: "Push / Pull / Legs (Sample)" });
  await coach.getByLabel("Plan name (optional)").fill(`PPL for ${client.name}`);
  await coach.getByRole("button", { name: /Copy & assign/ }).click();
  await coach.waitForURL(/\/coach\/plans\//);
  await expect(coach.getByText(`Assigned to ${client.name}`)).toBeVisible();

  // Find the day scheduled today; on Sunday (unscheduled in the template) schedule Push.
  const days = coach.locator("main section[aria-label]");
  const n = await days.count();
  for (let i = 0; i < n; i++) {
    const pressed = await days.nth(i).getByRole("button", { name: WEEKDAYS[todayIso - 1], exact: true }).getAttribute("aria-pressed");
    if (pressed === "true") workoutDay = (await days.nth(i).getAttribute("aria-label"))!;
  }
  if (!workoutDay) {
    await days.first().getByRole("button", { name: WEEKDAYS[todayIso - 1], exact: true }).click();
    await expect(days.first().getByRole("button", { name: WEEKDAYS[todayIso - 1], exact: true })).toHaveAttribute("aria-pressed", "true");
    workoutDay = (await days.first().getAttribute("aria-label"))!;
  }

  await cli.goto("/today");
  await expect(cli.getByRole("heading", { name: workoutDay, exact: true })).toBeVisible();
  await expect(cli.getByRole("button", { name: "Start Workout" })).toBeVisible();
});

test("3. client logs sets, closes the app mid-session, resumes, completes; coach sees it", async () => {
  await cli.getByRole("button", { name: "Start Workout" }).click();
  await cli.waitForURL(/\/training\/session\//);
  const sessionUrl = cli.url();
  const first = cli.locator("main section[aria-label]").first();
  firstExercise = (await first.getAttribute("aria-label"))!;
  originalTarget = (await first.locator("h2 + span").textContent())!.split("·")[0].trim(); // e.g. "4 × 5-8"

  await first.getByLabel("Set 1 weight in lb").fill("135");
  await first.getByLabel("Set 1 reps").fill("8");
  await first.getByRole("button", { name: "Complete set 1" }).click();
  await expect(first.getByRole("button", { name: "Mark set 1 not done" })).toBeVisible();
  // set 2 accepts the suggestion from set 1 with a single tap
  await first.getByRole("button", { name: "Complete set 2" }).click();
  await expect(first.getByRole("button", { name: "Mark set 2 not done" })).toBeVisible();

  // Set 3 is logged with no connection, then the app is closed before it could sync.
  await clientCtx.setOffline(true);
  await first.getByRole("button", { name: "Complete set 3" }).click();
  await expect(first.getByText(/Not synced yet/)).toBeVisible();

  // "Close the app": drop the page entirely and open a fresh one.
  await cli.close();
  await clientCtx.setOffline(false);
  cli = await clientCtx.newPage();
  await cli.goto("/today");
  await cli.getByRole("button", { name: "Resume workout" }).click();
  await cli.waitForURL(sessionUrl);
  const again = cli.locator("main section[aria-label]").first();
  await expect(again.getByLabel("Set 1 weight in lb")).toHaveValue("135");
  await expect(again.getByLabel("Set 1 reps")).toHaveValue("8");
  await expect(again.getByRole("button", { name: "Mark set 2 not done" })).toBeVisible();
  await expect(again.getByRole("button", { name: "Mark set 3 not done" })).toBeVisible(); // synced on reopen

  await cli.getByRole("button", { name: "Finish workout" }).click();
  await cli.waitForURL(/\/today/);
  await expect(cli.getByText("Workout saved")).toBeVisible();
  await expect(cli.getByText("Completed", { exact: true })).toBeVisible();

  await coach.goto(`/coach/clients/${clientId}?tab=workouts`);
  const row = coach.getByRole("button", { name: new RegExp(workoutDay) }).first();
  await expect(row).toContainText("Completed");
  await row.click();
  await expect(coach.getByText(firstExercise).first()).toBeVisible();
  await expect(coach.getByRole("cell", { name: "135 lb" }).first()).toBeVisible();
});

test("4. coach updates a future workout; the completed workout keeps original targets and results", async () => {
  await coach.goto(`/coach/clients/${clientId}?tab=plan`);
  await coach.getByRole("link", { name: "Edit plan" }).click();
  await coach.waitForURL(/\/coach\/plans\//);
  const day = coach.getByRole("region", { name: workoutDay, exact: true });
  const sets = day.getByLabel("Sets").first();
  await sets.fill("6");
  await sets.press("Tab");
  const maxReps = day.getByLabel("Max reps").first();
  await maxReps.fill("20");
  await maxReps.press("Tab");
  await expect(coach.getByText("All changes saved")).toBeVisible();
  await coach.reload();
  await expect(coach.getByRole("region", { name: workoutDay, exact: true }).getByLabel("Sets").first()).toHaveValue("6");

  // Client's completed session still shows the original prescription and logged sets.
  await cli.goto("/training");
  await cli.getByRole("tab", { name: "History" }).click();
  await cli.getByRole("link", { name: new RegExp(workoutDay) }).first().click();
  const first = cli.locator("main section[aria-label]").first();
  await expect(first).toContainText(originalTarget);
  await expect(first.getByLabel("Set 1 weight in lb")).toHaveValue("135");

  // The plan itself (future workouts) shows the new target.
  await cli.goto("/training");
  await expect(cli.getByText(/6 × \d+-20/).first()).toBeVisible();

  // Coach review of the completed session also shows the original target.
  await coach.goto(`/coach/clients/${clientId}?tab=workouts`);
  await coach.getByRole("button", { name: new RegExp(workoutDay) }).first().click();
  const [s, r] = originalTarget.split("×").map((x) => x.trim());
  await expect(coach.getByText(`Target ${s} × ${r}`).first()).toBeVisible();
});

test("5. client logs and edits a meal; totals update and the coach sees the revision", async () => {
  await cli.goto("/nutrition");
  const lunch = cli.locator("section", { has: cli.getByRole("heading", { name: "lunch" }) });
  await lunch.getByRole("button", { name: "Add food" }).click();
  const dialog = cli.getByRole("dialog", { name: "Add food" });
  await dialog.getByLabel("Food").fill("Test chicken bowl");
  await dialog.getByLabel("Serving size").fill("1 bowl");
  await dialog.getByLabel("Calories (kcal)").fill("600");
  await dialog.getByLabel("Protein g").fill("45");
  await dialog.getByLabel("Carbs g").fill("60");
  await dialog.getByLabel("Fat g").fill("15");
  await dialog.getByRole("button", { name: "Add food" }).click();
  await expect(cli.getByText("Test chicken bowl")).toBeVisible();
  await expect(cli.getByText(/^600$/).first()).toBeVisible(); // calories total

  await cli.getByRole("button", { name: "Edit Test chicken bowl" }).click();
  const edit = cli.getByRole("dialog", { name: "Edit food" });
  await edit.getByLabel("Food").fill("Test chicken bowl (large)");
  await edit.getByLabel("Calories (kcal)").fill("750");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(cli.getByText("Test chicken bowl (large)")).toBeVisible();
  await expect(cli.getByText(/^750$/).first()).toBeVisible();

  await coach.goto(`/coach/clients/${clientId}?tab=nutrition`);
  await coach.getByRole("textbox", { name: "Calories", exact: true }).fill("2400");
  await coach.getByLabel("Protein (g)").fill("170");
  await coach.getByLabel("Carbs (g)").fill("260");
  await coach.getByLabel("Fat (g)").fill("70");
  await coach.getByRole("button", { name: "Save targets" }).click();
  await expect(coach.getByText("Targets saved.")).toBeVisible();
  await expect(coach.getByText("Test chicken bowl (large)")).toBeVisible();
  await expect(coach.getByText(/750 kcal/).first()).toBeVisible();

  await cli.reload();
  await expect(cli.getByRole("progressbar", { name: "Calories" })).toHaveAttribute("aria-valuemax", "2400");
});

test("6. coach and client chat live in two sessions; history and unread counts persist", async () => {
  const hello = `Hello from coach ${stamp}`;
  const reply = `Reply from client ${stamp}`;
  await coach.goto(`/coach/messages?client=${clientId}`);
  await cli.goto("/chat");
  await expect(cli.getByText("Live")).toBeVisible();
  await expect(coach.getByText("Live")).toBeVisible();

  await coach.getByLabel("Message").fill(hello);
  await coach.getByRole("button", { name: "Send" }).click();
  await expect(cli.getByText(hello)).toBeVisible(); // arrives without refresh

  await cli.getByLabel("Message").fill(reply);
  await cli.getByRole("button", { name: "Send" }).click();
  await expect(coach.getByText(reply)).toBeVisible();

  // Unread: client is elsewhere when the coach writes
  await cli.goto("/today");
  const ping = `Unread check ${stamp}`;
  await coach.getByLabel("Message").fill(ping);
  await coach.getByRole("button", { name: "Send" }).click();
  await expect(coach.getByText(ping)).toBeVisible();
  await expect(cli.locator("[aria-label=\"1 unread\"]:visible")).toBeVisible(); // live badge
  await cli.reload();
  await expect(cli.locator("[aria-label=\"1 unread\"]:visible")).toBeVisible(); // persisted
  await cli.goto("/chat");
  await expect(cli.getByText(ping)).toBeVisible();
  await expect(cli.locator("[aria-label=\"1 unread\"]:visible")).toHaveCount(0);

  // History persists across reloads
  await coach.reload();
  await expect(coach.getByText(hello)).toBeVisible();
  await expect(coach.getByText(reply)).toBeVisible();

  // Failed send → retry, without duplicates
  const flaky = `Sent while offline ${stamp}`;
  await clientCtx.setOffline(true);
  await cli.getByLabel("Message").fill(flaky);
  await cli.getByRole("button", { name: "Send" }).click();
  await expect(cli.getByRole("button", { name: /Not sent/ })).toBeVisible();
  await clientCtx.setOffline(false);
  await cli.getByRole("button", { name: /Not sent/ }).click();
  await expect(cli.getByRole("button", { name: /Not sent/ })).toHaveCount(0);
  await expect(coach.getByText(flaky)).toHaveCount(1);
  await cli.reload();
  await expect(cli.getByText(flaky)).toHaveCount(1);
});

test("7. a client cannot reach another client's data; an unrelated coach is denied", async ({ browser }) => {
  // Look up a real session id of Alex's, as Alex's coach, straight from the API
  const env = Object.fromEntries(
    readFileSync(".env.local", "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  const api = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await api.auth.signInWithPassword({ email: "coach@demo.test", password: PASSWORD });
  const { data: alexRow } = await api.from("workout_sessions").select("id").eq("client_id", ALEX).limit(1).single();
  const alexSession = alexRow!.id as string;

  // The new client swaps in Alex's ids
  await cli.goto(`/training/session/${alexSession}`);
  await expect(cli.getByText("Workout not found")).toBeVisible();
  await cli.goto(`/coach/clients/${ALEX}`);
  await expect(cli).toHaveURL(/\/today/); // clients can't open coach routes at all

  // Coach outside the relationship
  const { ctx, page } = await login(browser, "coach2@demo.test", false);
  await page.goto(`/coach/clients/${ALEX}`);
  await expect(page.getByText("Client not found")).toBeVisible();
  await page.goto(`/coach/clients/${clientId}`);
  await expect(page.getByText("Client not found")).toBeVisible();
  await ctx.close();
});

// ── Resilience ──────────────────────────────────────────────────────────────

test("8. the client app opens offline, queues a meal, and syncs it on reconnect", async () => {
  // Visit pages online once so the service worker caches them.
  await cli.goto("/today");
  await cli.evaluate(async () => { await navigator.serviceWorker.ready; });
  await cli.reload(); // now controlled by the service worker
  await expect(cli.getByRole("heading", { name: /^Hi,/ })).toBeVisible();
  await cli.goto("/nutrition");
  await expect(cli.getByText("Test chicken bowl (large)")).toBeVisible();

  await clientCtx.setOffline(true);
  await cli.goto("/today");
  await expect(cli.getByRole("heading", { name: /^Hi,/ })).toBeVisible(); // page served offline
  await expect(cli.getByText(/^Offline. You can keep logging/)).toBeVisible();

  await cli.goto("/nutrition");
  await expect(cli.getByText("Test chicken bowl (large)")).toBeVisible(); // last-loaded data
  const snack = cli.locator("section", { has: cli.getByRole("heading", { name: "snack" }) });
  await snack.getByRole("button", { name: "Add food" }).click();
  const dialog = cli.getByRole("dialog", { name: "Add food" });
  await dialog.getByLabel("Food").fill(`Offline banana ${stamp}`);
  await dialog.getByLabel("Serving size").fill("1 medium");
  await dialog.getByLabel("Calories (kcal)").fill("105");
  await dialog.getByRole("button", { name: "Add food" }).click();
  const row = cli.getByText(`Offline banana ${stamp}`);
  await expect(row).toBeVisible();
  await expect(cli.locator("li", { has: row }).getByText("Not synced")).toBeVisible();

  await clientCtx.setOffline(false);
  await expect(cli.locator("li", { has: row }).getByText("Not synced")).toHaveCount(0, { timeout: 20_000 });

  await coach.goto(`/coach/clients/${clientId}?tab=nutrition`);
  await expect(coach.getByText(`Offline banana ${stamp}`)).toHaveCount(1);
});

test("9. when the backend is down, signed-in users see 'reconnecting', not the login page", async () => {
  const { execSync } = await import("node:child_process");
  const gateway = "supabase_kong_GYM_TRACKER";
  execSync(`docker stop ${gateway}`, { stdio: "ignore" });
  try {
    await coach.goto("/coach");
    await expect(coach.getByRole("heading", { name: "Can't reach the server" })).toBeVisible({ timeout: 30_000 });
    expect(new URL(coach.url()).pathname).toBe("/coach"); // not bounced to /login
  } finally {
    execSync(`docker start ${gateway}`, { stdio: "ignore" });
  }
  // Recovers on its own once the backend is back.
  await expect(coach.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 60_000 });
});
