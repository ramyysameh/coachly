"use client";
import Link from "next/link";
import { use, useState } from "react";
import { ChevronLeft, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { clientNames } from "@/lib/clientNames";
import { MEALS, mealTotals, NUTRITION_PLAN_SELECT, sortNutritionPlan, type NutritionPlan, type NutritionPlanMeal } from "@/lib/data";
import { useProfile } from "@/components/AppShell";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, NumInput, Spinner, Textarea } from "@/components/ui";
import { errMsg } from "@/lib/utils";
import { notify } from "@/lib/notify";

const MACROS = ["calories", "protein_g", "carbs_g", "fat_g"] as const;
type MacroKey = (typeof MACROS)[number];
type MealDraft = { key: string; meal: NutritionPlanMeal["meal"]; name: string; details: string } & Record<MacroKey, string>;
type Draft = { name: string; notes: string } & Record<MacroKey, string>;

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const LABEL: Record<MacroKey, string> = { calories: "kcal", protein_g: "Protein g", carbs_g: "Carbs g", fat_g: "Fat g" };
const toNum = (s: string) => (s.trim() === "" ? 0 : Number(s));

function toDraft(p: NutritionPlan): { plan: Draft; meals: MealDraft[] } {
  return {
    plan: { name: p.name, notes: p.notes ?? "", ...Object.fromEntries(MACROS.map((k) => [k, String(p[k])])) } as Draft,
    meals: p.nutrition_plan_meals.map((m) => ({ key: m.id, meal: m.meal, name: m.name, details: m.details ?? "", ...Object.fromEntries(MACROS.map((k) => [k, String(m[k])])) }) as MealDraft),
  };
}

