"use client";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus, Salad, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { MEALS, mealTotals, type Meal, type Targets } from "@/lib/data";
import { Button, Card, Empty, ErrorBox, Field, Input, Meter, NumInput, Select, Spinner } from "@/components/ui";
import { addDays, errMsg, fmtDate, localDate } from "@/lib/utils";

/** One day of meals with totals vs targets. Clients can add/edit/delete; coaches view. */
export default function NutritionDay({ clientId, editable }: { clientId: string; editable: boolean }) {
  const supabase = createClient();
  const [date, setDate] = useState(localDate());
  const [editing, setEditing] = useState<Partial<Meal> | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const [meals, targets] = await Promise.all([
      supabase.from("meal_entries").select("*").eq("client_id", clientId).eq("entry_date", date).order("created_at"),
      supabase.from("nutrition_targets").select("*").eq("client_id", clientId).maybeSingle(),
    ]);
    return { meals: must(meals) as Meal[], targets: must(targets) as Targets | null };
  }, [clientId, date]);

  async function remove(m: Meal) {
    if (!confirm(`Delete "${m.food_name}"?`)) return;
    const { error } = await supabase.from("meal_entries").delete().eq("id", m.id);
    if (error) alert(errMsg(error));
    reload({ silent: true });
  }

  const totals = mealTotals(data?.meals ?? []);
  const isToday = date === localDate();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 rounded-2xl border border-line bg-white p-1">
        <button className="flex size-12 items-center justify-center rounded-xl hover:bg-paper" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
          <ChevronLeft className="size-5" />
        </button>
        <label className="flex flex-1 flex-col items-center">
          <span className="font-semibold">{isToday ? "Today" : fmtDate(date)}</span>
          <input type="date" value={date} max={localDate()} onChange={(e) => e.target.value && setDate(e.target.value)} className="text-xs text-muted" aria-label="Pick a date" />
        </label>
        <button className="flex size-12 items-center justify-center rounded-xl hover:bg-paper disabled:opacity-30" onClick={() => setDate(addDays(date, 1))} disabled={isToday} aria-label="Next day">
          <ChevronRight className="size-5" />
        </button>
      </div>

      {loading ? (
        <Spinner />
      ) : error || !data ? (
        <ErrorBox message={error ?? "Couldn't load meals"} onRetry={reload} />
      ) : (
        <>
          <Card className="space-y-3">
            <Meter label="Calories" value={totals.calories} target={data.targets?.calories} unit="kcal" />
            <div className="grid grid-cols-3 gap-3">
              <Meter label="Protein" value={totals.protein_g} target={data.targets?.protein_g} unit="g" />
              <Meter label="Carbs" value={totals.carbs_g} target={data.targets?.carbs_g} unit="g" />
              <Meter label="Fat" value={totals.fat_g} target={data.targets?.fat_g} unit="g" />
            </div>
            {!data.targets && <p className="text-xs text-muted">No targets set by the coach yet.</p>}
          </Card>

          {data.meals.length === 0 && (
            <Empty icon={<Salad className="size-8" />} title="No meals logged">
              {editable ? "Add what you ate — food, serving, calories and macros." : "Nothing logged for this day."}
            </Empty>
          )}

          {MEALS.map((meal) => {
            const items = data.meals.filter((m) => m.meal === meal);
            if (!items.length && !editable) return null;
            const t = mealTotals(items);
            return (
              <section key={meal} className="rounded-2xl border border-line bg-white">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <h3 className="font-bold capitalize">{meal}</h3>
                  <span className="text-xs text-muted tabular-nums">{Math.round(t.calories)} kcal</span>
                </div>
                {items.length > 0 && (
                  <ul className="divide-y divide-line border-t border-line">
                    {items.map((m) => (
                      <li key={m.id} className="flex items-center gap-2 px-4 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{m.food_name}</p>
                          <p className="text-xs text-muted tabular-nums">
                            {m.serving} · {Math.round(m.calories)} kcal · P {Number(m.protein_g)} · C {Number(m.carbs_g)} · F {Number(m.fat_g)}
                          </p>
                        </div>
                        {editable && (
                          <>
                            <button className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-paper" onClick={() => setEditing(m)} aria-label={`Edit ${m.food_name}`}>
                              <Pencil className="size-4" />
                            </button>
                            <button className="flex size-11 items-center justify-center rounded-xl text-red-700 hover:bg-red-50" onClick={() => remove(m)} aria-label={`Delete ${m.food_name}`}>
                              <Trash2 className="size-4" />
                            </button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {editable && (
                  <button className="flex min-h-12 w-full items-center gap-2 border-t border-line px-4 text-sm font-semibold text-brand" onClick={() => setEditing({ meal, entry_date: date })}>
                    <Plus className="size-4" /> Add food
                  </button>
                )}
              </section>
            );
          })}
        </>
      )}

      {editing && (
        <MealForm
          clientId={clientId}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload({ silent: true });
          }}
        />
      )}
    </div>
  );
}

function MealForm({ clientId, initial, onClose, onSaved }: { clientId: string; initial: Partial<Meal>; onClose: () => void; onSaved: () => void }) {
  const supabase = createClient();
  const [f, setF] = useState({
    meal: initial.meal ?? "breakfast",
    food_name: initial.food_name ?? "",
    serving: initial.serving ?? "",
    calories: initial.calories != null ? String(Number(initial.calories)) : "",
    protein_g: initial.protein_g != null ? String(Number(initial.protein_g)) : "",
    carbs_g: initial.carbs_g != null ? String(Number(initial.carbs_g)) : "",
    fat_g: initial.fat_g != null ? String(Number(initial.fat_g)) : "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const num = (s: string) => (s.trim() === "" ? 0 : Number(s.replace(",", ".")));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!f.food_name.trim()) errs.food_name = "Enter a food name.";
    if (!f.serving.trim()) errs.serving = "Enter a serving size, e.g. 150 g or 1 cup.";
    if (f.calories.trim() === "") errs.calories = "Enter calories.";
    for (const k of ["calories", "protein_g", "carbs_g", "fat_g"] as const) {
      const v = num(f[k]);
      if (!Number.isFinite(v) || v < 0) errs[k] = "Must be 0 or more.";
      else if (v > (k === "calories" ? 10000 : 1000)) errs[k] = "That looks too high.";
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    setError(null);
    const row = {
      meal: f.meal,
      food_name: f.food_name.trim(),
      serving: f.serving.trim(),
      calories: num(f.calories),
      protein_g: num(f.protein_g),
      carbs_g: num(f.carbs_g),
      fat_g: num(f.fat_g),
    };
    const res = initial.id
      ? await supabase.from("meal_entries").update(row).eq("id", initial.id)
      : await supabase.from("meal_entries").insert({ ...row, client_id: clientId, entry_date: initial.entry_date ?? localDate() });
    setSaving(false);
    if (res.error) return setError(errMsg(res.error));
    onSaved();
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <form
        onSubmit={save}
        noValidate
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-3xl bg-white p-5 md:rounded-3xl"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
        role="dialog"
        aria-label={initial.id ? "Edit food" : "Add food"}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{initial.id ? "Edit food" : "Add food"}</h2>
          <button type="button" onClick={onClose} className="flex size-11 items-center justify-center rounded-xl hover:bg-paper" aria-label="Close"><X className="size-5" /></button>
        </div>
        {error && <ErrorBox message={error} />}
        <Field label="Meal">
          <Select value={f.meal} onChange={set("meal")}>
            {MEALS.map((m) => <option key={m} value={m} className="capitalize">{m[0].toUpperCase() + m.slice(1)}</option>)}
          </Select>
        </Field>
        <Field label="Food" error={errors.food_name}>
          <Input value={f.food_name} onChange={set("food_name")} placeholder="e.g. Chicken breast" autoFocus />
        </Field>
        <Field label="Serving size" error={errors.serving}>
          <Input value={f.serving} onChange={set("serving")} placeholder="e.g. 150 g" />
        </Field>
        <Field label="Calories (kcal)" error={errors.calories}>
          <NumInput decimal value={f.calories} onChange={set("calories")} />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Protein g" error={errors.protein_g}><NumInput decimal value={f.protein_g} onChange={set("protein_g")} /></Field>
          <Field label="Carbs g" error={errors.carbs_g}><NumInput decimal value={f.carbs_g} onChange={set("carbs_g")} /></Field>
          <Field label="Fat g" error={errors.fat_g}><NumInput decimal value={f.fat_g} onChange={set("fat_g")} /></Field>
        </div>
        <Button type="submit" loading={saving} size="lg" className="w-full">{initial.id ? "Save changes" : "Add food"}</Button>
      </form>
    </div>
  );
}
