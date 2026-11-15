"use client";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { MEALS, mealTotals, NUTRITION_PLAN_SELECT, sortNutritionPlan, type NutritionPlan } from "@/lib/data";
import { Card } from "@/components/ui";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Read-only meal plan: daily targets and the suggested meals, grouped by meal of the day. */
export function MealPlanView({ plan, title }: { plan: NutritionPlan; title?: string }) {
  const meals = plan.nutrition_plan_meals;
  return (
    <Card className="space-y-3">
      <div>
        {title && <p className="text-xs font-semibold uppercase tracking-wide text-brand">{title}</p>}
        <p className="text-lg font-semibold">{plan.name}</p>
        <p className="text-sm text-muted tabular-nums">
          {plan.calories} kcal · P {plan.protein_g} g · C {plan.carbs_g} g · F {plan.fat_g} g
        </p>
        {plan.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{plan.notes}</p>}
      </div>
      {meals.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {MEALS.map((meal) => {
            const items = meals.filter((m) => m.meal === meal);
            if (!items.length) return null;
            return (
              <section key={meal} className="rounded-xl border border-line p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{cap(meal)}</h3>
                  <span className="text-xs text-muted tabular-nums">{mealTotals(items).calories} kcal</span>
                </div>
                <ul className="mt-1 space-y-1.5 text-sm">
                  {items.map((m) => (
                    <li key={m.id}>
                      <p className="font-medium">{m.name}</p>
                      <p className="text-xs text-muted tabular-nums">{m.calories} kcal · P {m.protein_g} · C {m.carbs_g} · F {m.fat_g}</p>
                      {m.details && <p className="whitespace-pre-wrap text-xs text-muted">{m.details}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/** The client's assigned meal plan, if their coach has given them one. Renders nothing otherwise. */
export function ClientMealPlan({ clientId }: { clientId: string }) {
  const supabase = createClient();
  const { data } = useAsync(
    async () => sortNutritionPlan(must(await supabase.from("nutrition_plans").select(NUTRITION_PLAN_SELECT).eq("client_id", clientId).maybeSingle()) as NutritionPlan | null),
    [clientId],
  );
  if (!data) return null;
  return <MealPlanView plan={data} title="Your meal plan" />;
}
