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
// stamp and openFirstTemplate are used by later tasks in this plan
void stamp;
void openFirstTemplate;

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
