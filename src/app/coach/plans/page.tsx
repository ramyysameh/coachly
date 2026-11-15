"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, ClipboardList, Copy, Plus, Salad, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import type { NutritionPlanMeal } from "@/lib/data";
import { useProfile } from "@/components/AppShell";
import { Button, Card, Empty, ErrorBox, Field, Input, PageHeader, Select, Spinner, Tabs } from "@/components/ui";
import { errMsg, WEEKDAYS } from "@/lib/utils";
import { notify } from "@/lib/notify";
import { ConfirmSheet, useSheet } from "@/components/Sheet";

type Tab = "training" | "nutrition";

function PlansInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab: Tab = params.get("tab") === "nutrition" ? "nutrition" : "training";

  return (
    <div className="space-y-5">
      <PageHeader title="Plan templates" subtitle="Reusable training splits and meal plans. Assign them to clients from the client's profile." />
      <Tabs
        value={tab}
        onChange={(t) => router.replace(t === "training" ? pathname : `${pathname}?tab=${t}`, { scroll: false })}
        options={[
          { value: "training", label: "Training" },
          { value: "nutrition", label: "Nutrition" },
        ]}
      />
      {tab === "training" ? <TrainingTemplates /> : <NutritionTemplates />}
    </div>
  );
}

export default function PlansPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <PlansInner />
    </Suspense>
  );
}

// ───────────────────────── Training ─────────────────────────

type Row = { id: string; name: string; description: string | null; plan_days: { name: string; weekdays: number[]; plan_exercises: { id: string }[] }[] };

const PRESETS: Record<string, { name: string; days: { name: string; weekdays: number[] }[] }> = {
  blank: { name: "", days: [] },
  ppl: { name: "Push / Pull / Legs", days: [{ name: "Push", weekdays: [1, 4] }, { name: "Pull", weekdays: [2, 5] }, { name: "Legs", weekdays: [3, 6] }] },
  ul: { name: "Upper / Lower", days: [{ name: "Upper", weekdays: [1, 4] }, { name: "Lower", weekdays: [2, 5] }] },
  fb: { name: "Full Body 3x", days: [{ name: "Full Body A", weekdays: [1, 5] }, { name: "Full Body B", weekdays: [3] }] },
};