export default function NutritionPlanEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const supabase = createClient();
  const { profile } = useProfile();
  const [plan, setPlan] = useState<Draft | null>(null);
  const [meals, setMeals] = useState<MealDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const p = sortNutritionPlan(must(await supabase.from("nutrition_plans").select(NUTRITION_PLAN_SELECT).eq("id", id).maybeSingle()) as NutritionPlan | null);
    if (!p) return null;
    let clientName: string | null = null;
    if (p.client_id) {
      clientName = (await clientNames(supabase, [p.client_id])).get(p.client_id)?.full_name ?? null;
    }
    const d = toDraft(p);
    setPlan(d.plan);
    setMeals(d.meals);
    return { plan: p, clientName };
  }, [id]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data || !plan) {
    return (
      <Empty title="Meal plan not found">
        <Link href="/coach/plans?tab=nutrition" className="font-semibold text-brand">Back to meal plans</Link>
      </Empty>
    );
  }

  const clientId = data.plan.client_id;
  const back = clientId ? `/coach/clients/${clientId}?tab=nutrition` : "/coach/plans?tab=nutrition";
  const totals = mealTotals(meals.map((m) => Object.fromEntries(MACROS.map((k) => [k, toNum(m[k])])) as Record<MacroKey, number>));
  const setP = (k: keyof Draft, numeric = false) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setPlan({ ...plan, [k]: numeric ? e.target.value.replace(/[^0-9]/g, "") : e.target.value });
  const setM = (key: string, k: keyof MealDraft, numeric = false) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setMeals((ms) => ms.map((m) => (m.key === key ? { ...m, [k]: numeric ? e.target.value.replace(/[^0-9]/g, "") : e.target.value } : m)));
  const addMeal = (meal: MealDraft["meal"]) =>
    setMeals((ms) => [...ms, { key: crypto.randomUUID(), meal, name: "", details: "", calories: "", protein_g: "", carbs_g: "", fat_g: "" }]);

  async function save() {
    if (!plan) return;
    if (!plan.name.trim()) return setErr("Give the meal plan a name.");
    if (meals.some((m) => !m.name.trim())) return setErr("Every meal needs a name, e.g. “Oats & whey”.");
    const vals = Object.fromEntries(MACROS.map((k) => [k, toNum(plan[k])])) as Record<MacroKey, number>;
    if (vals.calories > 20000 || vals.protein_g > 2000 || vals.carbs_g > 2000 || vals.fat_g > 2000) return setErr("One of the daily targets looks too high.");
    if (meals.some((m) => toNum(m.calories) > 10000 || MACROS.slice(1).some((k) => toNum(m[k]) > 1000))) return setErr("One of the meals looks too high.");
    setSaving(true);
    setErr(null);
    const fail = (e: { message: string }) => {
      setSaving(false);
      setErr(errMsg(e));
    };
    const up = await supabase.from("nutrition_plans").update({ name: plan.name.trim(), notes: plan.notes.trim() || null, ...vals }).eq("id", id);
    if (up.error) return fail(up.error);
    const del = await supabase.from("nutrition_plan_meals").delete().eq("plan_id", id);
    if (del.error) return fail(del.error);
    if (meals.length) {
      const order = [...meals].sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal));
      const ins = await supabase.from("nutrition_plan_meals").insert(
        order.map((m, i) => ({
          plan_id: id, position: i, meal: m.meal, name: m.name.trim(), details: m.details.trim() || null,
          ...Object.fromEntries(MACROS.map((k) => [k, toNum(m[k])])),
        })),
      );
      if (ins.error) return fail(ins.error);
    }
    // A client's copy drives their daily targets, so keep the two in step.
    if (clientId) {
      const t = await supabase.from("nutrition_targets").upsert({ client_id: clientId, ...vals, updated_by: profile.id, updated_at: new Date().toISOString() });
      if (t.error) return fail(t.error);
    }
    setSaving(false);
    notify.success("Meal plan saved");
    reload({ silent: true });
  }

  return (
    <div className="space-y-4 pb-24">
      <Link href={back} className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-muted">
        <ChevronLeft className="size-4" /> {clientId ? (data.clientName ?? "Client") : "Meal plans"}
      </Link>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {clientId ? <Badge tone="brand">Assigned to {data.clientName ?? "client"}</Badge> : <Badge>Template</Badge>}
        </div>
        <Field label="Name"><Input value={plan.name} onChange={setP("name")} placeholder="e.g. Fat loss · 2000 kcal" /></Field>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Daily targets</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MACROS.map((k) => (
              <Field key={k} label={k === "calories" ? "Calories" : LABEL[k]}><NumInput value={plan[k]} onChange={setP(k, true)} /></Field>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted tabular-nums">
            <span>Meals add up to {totals.calories} kcal · P {totals.protein_g} · C {totals.carbs_g} · F {totals.fat_g}</span>
            {meals.length > 0 && MACROS.some((k) => totals[k] !== toNum(plan[k])) && (
              <button
                type="button"
                className="font-semibold text-brand"
                onClick={() => setPlan({ ...plan, ...Object.fromEntries(MACROS.map((k) => [k, String(totals[k])])) })}
              >
                Use meal totals
              </button>
            )}
          </div>
          {clientId && <p className="mt-1 text-xs text-muted">Saving also updates this client&apos;s daily targets.</p>}
        </div>
        <Field label="Notes for the client (optional)">
          <Textarea value={plan.notes} onChange={setP("notes")} rows={3} placeholder="e.g. Drink 3 L of water a day. Swap rice for potatoes any time." />
        </Field>
      </Card>

      {MEALS.map((meal) => {
        const items = meals.filter((m) => m.meal === meal);
        return (
          <section key={meal} className="rounded-2xl border border-line bg-surface">
            <div className="flex items-center justify-between px-4 py-2.5">
              <h2 className="font-semibold">{cap(meal)}</h2>
              <span className="text-xs text-muted tabular-nums">{mealTotals(items.map((m) => Object.fromEntries(MACROS.map((k) => [k, toNum(m[k])])) as Record<MacroKey, number>)).calories} kcal</span>
            </div>
            {items.length > 0 && (
              <ul className="divide-y divide-line border-t border-line">
                {items.map((m) => (
                  <li key={m.key} className="space-y-2 px-4 py-3">
                    <div className="flex items-end gap-2">
                      <div className="flex-1"><Field label="Meal"><Input value={m.name} onChange={setM(m.key, "name")} placeholder="e.g. Chicken, rice & veg" /></Field></div>
                      <button
                        type="button"
                        className="flex size-12 items-center justify-center rounded-xl text-danger hover:bg-danger-bg"
                        onClick={() => setMeals((ms) => ms.filter((x) => x.key !== m.key))}
                        aria-label={`Remove ${m.name || "meal"}`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {MACROS.map((k) => <Field key={k} label={LABEL[k]}><NumInput value={m[k]} onChange={setM(m.key, k, true)} /></Field>)}
                    </div>
                    <Field label="Foods & notes (optional)">
                      <Textarea value={m.details} onChange={setM(m.key, "details")} rows={2} placeholder="e.g. 150 g chicken breast, 200 g cooked rice, mixed veg" />
                    </Field>
                  </li>
                ))}
              </ul>
            )}
            <button className="flex min-h-12 w-full items-center gap-2 border-t border-line px-4 text-sm font-semibold text-brand" onClick={() => addMeal(meal)}>
              <Plus className="size-4" /> Add {meal}
            </button>
          </section>
        );
      })}

      <div className="sticky bottom-20 z-10 space-y-2 md:bottom-4">
        {err && <ErrorBox message={err} />}
        <Button size="lg" className="w-full shadow-card" loading={saving} onClick={save}>Save meal plan</Button>
      </div>
    </div>
  );
}
