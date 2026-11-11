import type { SupabaseClient } from "@supabase/supabase-js";
import { isoWeekday } from "./utils";
import { must } from "./useAsync";

export type Exercise = { id: string; name: string; muscle_group: string | null; equipment: string | null; is_bodyweight: boolean; created_by: string | null };
export type PlanExercise = {
  id: string; plan_day_id: string; exercise_id: string; position: number;
  target_sets: number; rep_min: number; rep_max: number; rest_seconds: number; notes: string | null;
  exercises: Exercise;
};
export type PlanDay = { id: string; plan_id: string; position: number; name: string; weekdays: number[]; plan_exercises: PlanExercise[] };
export type Plan = {
  id: string; coach_id: string; client_id: string | null; name: string; description: string | null;
  start_date: string | null; is_active: boolean; source_plan_id: string | null; created_at: string;
  plan_days: PlanDay[];
};

export type SessionSet = { id: string; session_exercise_id: string; set_number: number; reps: number | null; weight_kg: number | null; completed: boolean };
export type SessionExercise = {
  id: string; session_id: string; exercise_id: string | null; position: number; exercise_name: string; is_bodyweight: boolean;
  target_sets: number; rep_min: number; rep_max: number; rest_seconds: number; coach_notes: string | null; client_notes: string | null;
  session_sets: SessionSet[];
};
export type Session = {
  id: string; client_id: string; plan_id: string | null; plan_day_id: string | null; scheduled_date: string; name: string;
  status: "in_progress" | "completed"; notes: string | null; started_at: string; completed_at: string | null;
  session_exercises?: SessionExercise[];
};

export type Meal = {
  id: string; client_id: string; entry_date: string; meal: "breakfast" | "lunch" | "dinner" | "snack";
  food_name: string; serving: string; calories: number; protein_g: number; carbs_g: number; fat_g: number; updated_at: string;
};
export type Targets = { client_id: string; calories: number; protein_g: number; carbs_g: number; fat_g: number };

export const PLAN_SELECT = "*, plan_days(*, plan_exercises(*, exercises(*)))";
export const SESSION_SELECT = "*, session_exercises(*, session_sets(*))";

export function sortPlan<T extends Plan | null>(plan: T): T {
  if (!plan) return plan;
  plan.plan_days.sort((a, b) => a.position - b.position);
  plan.plan_days.forEach((d) => d.plan_exercises.sort((a, b) => a.position - b.position));
  return plan;
}

export function sortSession<T extends Session | null>(s: T): T {
  if (!s?.session_exercises) return s;
  s.session_exercises.sort((a, b) => a.position - b.position);
  s.session_exercises.forEach((e) => e.session_sets.sort((a, b) => a.set_number - b.set_number));
  return s;
}

export async function getActivePlan(supabase: SupabaseClient, clientId: string): Promise<Plan | null> {
  const data = must(await supabase.from("plans").select(PLAN_SELECT).eq("client_id", clientId).eq("is_active", true).maybeSingle());
  return sortPlan(data as Plan | null);
}

/** The plan day scheduled on a date, if the plan has started and the weekday matches. */
export function scheduledDay(plan: Plan | null, date: string): PlanDay | null {
  if (!plan || !plan.start_date || date < plan.start_date) return null;
  const wd = isoWeekday(date);
  return plan.plan_days.find((d) => d.weekdays.includes(wd)) ?? null;
}

export function mealTotals(meals: Pick<Meal, "calories" | "protein_g" | "carbs_g" | "fat_g">[]) {
  return meals.reduce(
    (t, m) => ({
      calories: t.calories + Number(m.calories),
      protein_g: t.protein_g + Number(m.protein_g),
      carbs_g: t.carbs_g + Number(m.carbs_g),
      fat_g: t.fat_g + Number(m.fat_g),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
}

export const MEALS: Meal["meal"][] = ["breakfast", "lunch", "dinner", "snack"];
