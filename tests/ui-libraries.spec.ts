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
});

test("sheet traps focus and restores it on close", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  const picker = await openPicker(page);
  await expect(picker).toHaveAttribute("aria-modal", "true");
  for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
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
});
