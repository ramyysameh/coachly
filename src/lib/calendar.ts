import { scheduledDay, type Plan } from "@/lib/data";
import { addDays, isoWeekday, localDate } from "@/lib/utils";

export type DayStatus = "trained" | "rest" | "missed" | "upcoming" | "today-planned" | "none";
export type SessionType = "push" | "pull" | "legs" | "upper" | "lower" | "full" | "cardio" | "other";

export type CalSession = {
  id: string; scheduled_date: string; name: string; status: "in_progress" | "completed";
  plan_day_id: string | null; started_at: string; completed_at: string | null;
};

export type CalDay = { date: string; status: DayStatus; type: SessionType | null; sessions: CalSession[]; planned: string | null };

export const TYPE_STYLE: Record<SessionType, { label: string; dot: string }> = {
  push: { label: "Push", dot: "bg-sky-500" },
  pull: { label: "Pull", dot: "bg-violet-500" },
  legs: { label: "Legs", dot: "bg-amber-500" },
  upper: { label: "Upper", dot: "bg-cyan-500" },
  lower: { label: "Lower", dot: "bg-orange-500" },
  full: { label: "Full body", dot: "bg-brand" },
  cardio: { label: "Cardio", dot: "bg-rose-500" },
  other: { label: "Other", dot: "bg-slate-500" },
};

/** Session type from the workout/day name (e.g. "Push A", "Lower body"). */
export function sessionType(name: string): SessionType {
  const n = name.toLowerCase();
  if (/push|chest|press/.test(n)) return "push";
  if (/pull|back/.test(n)) return "pull";
  if (/upper/.test(n)) return "upper";
  if (/lower/.test(n)) return "lower";
  if (/leg|squat/.test(n)) return "legs";
  if (/full|total/.test(n)) return "full";
  if (/cardio|run|bike|row(ing)? erg|conditioning|hiit/.test(n)) return "cardio";
  return "other";
}

/** Status for each date, from the active plan's weekdays and the logged sessions. */
export function buildDays(dates: string[], plan: Plan | null, sessions: CalSession[], today = localDate()): CalDay[] {
  const byDate = new Map<string, CalSession[]>();
  sessions.forEach((s) => byDate.set(s.scheduled_date, [...(byDate.get(s.scheduled_date) ?? []), s]));
  return dates.map((date) => {
    const all = byDate.get(date) ?? [];
    const done = all.filter((s) => s.status === "completed");
    const day = scheduledDay(plan, date);
    let status: DayStatus = "none";
    if (done.length) status = "trained";
    else if (day) status = date > today ? "upcoming" : date === today ? "today-planned" : "missed";
    else if (plan?.start_date && date >= plan.start_date) status = "rest";
    const typeName = done[0]?.name ?? day?.name ?? null;
    return { date, status, type: typeName ? sessionType(typeName) : null, sessions: all, planned: day?.name ?? null };
  });
}

/** Monday-first grid of dates covering the month of `month` (YYYY-MM-01). Leading blanks are null. */
export function monthGrid(month: string): (string | null)[] {
  const first = month.slice(0, 8) + "01";
  const lead = isoWeekday(first) - 1;
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = first; d.slice(0, 7) === first.slice(0, 7); d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function weekDates(anchor = localDate()): string[] {
  const monday = addDays(anchor, -(isoWeekday(anchor) - 1));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/**
 * Streak = planned sessions completed in a row, counting back from the most recent
 * planned day (today only counts once it's done). Rest days and extra sessions don't break it.
 */
export function streak(plan: Plan | null, sessions: CalSession[], today = localDate()): number {
  if (!plan?.start_date) return 0;
  const doneDates = new Set(sessions.filter((s) => s.status === "completed").map((s) => s.scheduled_date));
  let n = 0;
  for (let d = today; d >= plan.start_date; d = addDays(d, -1)) {
    if (!scheduledDay(plan, d)) continue;
    if (doneDates.has(d)) n++;
    else if (d !== today) break;
  }
  return n;
}

/** Adherence over the given days: planned days that were trained ÷ planned days so far. */
export function adherence(days: CalDay[], today = localDate()) {
  const planned = days.filter((d) => d.planned && (d.date < today || (d.date === today && d.status === "trained")));
  const hit = planned.filter((d) => d.status === "trained").length;
  return { hit, planned: planned.length, pct: planned.length ? Math.round((hit / planned.length) * 100) : null };
}
