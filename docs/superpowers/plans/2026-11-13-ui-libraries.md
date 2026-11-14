# UI Libraries (sonner, vaul, NumberFlow, cmdk) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the four newly installed libraries into Coachly so feedback, sheets, live numbers and search feel native on a phone first, and still work on a desktop.

**Architecture:** Three small shared building blocks come first: a global `<Toaster />` plus a `notify` wrapper, a vaul-based `Sheet` (with `ConfirmSheet` and a `useSheet` hook), and NumberFlow dropped into existing display components. Every call site then moves onto them. cmdk arrives last, inside the new `Sheet`, so search on a phone is a bottom drawer and not a desktop-style modal. No shadcn, and no rewrite of `globals.css`: styling uses the existing Tailwind tokens.

**Tech Stack:** Next 16.4.6 (App Router), React 19.3, Tailwind 4, Supabase, sonner 2.0.8, vaul 1.1.2, @number-flow/react 0.6.2, cmdk 1.1.1, Playwright for tests.

**Spec:** `docs/ui-library-audit.md`. Row numbers below (for example "audit #5") refer to its table.

## Global Constraints

- **Mobile first.** Design and test at 390×844 with `hasTouch: true` (the viewport `tests/acceptance.spec.ts` already uses for clients). Desktop is a check, not the target.
- **Touch targets.** Every new tappable element is at least 44px (`min-h-11` / `size-11`), matching the existing controls.
- **Safe areas.** Anything pinned to a screen edge pads with `env(safe-area-inset-*)`, as `AppShell` and the current sheets already do.
- **Toasts live at the top.** Use `position="top-center"` and `mobileOffset={{ top: "calc(env(safe-area-inset-top) + 8px)" }}`. Toasts must never cover the bottom nav (`AppShell.tsx:186`) or the rest timer (`session/[id]/page.tsx:403`).
- **Toast theme.** Use `theme="system"`, because the app themes itself with `prefers-color-scheme` and Sonner defaults to light.
- **Exactly one `<Toaster />`**, in `src/app/layout.tsx`. sonner, vaul and cmdk ship `'use client'`, so the server layout can import them directly (Next docs: `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`, "Third-party components").
- **Toasts are for events, not for state or validation.** Toast errors and one-off successes only. Never toast per set, per autosave, or for form validation. The offline banner, the "Workout saved" + PR card and chat retry stay inline (audit "Where NOT to use them").
- **Undo toasts** last `6000` ms and carry the action label `Undo`. Other toasts use Sonner's default duration.
- **Sheets.** Use vaul at every breakpoint: `Drawer.Handle` visible, `max-h-[92dvh]`, `repositionInputs` left on (the default), **no** `shouldScaleBackground`. A sheet opened from inside another sheet uses `Drawer.NestedRoot`.
- **No new dependencies.** Confirm dialogs use `ConfirmSheet` (vaul), not Radix AlertDialog. The desktop Radix Dialog variant, Tabs and ToggleGroup are out of scope (see "Deferred").
- **Copy that existing tests assert must not change.** Keep `Targets saved.` (with the period), the dialog names `Add food` / `Edit food`, `All changes saved` and `Workout saved` exactly as written.
- **No animation on the coach search palette open/close** (it's opened many times a day). Everything else relies on the reduced-motion rule already in `globals.css:113-120`.

## Review Focus

1. **Undo after navigating away.** If the user deletes a meal and then switches tab before tapping Undo, the restore must still work: the toast outlives the page because the Toaster sits in the root layout. → Task 3 test `undo restores a meal after changing day`.
2. **Undo while offline.** Meal delete and undo both go through `saveMealOp`, which queues offline, so undoing offline must restore the row locally and sync later. → Task 3 test `meal undo works offline`.
3. **Escape and back-swipe in nested sheets.** Escape (or a swipe on the top sheet) closes only the top sheet. Today, one Escape closes both the picker and the detail sheet. → Task 4 test `Escape closes only the top sheet`.
4. **The iOS keyboard over the meal form.** The `Food` input `autoFocus`es, and the submit button must stay reachable. vaul's `repositionInputs` handles it; the test checks the button is inside the viewport after focusing the last field. → Task 5 test `submit stays on screen with the keyboard field focused`.
5. **Double-tapping destructive confirms.** Tapping Confirm twice in a `ConfirmSheet` must run the action once. The button shows `loading` and is disabled while busy. → Task 6 test `confirm runs once on double tap`.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/components/AppToaster.tsx` | create | The configured `<Toaster />` (position, theme, offsets, token classNames). |
| `src/lib/notify.ts` | create | `notify.success / error / undo`, the only toast API call sites use. |
| `src/components/Sheet.tsx` | create | `Sheet`, `ConfirmSheet`, `useSheet`, built on vaul. Replaces `Sheet` in `ExerciseLibrary.tsx`. |
| `src/components/ExerciseCommand.tsx` | create | cmdk list for picking exercises (used by the plan builder picker). |
| `src/components/CoachSearch.tsx` | create | Coach search palette: a header/sidebar button plus ⌘K that opens a `Sheet` holding a cmdk list. |
| `tests/ui-libraries.spec.ts` | create | Playwright specs for this plan (mobile contexts, seeded demo accounts). |
| `src/app/layout.tsx` | modify | Mount `AppToaster`. |
| `src/components/ExerciseLibrary.tsx` | modify | Drop the local `Sheet`, use `Sheet`/`useSheet`, accept a `nested` prop. |
| `src/components/NutritionDay.tsx`, `TrainingCalendar.tsx`, `ProgressView.tsx`, `AppShell.tsx`, `ui.tsx` | modify | Move onto the shared pieces (per task). |
| `src/app/coach/plans/[id]/page.tsx`, `coach/plans/page.tsx`, `coach/invite/page.tsx`, `coach/clients/[id]/page.tsx`, `coach/page.tsx`, `(client)/profile/page.tsx`, `(client)/training/session/[id]/page.tsx` | modify | Move onto the shared pieces (per task). |

## How to run tests (every task)

Prerequisites: local Supabase running and seeded (`npx supabase start`, then `npx supabase db reset` for a clean slate), and `.env.local` filled in. Start the dev server with the `coachly-dev` launch config (port 3001).

- Types: `npx tsc --noEmit`. Expected: no output, exit 0.
- Lint: `npm run lint`. Expected: no errors.
- New specs: `BASE_URL=http://localhost:3001 npx playwright test tests/ui-libraries.spec.ts -g "<test name>"`. Expected: `1 passed`.
- Regression (final task, and any task touching `NutritionDay`, `TargetsForm` or the plan builder): `BASE_URL=http://localhost:3001 npm run test:acceptance`. Expected: all pass.

`tests/ui-libraries.spec.ts` starts with this shared setup (written in Task 1, reused by later tasks):

```ts
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
```

Seeded accounts: client `alex@demo.test`, coach `coach@demo.test`. Tests create their own uniquely named rows (using `stamp`) and clean up after themselves.

---

### Task 1: Toast foundation (audit #1, #7)

**Files:**
- Create: `src/components/AppToaster.tsx`, `src/lib/notify.ts`, `tests/ui-libraries.spec.ts`
- Modify: `src/app/layout.tsx:29-32`, `src/app/(client)/profile/page.tsx:35,70,133`, `src/app/coach/clients/[id]/page.tsx:295,313,328`

**Interfaces:**
- Produces: `export default function AppToaster(): JSX.Element`, and in `src/lib/notify.ts`:
  ```ts
  export const notify: {
    success(message: string, opts?: { description?: string }): void;
    error(message: string, opts?: { description?: string }): void;
    undo(message: string, onUndo: () => void | Promise<void>): void; // duration 6000, action label "Undo"
  };
  ```

- [ ] **Step 1: Write the failing tests** in `tests/ui-libraries.spec.ts` (with the shared setup above).

```ts
test("profile save shows a toast that survives the redirect", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  await page.goto("/profile");
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.waitForURL("**/progress");
  const t = toast(page, "Profile updated");
  await expect(t).toBeVisible();
  const box = (await t.boundingBox())!;
  expect(box.y).toBeLessThan(200);                    // top of screen, clear of the bottom nav
});

test("coach target save toasts and keeps the acceptance copy", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  await page.goto("/coach/clients/22222222-2222-2222-2222-222222222222?tab=nutrition");
  await page.getByRole("button", { name: "Save targets" }).click();
  await expect(toast(page, "Targets saved.")).toBeVisible();
});
```

- [ ] **Step 2: Run** `-g "toast"`. Expected: both FAIL (no `[data-sonner-toast]`).
- [ ] **Step 3: Implement `AppToaster`.** Render sonner's `<Toaster>` with the position, offset and theme values from Global Constraints. Style it through `toastOptions.classNames`, using `!`-prefixed token utilities: `toast` gets `!rounded-2xl !border-line !bg-surface !text-ink !shadow-card`, `actionButton` gets `!bg-brand !text-brand-fg !rounded-lg !min-h-9 !px-3 !font-semibold`. Mount it once in `layout.tsx`, after `{children}`.
- [ ] **Step 4: Implement `notify`** in `src/lib/notify.ts` as thin calls to `toast.success` / `toast.error` / `toast(message, { duration: 6000, action: { label: "Undo", onClick: onUndo } })`.
- [ ] **Step 5: Use it.**
  - Profile: call `notify.success("Profile updated")` before `router.push`, and delete the `saved` state and `disabled={saved}`.
  - TargetsForm: on success call `notify.success("Targets saved.")` and drop the `ok: true` branch of `msg`. Validation and errors stay inline.
- [ ] **Step 6: Run** `-g "toast"`, plus `tsc` and lint. Expected: PASS.
- [ ] **Step 7: Commit:** `git add src/components/AppToaster.tsx src/lib/notify.ts src/app/layout.tsx "src/app/(client)/profile/page.tsx" "src/app/coach/clients/[id]/page.tsx" tests/ui-libraries.spec.ts && git commit -m "feat: global toaster and notify helper"`

### Task 2: Replace alert() and off-screen errors with toasts (audit #2, #8, #9 duplicate, #10, #11, #21)

**Files:**
- Modify: `src/components/NutritionDay.tsx:46`, `src/app/coach/plans/page.tsx:52-61`, `src/app/coach/invite/page.tsx:59-72`, `src/app/coach/clients/[id]/page.tsx:48,365`, `src/app/coach/plans/[id]/page.tsx:16,30-38,92`, `src/app/(client)/training/session/[id]/page.tsx:158-190,240`, `src/components/AppShell.tsx:90`

**Interfaces:**
- Consumes: `notify` (Task 1).

- [ ] **Step 1: Write the failing tests.**

```ts
test("copying an invite link toasts", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/coach/invite");
  await page.getByRole("button", { name: /Create invite/i }).click();
  await page.getByRole("button", { name: "Copy" }).first().click();
  await expect(toast(page, "Invite link copied")).toBeVisible();
});

test("a failed plan autosave toasts instead of an off-screen box", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  await page.goto("/coach/plans");
  await openFirstTemplate(page);
  await page.route("**/rest/v1/plan_days**", (r) => r.fulfill({ status: 500, body: '{"message":"boom"}' }));
  await page.getByRole("button", { name: "Add workout day" }).click();
  await expect(toast(page, /boom|Something went wrong/)).toBeVisible();
});
```

- [ ] **Step 2: Run** `-g "invite link|autosave"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Swap every `alert(x)` for `notify.error(x)` (6 sites).
  - Invite `copy()`: on success, keep the button's "Copied" state and add `notify.success("Invite link copied")`. On clipboard failure, replace `prompt()` with `notify.error("Couldn't copy. Long-press to copy:", { description: link(token) })`.
  - Plans `duplicate()`: `notify.success("Template duplicated")`.
  - Plan builder `write()`: call `notify.error(errMsg(...))` instead of `setSaveError`. Keep `setSaveError` only for the inline "Plan name can't be empty." validation at `:71`, and keep the `role="status"` "All changes saved" text.
  - Session page `ExerciseCard` add/remove set and notes errors: `notify.error`, deleting the `error` state and the `:240` paragraph. **Leave `SetRow` errors inline.**
  - AppShell `sync()`: when `after < before`, call `notify.success(\`${before - after} offline change(s) synced\`)`.
- [ ] **Step 4: Run** the two tests, `tsc`, lint and `npm run test:acceptance`. Expected: PASS (acceptance test 4 still sees "All changes saved").
- [ ] **Step 5: Commit:** `git commit -am "feat: toast errors and confirmations instead of alert()"`

### Task 3: Undo instead of confirm for reversible deletes (audit #3, #4, #9 archive)

**Files:**
- Modify: `src/components/NutritionDay.tsx:43-48`, `src/app/coach/clients/[id]/page.tsx:43-50,362-367`, `src/app/coach/plans/[id]/page.tsx:225`

**Interfaces:**
- Consumes: `notify.undo(message, onUndo)` (Task 1); `saveMealOp(supabase, op)` from `src/lib/pendingMeals.ts`.

- [ ] **Step 1: Write the failing tests.**

```ts
async function addMeal(page: Page, name: string) {
  await page.goto("/nutrition");
  await page.locator("section", { hasText: "Snack" }).getByRole("button", { name: "Add food" }).click();
  const d = page.getByRole("dialog", { name: "Add food" });
  await d.getByLabel("Food").fill(name);
  await d.getByLabel("Serving size").fill("1");
  await d.getByLabel("Calories (kcal)").fill("100");
  await d.getByRole("button", { name: "Add food" }).click();
  await expect(page.getByText(name)).toBeVisible();
}

test("meal delete has no confirm and can be undone", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  const name = `Undo apple ${stamp}`;
  await addMeal(page, name);
  page.on("dialog", () => { throw new Error("native confirm shown"); });
  await page.getByRole("button", { name: `Delete ${name}` }).click();
  await expect(page.getByText(name)).toHaveCount(0);
  await toast(page, `Deleted "${name}"`).getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(name)).toBeVisible();
  await page.reload();
  await expect(page.getByText(name)).toBeVisible();     // restored on the server, not just locally
  await page.getByRole("button", { name: `Delete ${name}` }).click();   // cleanup
});

test("undo restores a meal after changing day", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  const name = `Nav apple ${stamp}`;
  await addMeal(page, name);
  await page.getByRole("button", { name: `Delete ${name}` }).click();
  await page.getByRole("button", { name: "Previous day" }).click();
  await toast(page, name).getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page.getByText(name)).toBeVisible();
  await page.getByRole("button", { name: `Delete ${name}` }).click();
});

test("meal undo works offline", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  const name = `Offline undo ${stamp}`;
  await addMeal(page, name);
  await page.context().setOffline(true);
  await page.getByRole("button", { name: `Delete ${name}` }).click();
  await toast(page, name).getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(name)).toBeVisible();
  await page.context().setOffline(false);
  await page.reload();
  await expect(page.getByText(name)).toBeVisible();
  await page.getByRole("button", { name: `Delete ${name}` }).click();
});

test("removing a plan exercise can be undone", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  await page.goto("/coach/plans");
  await openFirstTemplate(page);
  const row = page.getByRole("button", { name: "Remove exercise" }).first();
  const label = await row.locator("xpath=ancestor::li[1]//p").first().innerText();
  await row.click();
  await toast(page, "Exercise removed").getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(label.split("\n")[0]).first()).toBeVisible();
});
```

- [ ] **Step 2: Run** `-g "undo|Undo|undone"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Meal** `remove(m)`: drop `confirm`, run `saveMealOp(..., { op: "delete", ... })`, reload silently, then `notify.undo(\`Deleted "${m.food_name}"\`, ...)`. The undo handler upserts a `MealRow` built from `m` (same `id`, `client_id`, `entry_date`, `meal`, `food_name`, `serving`, macros) and dispatches `window.dispatchEvent(new Event("coachly:synced"))` so whichever `NutritionDay` is mounted reloads.
  - **Note** `remove(id)`: delete, then `notify.undo("Note deleted", ...)`. The undo handler re-inserts `{ id: n.id, coach_id, client_id, body: n.body, created_at: n.created_at }` so it reappears in the same place. Change the signature to `remove(n: Note)`.
  - **Plan exercise** remove: `write(delete)`, then `notify.undo("Exercise removed", ...)`. The undo handler re-inserts every `PlanExercise` column except `exercises` (same `id` and `position`).
  - **Archive** `setStatus("archived")`: drop `confirm` and `notify.undo("Client archived", () => setStatus("active"))`.
- [ ] **Step 4: Run** the four tests, `tsc`, lint and `npm run test:acceptance`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: undo toasts for reversible deletes"`

### Task 4: Shared vaul `Sheet` with nested support (audit #5)

**Files:**
- Create: `src/components/Sheet.tsx`
- Modify: `src/components/ExerciseLibrary.tsx:355-376` (delete the local `Sheet`), `:382-419` (`ExerciseBrowser`); `src/app/coach/plans/[id]/page.tsx:8,118-137,249-257`; `src/components/TrainingCalendar.tsx:55,121,149-175,210,234`

**Interfaces:**
- Produces:
  ```ts
  export function Sheet(props: {
    open: boolean; onOpenChange: (open: boolean) => void; title: string;
    onBack?: () => void; footer?: ReactNode; nested?: boolean; onClosed?: () => void; children: ReactNode;
  }): JSX.Element;
  // keeps `item` rendered through the exit animation; clears it in onClosed
  export function useSheet<T>(): { item: T | null; open: boolean; show(item: T): void; close(): void;
    bind: { open: boolean; onOpenChange(o: boolean): void; onClosed(): void } };
  ```
- `ExerciseBrowser` gains `nested?: boolean`, which it passes to its inner sheets.

- [ ] **Step 1: Write the failing tests.**

```ts
async function openPicker(page: Page) {
  await openFirstTemplate(page);
  await page.getByRole("button", { name: "Add exercise" }).first().click();
  return page.getByRole("dialog", { name: "Exercise library" });
}

test("Escape closes only the top sheet", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  const picker = await openPicker(page);
  await picker.getByRole("button", { name: /^About / }).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(1);
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
```

- [ ] **Step 2: Run** `-g "sheet|Escape"`. Expected: FAIL (no `aria-modal`; Escape leaves 0 dialogs).
- [ ] **Step 3: Implement `Sheet`** in `src/components/Sheet.tsx`. `nested ? Drawer.NestedRoot : Drawer.Root`, controlled by `open`/`onOpenChange`, with `onAnimationEnd={(o) => !o && onClosed?.()}`. Inside sits `Drawer.Portal`, then `Drawer.Overlay` (`fixed inset-0 z-50 bg-slate-950/50`), then `Drawer.Content` (`fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-3xl border border-line bg-surface`, `paddingBottom: env(safe-area-inset-bottom)`), which holds:
  - `Drawer.Handle` (`mt-2 mb-1 bg-line`);
  - the existing header row (Back / `Drawer.Title` / a 44px close button);
  - a scroll body `min-h-0 flex-1 overflow-y-auto`;
  - the optional footer.
  Implement `useSheet<T>()`: state `{ item, open }`; `show` sets both; `close` sets `open:false`; `bind.onClosed` clears `item`.
- [ ] **Step 4: Migrate the call sites** to `useSheet` + `<Sheet {...s.bind} title=…>{s.item && …}</Sheet>`:
  - `ExerciseBrowser` detail (keep its `history` back-stack) and create sheets, each passing `nested={nested}`;
  - `ExercisePicker` (outer, not nested), which passes `nested` into `ExerciseBrowser`;
  - `DaySheet` in both `TrainingCalendar` and `WeekGlance`.
  Remove the old `Sheet` export from `ExerciseLibrary.tsx` and the `window` keydown listeners.
- [ ] **Step 5: Run** the three tests, `tsc`, lint and `npm run test:acceptance`. Expected: PASS.
- [ ] **Step 6: Commit:** `git commit -am "feat: vaul-based Sheet with nested drawers"` (after `git add src/components/Sheet.tsx`)

### Task 5: Meal form on the shared Sheet (audit #6)

**Files:**
- Modify: `src/components/NutritionDay.tsx:16,139-150,154-254`

**Interfaces:**
- Consumes: `Sheet`, `useSheet` (Task 4).
- `MealForm` becomes body-only: `MealForm({ clientId, initial, onSaved }): JSX.Element` renders the `<form>` without an overlay. `NutritionDay` wraps it in `<Sheet title={initial.id ? "Edit food" : "Add food"}>`.

- [ ] **Step 1: Write the failing test.**

```ts
test("submit stays on screen with the keyboard field focused", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  await page.goto("/nutrition");
  await page.locator("section", { hasText: "Snack" }).getByRole("button", { name: "Add food" }).click();
  const d = page.getByRole("dialog", { name: "Add food" });
  await expect(d.locator("[data-vaul-handle]")).toBeVisible();
  await expect(d.getByLabel("Food")).toBeFocused();
  await d.getByLabel("Fat g").focus();
  await expect(d.getByRole("button", { name: "Add food" })).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(d).toHaveCount(0);
});
```

- [ ] **Step 2: Run** `-g "submit stays"`. Expected: FAIL (no handle).
- [ ] **Step 3: Implement.** `editing` becomes `useSheet<Partial<Meal>>()`. Strip the overlay `div`, `role="dialog"`, the close button and the Escape effect from `MealForm`. Its submit button becomes the `Sheet` `footer` so it is pinned above the keyboard: give the `<form>` an `id="meal-form"` and the footer button `form="meal-form"`. `onSaved` calls `close()` and then reloads silently.
- [ ] **Step 4: Run** the test and `npm run test:acceptance` (tests 5 and 8 drive this dialog). Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: meal form uses shared drawer"`

### Task 6: ConfirmSheet for irreversible actions (audit "Radix/Base UI" table, done mobile-first)

**Files:**
- Modify: `src/components/Sheet.tsx` (add `ConfirmSheet`), `src/components/AppShell.tsx:108-119`, `src/app/coach/plans/page.tsx:58-62`, `src/app/coach/plans/[id]/page.tsx:169`, `src/app/coach/invite/page.tsx:69-73`

**Interfaces:**
- Produces:
  ```ts
  export function ConfirmSheet(props: {
    open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string;
    confirmLabel: string; tone?: "danger" | "primary"; onConfirm: () => Promise<void> | void;
  }): JSX.Element;
  ```
  Built on `Sheet`. It renders `title`, `description`, and two full-width `size="lg"` buttons stacked for thumbs: confirm (`variant="danger"` when `tone="danger"`, `loading` while `onConfirm` is pending, which also blocks a second tap) and `Cancel` (`variant="secondary"`). It closes after `onConfirm` resolves.

- [ ] **Step 1: Write the failing tests.**

```ts
async function newTemplate(page: Page, name: string) {
  await page.goto("/coach/plans");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: /Create/ }).click();
  await page.goto("/coach/plans");
}

test("deleting a template asks in a bottom sheet, not a native confirm", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  const name = `Tmp plan ${stamp}`;
  await newTemplate(page, name);
  page.on("dialog", () => { throw new Error("native confirm shown"); });
  await page.getByRole("button", { name: `Delete ${name}` }).click();
  const sheet = page.getByRole("dialog", { name: "Delete template?" });
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText(name)).toBeVisible();
  await page.getByRole("button", { name: `Delete ${name}` }).click();
  await sheet.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(name)).toHaveCount(0);
});

test("confirm runs once on double tap", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  const name = `Dbl plan ${stamp}`;
  await newTemplate(page, name);
  let deletes = 0;
  page.on("request", (r) => r.method() === "DELETE" && r.url().includes("/plans") && deletes++);
  await page.getByRole("button", { name: `Delete ${name}` }).click();
  const btn = page.getByRole("dialog", { name: "Delete template?" }).getByRole("button", { name: "Delete" });
  await btn.dblclick();
  await expect(page.getByText(name)).toHaveCount(0);
  expect(deletes).toBe(1);
});
```

(Step 3 adds `aria-label={`Delete ${r.name}`}` to the template list's Delete button at `coach/plans/page.tsx:105`. Today it is labelled only "Delete".)

- [ ] **Step 2: Run** `-g "bottom sheet|double tap"`. Expected: FAIL.
- [ ] **Step 3: Implement `ConfirmSheet`** and replace the 4 `confirm()` calls, keeping their current wording as the `description`:

| Site | `title` | `confirmLabel` |
|---|---|---|
| `AppShell.signOut` (only when unsynced changes remain) | `Log out and discard changes?` | `Log out` |
| Plans `remove` | `Delete template?` | `Delete` |
| Plan builder delete day | `Delete day?` | `Delete day` |
| Invite `revoke` | `Revoke invite?` | `Revoke` |

  Each site holds `useState` for the pending target and renders one `ConfirmSheet`.
- [ ] **Step 4: Run** the tests, `tsc` and lint. Expected: PASS. Then grep: `grep -rn "confirm(\|alert(\|prompt(" src`. Expected: no matches.
- [ ] **Step 5: Commit:** `git commit -am "feat: ConfirmSheet replaces native confirm"`

### Task 7: NumberFlow on nutrition meters and the workout counter (audit #12, #13)

**Files:**
- Modify: `src/components/ui.tsx:174`, `src/components/NutritionDay.tsx:99`, `src/app/(client)/training/session/[id]/page.tsx:88,94-96`

**Interfaces:**
- NumberFlow renders `role="img"` with `aria-label` set to the formatted value. Tests locate it that way.

- [ ] **Step 1: Write the failing tests.**

```ts
test("calorie meter number animates to the new total", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  await page.goto("/nutrition");
  const meter = page.getByRole("progressbar", { name: "Calories" }).locator("xpath=..");
  const before = Number(await meter.getByRole("img").getAttribute("aria-label"));
  const name = `Flow pear ${stamp}`;
  await addMeal(page, name);                           // +100 kcal (helper from Task 3)
  await expect(meter.getByRole("img", { name: String(before + 100) })).toBeVisible();
  await page.getByRole("button", { name: `Delete ${name}` }).click();
});

test("set counter and progress bar update on check", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  await page.goto("/training");
  await page.locator('a[href^="/training/session/"]').first().click();
  const counter = page.locator("h1 + p").getByRole("img").first();
  const before = Number(await counter.getAttribute("aria-label"));
  const check = page.getByRole("button", { name: /^Complete set/ }).first();
  await page.getByLabel(/reps$/).first().fill("8");
  await check.click();
  await expect(page.locator("h1 + p").getByRole("img", { name: String(before + 1) })).toBeVisible();
  await page.getByRole("button", { name: /^Mark set .* not done/ }).first().click();   // cleanup
});
```

- [ ] **Step 2: Run** `-g "meter|counter"`. Expected: FAIL (no `img`).
- [ ] **Step 3: Implement.**
  - `Meter`: `<NumberFlow value={Math.round(value)} />` inside the existing value span.
  - Meal header: `<NumberFlow value={Math.round(t.calories)} suffix=" kcal" />`.
  - Session header: `<NumberFlow value={doneSets} />/{allSets.length} sets`.
  - Progress bar `:95`: replace `transition-all` + `width` with `origin-left transition-transform duration-300 ease-out` + `transform: scaleX(ratio)` on a `w-full` child.
- [ ] **Step 4: Run** the tests, `tsc` and lint. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: animated nutrition and set counters"`

### Task 8: NumberFlow on body-weight tiles and live unread counts (audit #14, #19)

**Files:**
- Modify: `src/components/ProgressView.tsx:72-92,389-390` (and other `Tile` callers in `MonthCompare`/`Consistency`), `src/app/coach/page.tsx:147-151`, `src/components/AppShell.tsx:220-225`

**Interfaces:**
- `Tile` changes to `Tile({ label, value, format, suffix, sub, delta }: { label: string; value: number | null; format?: Intl.NumberFormatOptions; suffix?: string; sub?: string; delta?: … })`. `null` renders `—`. Callers that passed formatted strings pass the number plus `format`/`suffix` instead. A signed trend uses `format={{ maximumFractionDigits: 1, signDisplay: "exceptZero" }}`.

- [ ] **Step 1: Write the failing test.**

```ts
test("logging body weight rolls the 7-day average", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  await page.goto("/progress");
  await page.getByLabel(/Body weight in/).fill("81.3");
  await page.getByRole("button", { name: "Log" }).click();
  const tile = page.getByText("7-day average").locator("xpath=..");
  await expect(tile.getByRole("img")).toHaveAttribute("aria-label", /\d+(\.\d)?/);
});
```

- [ ] **Step 2: Run** `-g "body weight"`. Expected: FAIL.
- [ ] **Step 3: Implement** the `Tile` signature above with `<NumberFlow value={value} format={format} suffix={suffix} />`, and update every `Tile` caller. `StatCard` and `UnreadDot` render `<NumberFlow value={…} />`. Keep `UnreadDot`'s `99+` cap as the plain text `99+` above 99.
- [ ] **Step 4: Run** the test, `tsc`, lint, and the acceptance test 6 (chat unread): `-g "chat"`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: animated progress tiles and unread counts"`

### Task 9: cmdk exercise picker in the plan builder (audit #16)

**Files:**
- Create: `src/components/ExerciseCommand.tsx`
- Modify: `src/components/ExerciseLibrary.tsx:382-420` (`ExerciseBrowser` uses `ExerciseCommand` when `onPick` is set), `:50-73` (`FilterBar` gains a `hideSearch` prop)

**Interfaces:**
- Produces: `export function ExerciseCommand({ exercises, onPick, onInfo }: { exercises: Exercise[]; onPick(e: Exercise): void; onInfo(e: Exercise): void }): JSX.Element`.
- Builds a `Command` (inline, `loop`) with `Command.Input` (placeholder `Search exercises`, `aria-label="Search exercises"`, `min-h-12`), `Command.List` and `Command.Empty` ("No exercises match"). It groups items by `e.movements?.name ?? "Other"` with `Command.Group heading`. Each `Command.Item` has `value={e.id}`, `keywords={[e.name, e.movements?.name, e.equipment, ...e.primary_muscles.map(muscleLabel)].filter(Boolean)}` and `onSelect={() => onPick(e)}`, and sits in a `min-h-14` row that reuses `ExerciseThumb`. Selected style: `data-[selected=true]:bg-surface-2`. The info button is outside the item, stops propagation and calls `onInfo`.
- `ExerciseBrowser` (with `onPick`) pre-filters by the muscle/equipment/pattern selects (`matches(e, { ...f, q: "" })`) and passes the result to `ExerciseCommand`. The reference library (no `onPick`) keeps today's list.

- [ ] **Step 1: Write the failing test.**

```ts
test("picker fuzzy-matches and adds with the keyboard", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  const picker = await openPicker(page);              // helper from Task 4
  await picker.getByLabel("Search exercises").fill("dumb incl");
  await expect(picker.getByRole("option").first()).toContainText("Incline Dumbbell Press");
  await page.keyboard.press("Enter");
  await expect(picker).toHaveCount(0);
  await expect(page.getByText("Incline Dumbbell Press").last()).toBeVisible();
  // cleanup: remove it again
  await page.getByRole("button", { name: "Remove exercise" }).last().click();
});
```

- [ ] **Step 2: Run** `-g "fuzzy"`. Expected: FAIL (substring search finds nothing for "dumb incl").
- [ ] **Step 3: Implement** `ExerciseCommand` and wire it in as described in Interfaces. Use cmdk's built-in filter; don't set `shouldFilter={false}`.
- [ ] **Step 4: Run** the test, `tsc`, lint and `npm run test:acceptance` (test 2 builds a split). Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "feat: cmdk exercise picker"` (after `git add src/components/ExerciseCommand.tsx`)

### Task 10: Coach search, phone first (audit #17)

**Files:**
- Create: `src/components/CoachSearch.tsx`
- Modify: `src/components/AppShell.tsx` (a coach-only search button in the mobile header next to Log out, and above the nav in the desktop sidebar)

**Interfaces:**
- Consumes: `Sheet` (Task 4), `useLibrary()` from `ExerciseLibrary.tsx`.
- Produces: `export default function CoachSearch({ coachId }: { coachId: string }): JSX.Element`. It renders the trigger button (`aria-label="Search"`, 44px, `Search` icon, plus a `⌘K` hint at `md:` only) and a `Sheet` titled `Search` containing a `Command`. A global keydown `(e.metaKey || e.ctrlKey) && e.key === "k"` toggles it.
- Groups and destinations:
  - **Clients**: from `coach_clients` joined to `profiles(full_name)`. Item → `/coach/clients/{id}`, with a secondary "Message" item → `/coach/messages?client={id}`.
  - **Plans**: templates (`plans` where `client_id is null`) → `/coach/plans/{id}`.
  - **Exercises**: → `/coach/library` (opened with that exercise in the URL is out of scope).
  - **Go to**: the 6 `coachNav` items.
  - **Actions**: "Invite client" → `/coach/invite`, "New plan" → `/coach/plans`.
  Data loads lazily on first open. Selecting an item calls `router.push` and closes the sheet.
- Add no animation of your own: the vaul drawer's slide is the only motion.

- [ ] **Step 1: Write the failing tests.**

```ts
test("coach can find a client from the phone header", async ({ browser }) => {
  const page = await phone(browser, "coach@demo.test");
  await page.goto("/coach");
  await page.getByRole("button", { name: "Search" }).click();
  const sheet = page.getByRole("dialog", { name: "Search" });
  await sheet.getByRole("combobox").fill("alex");
  await sheet.getByRole("option", { name: /Alex/ }).first().click();
  await page.waitForURL("**/coach/clients/22222222-2222-2222-2222-222222222222");
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
  await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();
});

test("clients never see coach search", async ({ browser }) => {
  const page = await phone(browser, "alex@demo.test");
  await expect(page.getByRole("button", { name: "Search" })).toHaveCount(0);
});
```

- [ ] **Step 2: Run** `-g "search"`. Expected: FAIL.
- [ ] **Step 3: Implement `CoachSearch`** per Interfaces, and render it in `AppShell` only when `profile.role === "coach"`.
- [ ] **Step 4: Run** the three tests, `tsc`, lint and the full regression: `npx playwright test` (both spec files). Expected: all pass.
- [ ] **Step 5: Commit:** `git commit -am "feat: coach search palette"` (after `git add src/components/CoachSearch.tsx`)

---

## Deferred (not in this plan)

- **Desktop Radix Dialog variant of `Sheet`** (audit #15). It needs `@radix-ui/react-dialog` as a direct dependency. Phones are the target, and a centred bottom drawer works on desktop.
- **Rest-timer NumberFlow** (audit #18) and **calendar stat NumberFlow** (audit #20): optional polish.
- **Radix/Base UI Tabs and ToggleGroup** for keyboard-correct tabs and kg/lb toggles (audit Radix table). A separate a11y task.

## Suggested order and dependencies

Tasks 1 → 2 → 3 depend on `notify`. Tasks 4 → 5 → 6 depend on `Sheet`. Task 9 needs Task 4, and Task 10 needs Tasks 4 and 9's patterns. Tasks 7 and 8 stand alone and can run any time after Task 1. To ship value early on phones: **1, 2, 3, 4, 5, 7, 6, 8, 9, 10.**
