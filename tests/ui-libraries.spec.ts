import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
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

test("copying an invite link toasts", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/coach/invite");
  await page.getByRole("button", { name: /Create & copy link/ }).click();
  await expect(toast(page, "Invite link copied")).toBeVisible();
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
const food = (page: Page, name: string) => page.locator("main").getByText(name, { exact: true });
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
    await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
    await toast(page, "Client archived").getByRole("button", { name: "Undo" }).click();
    expect(dialogs).toEqual([]);
    await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
  } finally {
    // restore if the client was left archived
    await page.goto(url);
    const restore = page.getByRole("button", { name: "Restore" });
    await expect(page.getByRole("button", { name: /Archive|Restore/ }).first()).toBeVisible();
    if (await restore.count()) await restore.click();
    await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
  }
});

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
    await picker.getByLabel("Search exercises").fill("dumb incl");
    // [cmdk-list]: the filter selects' <option>s also have the option role.
    const options = picker.locator("[cmdk-list]").getByRole("option");
    await expect(options.first()).toContainText("Incline Dumbbell Press");
    await page.keyboard.press("Enter");
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
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL("**/login");
  expect(dialogs).toEqual([]);
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
  const env = Object.fromEntries(
    readFileSync(".env.local", "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  const api = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: auth } = await api.auth.signInWithPassword({ email: "alex@demo.test", password: PASSWORD });
  const alexId = auth.user!.id;
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
});

test("clients never see coach search", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  await expect(page.getByRole("button", { name: "Search" })).toHaveCount(0);
});