function TrainingTemplates() {
  const supabase = createClient();
  const router = useRouter();
  const { profile } = useProfile();
  const [name, setName] = useState("");
  const [preset, setPreset] = useState("ppl");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const removing = useSheet<Row>();

  const { data, loading, error: loadError, reload } = useAsync(
    async () => must(await supabase.from("plans").select("id, name, description, plan_days(name, weekdays, position, plan_exercises(id))").eq("coach_id", profile.id).is("client_id", null).order("created_at", { ascending: false })) as Row[],
    [profile.id],
  );

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const p = PRESETS[preset];
    const planName = name.trim() || p.name;
    if (!planName) return setError("Give the plan a name.");
    setCreating(true);
    setError(null);
    const { data: plan, error } = await supabase.from("plans").insert({ coach_id: profile.id, name: planName }).select("id").single();
    if (!error && p.days.length) {
      const res = await supabase.from("plan_days").insert(p.days.map((d, i) => ({ plan_id: plan.id, position: i, name: d.name, weekdays: d.weekdays })));
      if (res.error) setError(errMsg(res.error));
    }
    setCreating(false);
    if (error) return setError(errMsg(error));
    router.push(`/coach/plans/${plan.id}`);
  }

  async function duplicate(r: Row) {
    const { data: id, error } = await supabase.rpc("copy_plan", { p_source: r.id, p_name: `${r.name} (copy)` });
    if (error) return notify.error(errMsg(error));
    notify.success("Template duplicated");
    router.push(`/coach/plans/${id}`);
  }

  async function remove(r: Row) {
    const { error } = await supabase.from("plans").delete().eq("id", r.id);
    if (error) throw error;
    reload({ silent: true });
  }

  return (
    <div className="space-y-5">
      <Card>
        <form onSubmit={create} className="space-y-3" noValidate>
          <h2 className="font-semibold">New training template</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start from">
              <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
                <option value="ppl">Push / Pull / Legs</option>
                <option value="ul">Upper / Lower</option>
                <option value="fb">Full Body 3x</option>
                <option value="blank">Blank</option>
              </Select>
            </Field>
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={PRESETS[preset].name || "e.g. Strength block"} /></Field>
          </div>
          {error && <ErrorBox message={error} />}
          <Button type="submit" loading={creating}><Plus className="size-4" /> Create template</Button>
        </form>
      </Card>

      {loading ? <Spinner /> : loadError ? <ErrorBox message={loadError} onRetry={reload} /> : data!.length === 0 ? (
        <Empty icon={<ClipboardList className="size-8" />} title="No training templates yet">Create your first split above.</Empty>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {data!.map((r) => (
            <li key={r.id} className="flex flex-col rounded-2xl border border-line bg-surface">
              <Link href={`/coach/plans/${r.id}`} className="flex flex-1 items-start gap-2 p-4 hover:bg-surface-2/60">
                <div className="flex-1">
                  <p className="font-semibold">{r.name}</p>
                  <p className="mt-1 text-sm text-muted">
                    {r.plan_days.length} days · {r.plan_days.reduce((n, d) => n + d.plan_exercises.length, 0)} exercises
                  </p>
                  <p className="mt-1 text-xs text-muted">{r.plan_days.map((d) => `${d.name} (${d.weekdays.map((w) => WEEKDAYS[w - 1]).join("/") || "-"})`).join(" · ")}</p>
                </div>
                <ChevronRight className="size-5 text-muted" />
              </Link>
              <div className="flex gap-1 border-t border-line p-2">
                <Button size="sm" variant="ghost" onClick={() => duplicate(r)}><Copy className="size-4" /> Duplicate</Button>
                <Button size="sm" variant="ghost" className="ml-auto text-danger" aria-label={`Delete ${r.name}`} onClick={() => removing.show(r)}><Trash2 className="size-4" /> Delete</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmSheet
        {...removing.bind}
        title="Delete template?"
        description={removing.item ? `Delete template "${removing.item.name}"? Plans already assigned to clients are not affected.` : undefined}
        confirmLabel="Delete"
        onConfirm={() => remove(removing.item!)}
      />
    </div>
  );
}

// ───────────────────────── Nutrition ─────────────────────────

type NRow = { id: string; name: string; calories: number; protein_g: number; carbs_g: number; fat_g: number; nutrition_plan_meals: { id: string }[] };
type MealSeed = Pick<NutritionPlanMeal, "meal" | "name" | "details">;
type Macros = { calories: number; protein_g: number; carbs_g: number; fat_g: number };

/** Share of the day's calories and macros each starter meal gets. */
const MEAL_SPLIT: Record<NutritionPlanMeal["meal"], number> = { breakfast: 0.22, lunch: 0.3, dinner: 0.33, snack: 0.15 };
const STARTER_MEALS: MealSeed[] = [
  { meal: "breakfast", name: "Greek yogurt, oats & berries", details: null },
  { meal: "lunch", name: "Chicken, rice & vegetables", details: null },
  { meal: "dinner", name: "Salmon, potatoes & salad", details: null },
  { meal: "snack", name: "Protein shake & fruit", details: null },
];

const N_PRESETS: Record<string, { name: string; macros: Macros; meals: MealSeed[] }> = {
  cut: { name: "Fat loss · 2000 kcal", macros: { calories: 2000, protein_g: 180, carbs_g: 170, fat_g: 65 }, meals: STARTER_MEALS },
  maintain: { name: "Maintenance · 2500 kcal", macros: { calories: 2500, protein_g: 170, carbs_g: 280, fat_g: 80 }, meals: STARTER_MEALS },
  bulk: { name: "Lean bulk · 3000 kcal", macros: { calories: 3000, protein_g: 190, carbs_g: 370, fat_g: 90 }, meals: STARTER_MEALS },
  blank: { name: "", macros: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }, meals: [] },
};

function NutritionTemplates() {
  const supabase = createClient();
  const router = useRouter();
  const { profile } = useProfile();
  const [name, setName] = useState("");
  const [preset, setPreset] = useState("cut");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const removing = useSheet<NRow>();

  const { data, loading, error: loadError, reload } = useAsync(
    async () => must(await supabase.from("nutrition_plans").select("id, name, calories, protein_g, carbs_g, fat_g, nutrition_plan_meals(id)").eq("coach_id", profile.id).is("client_id", null).order("created_at", { ascending: false })) as NRow[],
    [profile.id],
  );

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const p = N_PRESETS[preset];
    const planName = name.trim() || p.name;
    if (!planName) return setError("Give the meal plan a name.");
    setCreating(true);
    setError(null);
    const { data: plan, error } = await supabase.from("nutrition_plans").insert({ coach_id: profile.id, name: planName, ...p.macros }).select("id").single();
    if (error) {
      setCreating(false);
      return setError(errMsg(error));
    }
    if (p.meals.length) {
      const res = await supabase.from("nutrition_plan_meals").insert(
        p.meals.map((m, i) => {
          const f = MEAL_SPLIT[m.meal];
          return {
            plan_id: plan.id, position: i, meal: m.meal, name: m.name, details: m.details,
            calories: Math.round(p.macros.calories * f), protein_g: Math.round(p.macros.protein_g * f),
            carbs_g: Math.round(p.macros.carbs_g * f), fat_g: Math.round(p.macros.fat_g * f),
          };
        }),
      );
      if (res.error) notify.error(errMsg(res.error));
    }
    setCreating(false);
    router.push(`/coach/plans/nutrition/${plan.id}`);
  }

  async function duplicate(r: NRow) {
    const { data: src, error } = await supabase.from("nutrition_plans").select("notes, nutrition_plan_meals(position, meal, name, details, calories, protein_g, carbs_g, fat_g)").eq("id", r.id).single();
    if (error) return notify.error(errMsg(error));
    const { data: plan, error: e2 } = await supabase
      .from("nutrition_plans")
      .insert({ coach_id: profile.id, name: `${r.name} (copy)`, notes: src.notes, calories: r.calories, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g })
      .select("id")
      .single();
    if (e2) return notify.error(errMsg(e2));
    const srcMeals = src.nutrition_plan_meals as Omit<NutritionPlanMeal, "id" | "plan_id">[];
    if (srcMeals.length) {
      const res = await supabase.from("nutrition_plan_meals").insert(srcMeals.map((m) => ({ ...m, plan_id: plan.id })));
      if (res.error) return notify.error(errMsg(res.error));
    }
    notify.success("Meal plan duplicated");
    router.push(`/coach/plans/nutrition/${plan.id}`);
  }

  async function remove(r: NRow) {
    const { error } = await supabase.from("nutrition_plans").delete().eq("id", r.id);
    if (error) throw error;
    reload({ silent: true });
  }

  return (
    <div className="space-y-5">
      <Card>
        <form onSubmit={create} className="space-y-3" noValidate>
          <h2 className="font-semibold">New meal plan</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start from">
              <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
                <option value="cut">Fat loss · 2000 kcal</option>
                <option value="maintain">Maintenance · 2500 kcal</option>
                <option value="bulk">Lean bulk · 3000 kcal</option>
                <option value="blank">Blank</option>
              </Select>
            </Field>
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={N_PRESETS[preset].name || "e.g. Contest prep"} /></Field>
          </div>
          {error && <ErrorBox message={error} />}
          <Button type="submit" loading={creating}><Plus className="size-4" /> Create meal plan</Button>
        </form>
      </Card>

      {loading ? <Spinner /> : loadError ? <ErrorBox message={loadError} onRetry={reload} /> : data!.length === 0 ? (
        <Empty icon={<Salad className="size-8" />} title="No meal plans yet">Create your first meal plan above.</Empty>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {data!.map((r) => (
            <li key={r.id} className="flex flex-col rounded-2xl border border-line bg-surface">
              <Link href={`/coach/plans/nutrition/${r.id}`} className="flex flex-1 items-start gap-2 p-4 hover:bg-surface-2/60">
                <div className="flex-1">
                  <p className="font-semibold">{r.name}</p>
                  <p className="mt-1 text-sm text-muted tabular-nums">{r.calories} kcal · {r.nutrition_plan_meals.length} meals</p>
                  <p className="mt-1 text-xs text-muted tabular-nums">Protein {r.protein_g} g · Carbs {r.carbs_g} g · Fat {r.fat_g} g</p>
                </div>
                <ChevronRight className="size-5 text-muted" />
              </Link>
              <div className="flex gap-1 border-t border-line p-2">
                <Button size="sm" variant="ghost" onClick={() => duplicate(r)}><Copy className="size-4" /> Duplicate</Button>
                <Button size="sm" variant="ghost" className="ml-auto text-danger" aria-label={`Delete ${r.name}`} onClick={() => removing.show(r)}><Trash2 className="size-4" /> Delete</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmSheet
        {...removing.bind}
        title="Delete meal plan?"
        description={removing.item ? `Delete meal plan "${removing.item.name}"? Meal plans already assigned to clients are not affected.` : undefined}
        confirmLabel="Delete"
        onConfirm={() => remove(removing.item!)}
      />
    </div>
  );
}
