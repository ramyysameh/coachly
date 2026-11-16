import { createClient } from "@supabase/supabase-js";
import { loadTestEnv } from "./testEnv";
import { test, expect, type Browser, type Page } from "@playwright/test";
const PASSWORD = "demo-pass-123";
const stamp = Date.now();
async function phone(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return page;
}
const toast = (page: Page, text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text });
// first seeded template (the demo coach has PPL with exercises)
async function openFirstTemplate(page: Page) {
  await page.goto("/coach/plans");
  await page.locator('a[href^="/coach/plans/"]').first().click();
  await page.waitForURL("**/coach/plans/*");
}

test("profile save shows a toast that survives the redirect", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  await page.goto("/profile");
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.waitForURL("**/progress");
  const t = toast(page, "Profile updated");
  await expect(t).toBeVisible();
  const box = (await t.boundingBox())!;
  expect(box.y).toBeLessThan(200); // top of screen, clear of the bottom nav
});

test("coach target save toasts and keeps the acceptance copy", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  await page.goto("/coach/clients/22222222-2222-2222-2222-222222222222?tab=nutrition");
  await page.getByRole("button", { name: "Save targets" }).click();
  await expect(toast(page, "Targets saved.")).toBeVisible();
});

/** A Supabase client signed in as a demo account, for seeding and cleanup the UI can't do. */
async function signedInApi(email: string) {
  const env = loadTestEnv();
  const api = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: auth, error } = await api.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return { api, userId: auth.user!.id };
}

test("copying an invite link toasts", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/coach/invite");
  let token: string | undefined;
  try {
    await page.getByRole("button", { name: /Create & copy link/ }).click();
    await expect(toast(page, "Invite link copied")).toBeVisible();
    token = (await page.evaluate(() => navigator.clipboard.readText())).split("/invite/")[1];
    expect(token).toBeTruthy();
  } finally {
    // The invite exists only for this test; delete it so the coach's list doesn't grow every run.
    if (token) {
      const { api } = await signedInApi("coach@demo.test");
      const { error } = await api.from("invitations").delete().eq("token", token);
      expect(error).toBeNull();
    }
  }
});

test("a failed plan autosave toasts instead of an off-screen box", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  await openFirstTemplate(page);
  // one successful write first, so "All changes saved" is showing
  const sunday = page.getByRole("group", { name: /weekdays/ }).first().getByRole("button").last();
  await sunday.click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.route("**/rest/v1/plan_days**", (r) => r.fulfill({ status: 500, body: '{"message":"boom"}' }));
  await page.getByRole("button", { name: "Add workout day" }).click();
  await expect(toast(page, /boom|Something went wrong/)).toBeVisible();
  await expect(page.getByText("All changes saved")).toHaveCount(0);
  // restore the seeded weekday
  await page.unroute("**/rest/v1/plan_days**");
  await sunday.click();
  await expect(page.getByText("All changes saved")).toBeVisible();
});

// ---- Task 3: undo instead of confirm ----
// Anchored at the start, not exact: a meal still queued offline shows a "Not synced" badge inside the same text.
const food = (page: Page, name: string) =>
  page.locator("main").getByText(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(Not synced)?$`));
// Records native dialogs (and dismisses them, so a stray confirm cannot hang the page).
function trackDialogs(page: Page) {
  const seen: string[] = [];
  page.on("dialog", (d) => { seen.push(d.message()); void d.dismiss(); });
  return seen;
}
async function addMeal(page: Page, name: string) {
  await page.goto("/nutrition");
  await page.locator("main section", { hasText: "Snack" }).getByRole("button", { name: "Add food" }).click();
  const d = page.getByRole("dialog", { name: "Add food" });
  await d.getByLabel("Food").fill(name);
  await d.getByLabel("Serving size").fill("1");
  await d.getByLabel("Calories (kcal)").fill("100");
  await d.getByRole("button", { name: "Add food" }).click();
  await expect(food(page, name)).toBeVisible();
}
// Cleanup that is safe whether or not the test got far: back online, today, delete if still there.
async function removeMealIfPresent(page: Page, name: string) {
  await page.context().setOffline(false);
  await page.goto("/nutrition");
  const del = page.getByRole("button", { name: `Delete ${name}` });
  // the day has finished loading once the meal sections render
  await expect(page.locator("main").getByRole("button", { name: "Add food" }).first()).toBeVisible();
  if (await del.count()) {
    await del.click();
    await expect(food(page, name)).toHaveCount(0);
  }
}

test("meal delete has no confirm and can be undone", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  const name = `Undo apple ${stamp}`;
  try {
    await addMeal(page, name);
    const dialogs = trackDialogs(page);
    await page.getByRole("button", { name: `Delete ${name}` }).click();
    await expect(food(page, name)).toHaveCount(0);
    await toast(page, `Deleted "${name}"`).getByRole("button", { name: "Undo" }).click();
    await expect(food(page, name)).toBeVisible();
    await page.reload();
    await expect(food(page, name)).toBeVisible(); // restored on the server, not just locally
    expect(dialogs).toEqual([]);
  } finally {
    await removeMealIfPresent(page, name);
  }
});

test("undo restores a meal after changing day", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  const name = `Nav apple ${stamp}`;
  try {
    await addMeal(page, name);
    await page.getByRole("button", { name: `Delete ${name}` }).click();
    await page.getByRole("button", { name: "Previous day" }).click();
    await toast(page, name).getByRole("button", { name: "Undo" }).click();
    await page.getByRole("button", { name: "Next day" }).click();
    await expect(food(page, name)).toBeVisible();
  } finally {
    await removeMealIfPresent(page, name);
  }
});

test("meal undo works offline", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  const name = `Offline undo ${stamp}`;
  try {
    await addMeal(page, name);
    await page.context().setOffline(true);
    await page.getByRole("button", { name: `Delete ${name}` }).click();
    await toast(page, name).getByRole("button", { name: "Undo" }).click();
    await expect(food(page, name)).toBeVisible();
    await page.context().setOffline(false);
    await page.reload();
    await expect(food(page, name)).toBeVisible();
  } finally {
    await removeMealIfPresent(page, name);
  }
});

test("removing a plan exercise can be undone", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  await openFirstTemplate(page);
  const buttons = page.getByRole("button", { name: "Remove exercise" });
  await expect(buttons.first()).toBeVisible();
  const before = await buttons.count();
  try {
    const row = buttons.first();
    const label = await row.locator("xpath=ancestor::li[1]//p").first().innerText();
    await row.click();
    await toast(page, "Exercise removed").getByRole("button", { name: "Undo" }).click();
    await expect(buttons).toHaveCount(before);
    await expect(page.getByText(label.split("\n")[0]).first()).toBeVisible();
  } finally {
    // If the test failed between remove and undo, put the seeded exercise back.
    const undo = toast(page, "Exercise removed").getByRole("button", { name: "Undo" });
    if ((await buttons.count()) < before && (await undo.count())) await undo.click();
    await expect(buttons).toHaveCount(before);
  }
});

test("a deleted note can be undone", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  const body = `Undo note ${stamp}`;
  const noteLi = page.locator("li", { hasText: body });
  const clean = async () => {
    await page.goto("/coach/clients/22222222-2222-2222-2222-222222222222?tab=notes");
    // notes load after the form renders: wait for the empty state or the first note
    await expect(page.getByText("No notes yet").or(page.locator("main ul li").first())).toBeVisible();
    while (await noteLi.count()) {
      await noteLi.first().getByRole("button", { name: "Delete note" }).click();
      await page.waitForTimeout(300);
    }
  };
  try {
    await page.goto("/coach/clients/22222222-2222-2222-2222-222222222222?tab=notes");
    await page.getByPlaceholder("Add a private note…").fill(body);
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(noteLi).toHaveCount(1);
    const dialogs = trackDialogs(page);
    await noteLi.getByRole("button", { name: "Delete note" }).click();
    await expect(noteLi).toHaveCount(0);
    await toast(page, "Note deleted").getByRole("button", { name: "Undo" }).click();
    await expect(noteLi).toHaveCount(1);
    expect(dialogs).toEqual([]);
  } finally {
    await clean();
  }
});

test("archiving a client can be undone", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  const url = "/coach/clients/22222222-2222-2222-2222-222222222222";
  try {
    await page.goto(url);
    const dialogs = trackDialogs(page);
    await page.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByRole("link", { name: "Invite again" })).toBeVisible();
    await toast(page, "Client archived").getByRole("button", { name: "Undo" }).click();
    expect(dialogs).toEqual([]);
    await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
  } finally {
    // If Alex was left archived (this or an earlier, crashed run), reconnect him the way a real
    // client would: the coach's undo only works for 10 minutes, so Alex accepts a fresh invite.
    await page.goto(url);
    await expect(page.getByRole("button", { name: "Archive" }).or(page.getByRole("link", { name: "Invite again" }))).toBeVisible();
    if (await page.getByRole("link", { name: "Invite again" }).count()) await reconnectAlex();
  }
});

/** Reconnects Alex to the demo coach through a new invite, as the client would. */
async function reconnectAlex() {
  const { api: coachApi, userId: coachId } = await signedInApi("coach@demo.test");
  const { data: inv, error } = await coachApi.from("invitations").insert({ coach_id: coachId, note: "test cleanup" }).select("token").single();
  if (error) throw error;
  const { api: alexApi } = await signedInApi("alex@demo.test");
  const accepted = await alexApi.rpc("accept_invitation", { p_token: inv.token });
  if (accepted.error) throw accepted.error;
}

async function openPicker(page: Page) {
  await openFirstTemplate(page);
  await page.getByRole("button", { name: "Add exercise" }).first().click();
  return page.getByRole("dialog", { name: "Exercise library" });
}

test("picker fuzzy-matches and adds with the keyboard", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  await openFirstTemplate(page);
  // The picker opens from the first day's "Add exercise"; the added row lands at the end of that day's list.
  const addBtn = page.getByRole("button", { name: "Add exercise" }).first();
  // Only real exercise rows (with a Remove button), so an empty-state <li> can't skew the count or cleanup.
  const rows = addBtn.locator("xpath=preceding-sibling::ul[1]/li").filter({ has: page.getByRole("button", { name: "Remove exercise" }) });
  const removeBtn = (n: number) => rows.nth(n).getByRole("button", { name: "Remove exercise" });
  await expect(rows.first()).toBeVisible();
  const before = await rows.count();
  try {
    await addBtn.click();
    const picker = page.getByRole("dialog", { name: "Exercise library" });
    // Words match in any order; "press" makes the top hit unambiguous (the fly matches "dumb incl" just as well).
    await picker.getByLabel("Search exercises").fill("dumb incl press");
    // [cmdk-list]: the filter selects' <option>s also have the option role.
    const options = picker.locator("[cmdk-list]").getByRole("option");
    await expect(options.first()).toContainText("Incline Dumbbell Press");
    await page.keyboard.press("Enter");
    // The picker stays open for the next pick and marks what was added.
    await expect(picker.getByText(/^1 added to /)).toBeVisible();
    await expect(options.first()).toContainText("Added");
    await picker.getByRole("button", { name: "Done" }).click();
    await expect(picker).toHaveCount(0);
    await expect(rows).toHaveCount(before + 1);
    await expect(rows.last()).toContainText("Incline Dumbbell Press");
  } finally {
    // Remove exactly the row this test added, so seed data is unchanged.
    if (await page.getByRole("dialog", { name: "Exercise library" }).count()) await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Exercise library" })).toHaveCount(0);
    if ((await rows.count()) > before) await removeBtn(before).click();
    await expect(rows).toHaveCount(before);
  }
});

test("the picker stays open so several exercises can be added in order", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  await openFirstTemplate(page);
  const addBtn = page.getByRole("button", { name: "Add exercise" }).first();
  const rows = addBtn.locator("xpath=preceding-sibling::ul[1]/li").filter({ has: page.getByRole("button", { name: "Remove exercise" }) });
  await expect(rows.first()).toBeVisible();
  const before = await rows.count();
  try {
    await addBtn.click();
    const picker = page.getByRole("dialog", { name: "Exercise library" });
    const options = picker.locator("[cmdk-list]").getByRole("option");
    await picker.getByLabel("Search exercises").fill("press");
    await expect(options.nth(1)).toBeVisible();
    const nameOf = (i: number) => options.nth(i).locator(".truncate").first().innerText();
    const first = await nameOf(0);
    const second = await nameOf(1);
    await options.nth(0).click();
    await expect(picker.getByText(/^1 added to /)).toBeVisible();
    await expect(options.nth(0)).toContainText("Added");
    await options.nth(1).click();
    await expect(picker.getByText(/^2 added to /)).toBeVisible();
    await picker.getByRole("button", { name: "Done" }).click();
    await expect(picker).toHaveCount(0);
    await expect(rows).toHaveCount(before + 2);
    // Added in the order picked, after what the day already had.
    await expect(rows.nth(before)).toContainText(first);
    await expect(rows.nth(before + 1)).toContainText(second);
  } finally {
    if (await page.getByRole("dialog", { name: "Exercise library" }).count()) await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Exercise library" })).toHaveCount(0);
    while ((await rows.count()) > before) {
      const n = await rows.count();
      await rows.nth(before).getByRole("button", { name: "Remove exercise" }).click();
      await expect(rows).toHaveCount(n - 1);
    }
  }
});

test("quick weekday taps on a plan day are all saved", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  const name = `Weekdays ${stamp}`;
  try {
    await newTemplate(page, name);
    await page.getByRole("link", { name }).first().click();
    await page.waitForURL("**/coach/plans/*");
    const days = page.getByRole("group", { name: / weekdays$/ }).first();
    await expect(days).toBeVisible();
    const off = days.locator('button[aria-pressed="false"]');
    const labels = [await off.nth(0).innerText(), await off.nth(1).innerText()];
    // Two taps back to back, without waiting for the first save.
    await days.getByRole("button", { name: labels[0], exact: true }).click();
    await days.getByRole("button", { name: labels[1], exact: true }).click();
    for (const l of labels) await expect(days.getByRole("button", { name: l, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();
    await page.reload();
    for (const l of labels) await expect(days.getByRole("button", { name: l, exact: true })).toHaveAttribute("aria-pressed", "true");
  } finally {
    await removeTemplateIfPresent(page, name);
  }
});

test("login ignores a next link that points at another site", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("/login?next=//example.com/phish");
  await page.getByLabel("Email").fill("coach@demo.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  expect(new URL(page.url()).origin).toBe(new URL(test.info().project.use.baseURL ?? "http://localhost:3000").origin);
  // The fallback is "/", which then redirects a coach to their dashboard.
  await page.waitForURL(/\/coach$/);
});

test("Escape closes only the top sheet", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  const picker = await openPicker(page);
  await picker.getByRole("button", { name: /^About / }).first().click();
  // includeHidden: Radix marks the sheet underneath aria-hidden while another sheet is on top.
  const dialogs = page.getByRole("dialog", { includeHidden: true });
  await expect(dialogs).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(dialogs).toHaveCount(1);
  await expect(picker).toBeVisible();
  await expect(picker).toHaveAttribute("data-state", "open");
});

test("a nested sheet scales the sheet beneath it", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  const picker = await openPicker(page);
  await picker.getByRole("button", { name: /^About / }).first().click();
  await expect(page.getByRole("dialog", { includeHidden: true })).toHaveCount(2);
  // The picker is aria-hidden while the nested sheet is on top, so find it with includeHidden.
  const under = page.getByRole("dialog", { name: "Exercise library", includeHidden: true });
  const transform = () => under.evaluate((el) => getComputedStyle(el).transform);
  await expect.poll(transform).not.toBe("none");
  await expect.poll(transform).not.toBe("matrix(1, 0, 0, 1, 0, 0)");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { includeHidden: true })).toHaveCount(1);
});

test("sheet traps focus and restores it on close", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  const picker = await openPicker(page);
  await expect(picker).toHaveAttribute("aria-modal", "true");
  const inDialog = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  await expect.poll(inDialog).toBe(true);
  // Shift+Tab from the start of the sheet would leave it if focus were not trapped.
  await page.keyboard.press("Shift+Tab");
  expect(await inDialog()).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Add exercise" }).first()).toBeFocused();
});

test("calendar day sheet opens as a drawer with a handle", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  await page.goto("/progress");
  await page.getByRole("grid", { name: "Training calendar" }).getByRole("button").first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[data-vaul-handle]")).toBeVisible();
  // The day sheet has only a few focusables: Tab well past its end and focus must still be inside.
  for (let i = 0; i < 15; i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
});

test("submit stays on screen with the keyboard field focused", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  await page.goto("/nutrition");
  await page.locator("main section", { hasText: "Snack" }).getByRole("button", { name: "Add food" }).click();
  const d = page.getByRole("dialog", { name: "Add food" });
  await expect(d.locator("[data-vaul-handle]")).toBeVisible();
  await expect(d.getByLabel("Food")).toBeFocused();
  await d.getByLabel("Fat g").focus();
  await expect(d.getByRole("button", { name: "Add food" })).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(d).toHaveCount(0);
});

// NumberFlow sets role="img" + aria-label through ElementInternals, which Playwright's getByRole cannot see.
// Its shadow DOM does reach the aria snapshot as separate digits ("1 0 0 /2900 kcal"), so read the number
// that sits right before the "/target" in the scope.
async function flowValue(scope: ReturnType<Page["locator"]>) {
  const snap = await scope.ariaSnapshot();
  const digits = snap.match(/(\d(?:[\d,]| \d)*) \//)?.[1];
  return Number(digits?.replace(/[ ,]/g, "") ?? NaN);
}
// Same idea for a stat tile with no "/target": the number is the digits (with an optional ". d" decimal part)
// inside the value element, after the label line.
async function tileNumber(tile: ReturnType<Page["locator"]>) {
  const snap = await tile.locator("number-flow-react").ariaSnapshot();
  const m = snap.match(/\d(?:[\d,]| \d)*(?: ?\. ?\d(?: ?\d)*)?/);
  const n = Number(m?.[0].replace(/[ ,]/g, "") ?? NaN);
  expect(Number.isNaN(n), `no number in tile snapshot: ${snap}`).toBe(false);
  return n;
}

test("calorie meter number animates to the new total", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  const name = `Flow pear ${stamp}`;
  try {
    await page.goto("/nutrition");
    const meter = page.getByRole("progressbar", { name: "Calories" }).locator("xpath=..");
    const before = await flowValue(meter);
    await addMeal(page, name); // +100 kcal
    await expect.poll(() => flowValue(meter)).toBe(before + 100);
  } finally {
    await removeMealIfPresent(page, name);
  }
});

test("a recently logged food fills the Add food form in one tap", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  const name = `Recent ${stamp}`;
  try {
    await addMeal(page, name);
    await page.locator("main section", { hasText: "Lunch" }).getByRole("button", { name: "Add food" }).click();
    const d = page.getByRole("dialog", { name: "Add food" });
    await d.getByRole("group", { name: "Recently logged" }).getByRole("button", { name: new RegExp(name) }).click();
    await expect(d.getByLabel("Food")).toHaveValue(name);
    await expect(d.getByLabel("Serving size")).toHaveValue("1");
    await expect(d.getByLabel("Calories (kcal)")).toHaveValue("100");
    await page.keyboard.press("Escape");
    await expect(d).toHaveCount(0);
  } finally {
    await removeMealIfPresent(page, name);
  }
});

test("removing a set can be undone with its logged values", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  await page.goto("/training");
  await page.getByRole("tab", { name: "History" }).click();
  await page.locator('a[href^="/training/session/"]').first().click();
  const card = page.locator("main section[aria-label]").first();
  const checks = card.getByRole("button", { name: /^(Complete|Mark) set \d+/ });
  await expect(checks.first()).toBeVisible();
  const before = await checks.count();
  const n = (await checks.last().getAttribute("aria-label"))!.match(/\d+/)![0];
  const reps = await card.getByLabel(`Set ${n} reps`).inputValue();
  const done = await checks.last().getAttribute("aria-pressed");
  await card.getByRole("button", { name: "Remove last set" }).click();
  await expect(checks).toHaveCount(before - 1);
  await toast(page, `Set ${n} removed`).getByRole("button", { name: "Undo" }).click();
  await expect(checks).toHaveCount(before);
  await expect(card.getByLabel(`Set ${n} reps`)).toHaveValue(reps);
  await expect(checks.last()).toHaveAttribute("aria-pressed", done!);
  // And it's really back on the server, not just on screen.
  await page.reload();
  await expect(card.getByRole("button", { name: /^(Complete|Mark) set \d+/ })).toHaveCount(before);
});

test("set counter and progress bar update on check", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  await page.goto("/training");
  await page.getByRole("tab", { name: "History" }).click(); // session links live under History
  await page.locator('a[href^="/training/session/"]').first().click();
  const counterBox = page.locator("h1 + p");
  const bar = page.locator('div[aria-hidden="true"] > div.origin-left');
  await expect(counterBox).toContainText("sets");
  const before = await flowValue(counterBox);
  const total = Number((await counterBox.innerText()).match(/\/(\d+) sets/)![1]);
  // The seeded session is already completed: un-check one set and re-check it, so the data ends unchanged.
  const done = page.getByRole("button", { name: /^Mark set \d+ not done/ }).first();
  const n = (await done.getAttribute("aria-label"))!.match(/\d+/)![0];
  const scale = async () => (await bar.evaluate((el) => getComputedStyle(el).transform)).replace(/^matrix\(([^,]+),.*$/, "$1");
  try {
    await done.click();
    await expect.poll(() => flowValue(counterBox)).toBe(before - 1);
    await expect.poll(async () => Number(await scale())).toBeCloseTo((before - 1) / total, 2);
    await page.getByRole("button", { name: `Complete set ${n}` }).click();
    await expect.poll(() => flowValue(counterBox)).toBe(before);
    await expect.poll(async () => Number(await scale())).toBeCloseTo(before / total, 2);
  } finally {
    const check = page.getByRole("button", { name: `Complete set ${n}` });
    if (await check.count()) await check.click(); // the set keeps its reps and weight, so this restores it
    await expect.poll(() => flowValue(counterBox)).toBe(before);
  }
});

// ---- Task 6: ConfirmSheet ----
async function newTemplate(page: Page, name: string) {
  await page.goto("/coach/plans");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: /Create/ }).click();
  await page.waitForURL("**/coach/plans/*");
  await page.goto("/coach/plans");
}
// Cleanup that is safe whether or not the test got far.
async function removeTemplateIfPresent(page: Page, name: string) {
  await page.goto("/coach/plans");
  const del = page.getByRole("button", { name: `Delete ${name}` });
  await expect(page.getByRole("heading", { name: "Plan templates" })).toBeVisible();
  // The heading renders before the list loads; wait for the list (the seeded samples always exist),
  // or count() below reads 0 and the template leaks.
  await expect(page.locator('a[href^="/coach/plans/"]').first()).toBeVisible();
  if (await del.count()) {
    await del.click();
    await page.getByRole("dialog", { name: "Delete template?" }).getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText(name)).toHaveCount(0);
  }
}

test("deleting a template asks in a bottom sheet, not a native confirm", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  const name = `Tmp plan ${stamp}`;
  try {
    await newTemplate(page, name);
    const dialogs = trackDialogs(page);
    await page.getByRole("button", { name: `Delete ${name}` }).click();
    const sheet = page.getByRole("dialog", { name: "Delete template?" });
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByText(name)).toBeVisible();
    await page.getByRole("button", { name: `Delete ${name}` }).click();
    await sheet.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText(name)).toHaveCount(0);
    expect(dialogs).toEqual([]);
  } finally {
    await removeTemplateIfPresent(page, name);
  }
});

test("confirm runs once on double tap", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  const name = `Dbl plan ${stamp}`;
  try {
    await newTemplate(page, name);
    let deletes = 0;
    page.on("request", (r) => { if (r.method() === "DELETE" && r.url().includes("/plans")) deletes++; });
    await page.getByRole("button", { name: `Delete ${name}` }).click();
    const btn = page.getByRole("dialog", { name: "Delete template?" }).getByRole("button", { name: "Delete", exact: true });
    await btn.dblclick();
    await expect(page.getByText(name)).toHaveCount(0);
    expect(deletes).toBe(1);
  } finally {
    await removeTemplateIfPresent(page, name);
  }
});

test("deleting a plan day asks in a bottom sheet", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  const name = `Day plan ${stamp}`;
  try {
    await page.goto("/coach/plans");
    await page.getByLabel("Name").fill(name);
    await page.getByRole("button", { name: /Create/ }).click();
    await page.waitForURL("**/coach/plans/*"); // lands in the builder with the preset's days
    const dialogs = trackDialogs(page);
    const legs = page.getByRole("region", { name: "Legs" });
    await expect(legs).toBeVisible();
    await legs.getByRole("button", { name: "Delete day" }).click();
    const sheet = page.getByRole("dialog", { name: "Delete day?" });
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(legs).toBeVisible();
    await legs.getByRole("button", { name: "Delete day" }).click();
    await sheet.getByRole("button", { name: "Delete day" }).click();
    await expect(page.getByRole("region", { name: "Legs" })).toHaveCount(0);
    expect(dialogs).toEqual([]);
  } finally {
    await removeTemplateIfPresent(page, name);
  }
});

test("logging out with nothing pending shows no sheet", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  const dialogs = trackDialogs(page);
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("dialog", { name: "Account" }).getByRole("button", { name: "Log out" }).click();
  await page.waitForURL("**/login");
  expect(dialogs).toEqual([]);
});

test("the coach's phone tab bar holds five items and Invite lights Clients", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  await page.goto("/coach/invite");
  const tabBar = page.locator("nav[aria-label='Main']:visible");
  await expect(tabBar.getByRole("link")).toHaveCount(5);
  await expect(tabBar.getByRole("link", { name: "Invite" })).toHaveCount(0);
  await expect(tabBar.getByRole("link", { name: "Clients" })).toHaveAttribute("aria-current", "page");
});

test("the account sheet links a client to their profile", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  await expect(page.getByRole("banner").getByRole("button", { name: "Log out" })).toHaveCount(0);
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("dialog", { name: "Account" }).getByRole("link", { name: "Your profile" }).click();
  await page.waitForURL("**/profile");
  await expect(page.getByRole("dialog", { name: "Account" })).toHaveCount(0);
});

test("a failed day delete shows one toast and keeps the sheet open", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  const name = `Fail plan ${stamp}`;
  const route = "**/rest/v1/plan_days*";
  try {
    await page.goto("/coach/plans");
    await page.getByLabel("Name").fill(name);
    await page.getByRole("button", { name: /Create/ }).click();
    await page.waitForURL("**/coach/plans/*");
    await expect(page.getByRole("region", { name: "Legs" })).toBeVisible();
    await page.route(route, (r) => r.request().method() === "DELETE"
      ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "boom" }) })
      : r.fallback());
    await page.getByRole("region", { name: "Legs" }).getByRole("button", { name: "Delete day" }).click();
    const sheet = page.getByRole("dialog", { name: "Delete day?" });
    await sheet.getByRole("button", { name: "Delete day" }).click();
    await expect(toast(page, "boom")).toHaveCount(1);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(1);
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Delete day" })).toBeEnabled();
  } finally {
    await page.unroute(route);
    await removeTemplateIfPresent(page, name);
  }
});

// ---- Task 8: NumberFlow on progress tiles and unread counts ----
test("logging body weight rolls the 7-day average", async ({ browser }) => {
  const { api, userId: alexId } = await signedInApi("alex@demo.test");
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const { data: prev } = await api.from("body_weights").select("weight_kg").eq("client_id", alexId).eq("entry_date", today).maybeSingle();
  const page = await phone(browser, "alex@demo.test");
  try {
    await page.goto("/progress");
    const tile = page.locator("main").getByText("7-day average", { exact: true }).locator("xpath=..");
    await expect(tile.locator("number-flow-react")).toBeVisible();
    const before = await tileNumber(tile);
    await page.getByLabel(/Body weight in/).fill("95.3");
    await page.getByRole("button", { name: "Log", exact: true }).click();
    await expect.poll(() => tileNumber(tile)).not.toBe(before);
  } finally {
    if (prev) await api.from("body_weights").update({ weight_kg: prev.weight_kg }).eq("client_id", alexId).eq("entry_date", today);
    else await api.from("body_weights").delete().eq("client_id", alexId).eq("entry_date", today);
  }
});

// ---- Task 10: coach search palette ----
test("coach can find a client from the phone header", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  await page.goto("/coach");
  await page.getByRole("button", { name: "Search" }).click();
  const sheet = page.getByRole("dialog", { name: "Search" });
  await sheet.getByRole("combobox").fill("alex");
  await sheet.getByRole("option", { name: /Alex/ }).first().click();
  await page.waitForURL("**/coach/clients/22222222-2222-2222-2222-222222222222");
  await expect(sheet).toHaveCount(0);
});

test("Ctrl+K opens search on desktop", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill("coach@demo.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/coach");
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Search" })).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Search" }).getByRole("combobox")).toBeFocused();
  // A keyboard shortcut opens instantly: no enter animation, and Escape closes it.
  expect(await page.getByRole("dialog", { name: "Search" }).evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Search" })).toHaveCount(0);
});

test("clients never see coach search", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  await expect(page.getByRole("button", { name: "Search" })).toHaveCount(0);
});

// ---- Review fixes ----
test("reopening the meal sheet mid-close shows the newly picked meal", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  const a = `Reopen A ${stamp}`;
  const b = `Reopen B ${stamp}`;
  try {
    await addMeal(page, a);
    await addMeal(page, b);
    await page.getByRole("button", { name: `Edit ${a}` }).click();
    const edit = page.getByRole("dialog", { name: "Edit food" });
    await expect(edit.getByLabel("Food")).toHaveValue(a);
    // Close and reopen on another meal before the exit animation ends.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: `Edit ${b}` }).click();
    await expect(edit.getByLabel("Food")).toHaveValue(b);
  } finally {
    await page.keyboard.press("Escape");
    await removeMealIfPresent(page, a);
    await removeMealIfPresent(page, b);
  }
});

test("Create custom exercise in the picker starts from the typed search", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  const picker = await openPicker(page);
  await picker.getByLabel("Search exercises").fill("zercher squat");
  await picker.getByRole("button", { name: "Create custom exercise" }).click();
  const form = page.getByRole("dialog", { name: "Custom exercise" });
  await expect(form.getByLabel("Name")).toHaveValue("zercher squat");
});

test("the chat box grows with a long message", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  await page.goto("/chat");
  const box = page.getByLabel("Message");
  const oneLine = (await box.boundingBox())!.height;
  await box.fill(["line one", "line two", "line three"].join("\n"));
  await expect.poll(async () => (await box.boundingBox())!.height).toBeGreaterThan(oneLine + 20);
  await box.fill(Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n"));
  await expect.poll(async () => (await box.boundingBox())!.height).toBeLessThanOrEqual(128 + 1); // capped at max-h-32
  await box.fill("");
  await expect.poll(async () => (await box.boundingBox())!.height).toBe(oneLine);
});

test("a coach opening an invite can log out right there", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/coach/invite");
  let token: string | undefined;
  try {
    await page.getByRole("button", { name: /Create & copy link/ }).click();
    await expect(toast(page, "Invite link copied")).toBeVisible();
    token = (await page.evaluate(() => navigator.clipboard.readText())).split("/invite/")[1];
    await page.goto(`/invite/${token}`);
    await expect(page.getByText("You're signed in as a coach.")).toBeVisible();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByRole("link", { name: "Create client account" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/invite/${token}$`));
  } finally {
    if (token) {
      const { api } = await signedInApi("coach@demo.test");
      const { error } = await api.from("invitations").delete().eq("token", token);
      expect(error).toBeNull();
    }
  }
});
