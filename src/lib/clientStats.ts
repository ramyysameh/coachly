/**
 * The handful of numbers a coach scans first, worked out from the same logs as everything else:
 * consistency, last workout, PRs, bodyweight trend and the automatic flags. Used by the Clients
 * list and the client profile summary so both always agree.
 */
import type { Plan } from "@/lib/data";
import { adherence, buildDays, streak, type CalSession } from "@/lib/calendar";
import { durationMin, inRange, prEvents, setVolume, type PrEvent, type SetRow } from "@/lib/analytics";
import { clientFlags, type Flag } from "@/lib/flags";
import { ageFrom, weightTrend } from "@/lib/profile";
import { addDays, type Unit } from "@/lib/utils";

export type StatsProfile = {
  id: string; date_of_birth: string | null; goal_type: string | null; weight_unit: Unit; training_days_per_week: number | null;
};

export type ClientStats = {
  age: number | null;
  weight: { latest: number; date: string; change: number | null } | null;
  /** completed sessions in the last 28 days */
  sessions28: number;
  /** completed sessions this week (last 7 days) and the weekly target, if any */
  week: { done: number; target: number | null };
  /** planned-day adherence over 28 days when there's a plan, else sessions vs weekly target */
  consistency: number | null;
  streak: number;
  lastWorkout: string | null;
  prs30: number;
  recentPrs: PrEvent[];
  volume28Kg: number;
  avgMinutes: number | null;
  flags: Flag[];
};

export function clientStats(
  input: { profile: StatsProfile; plan: Plan | null; sessions: CalSession[]; sets: SetRow[]; weights: { entry_date: string; weight_kg: number }[] },
  today: string,
): ClientStats {
  const { profile, plan, sessions, sets, weights } = input;
  const from28 = addDays(today, -27);
  const done = sessions.filter((s) => s.status === "completed");
  const done28 = done.filter((s) => inRange(s.scheduled_date, from28, today));
  const week = done.filter((s) => inRange(s.scheduled_date, addDays(today, -6), today)).length;
  const target = profile.training_days_per_week;

  let consistency: number | null = null;
  if (plan?.start_date) {
    const dates = Array.from({ length: 28 }, (_, i) => addDays(from28, i));
    consistency = adherence(buildDays(dates, plan, sessions, today), today).pct;
  } else if (target) {
    consistency = Math.min(100, Math.round((done28.length / (target * 4)) * 100));
  }

  const events = prEvents(sets);
  const from30 = addDays(today, -29);
  const recent = events.filter((e) => e.date >= from30).sort((a, b) => b.date.localeCompare(a.date));
  const mins = done28.map((s) => durationMin(s)).filter((m): m is number => m !== null);
  const last = done.map((s) => s.completed_at).filter((d): d is string => !!d).sort().at(-1) ?? null;

  return {
    age: ageFrom(profile.date_of_birth),
    weight: weightTrend(weights),
    sessions28: done28.length,
    week: { done: week, target },
    consistency,
    streak: streak(plan, sessions, today),
    lastWorkout: last,
    // one per exercise per session, matching periodTotals()
    prs30: new Set(recent.map((e) => `${e.session_id}|${e.key}`)).size,
    recentPrs: recent,
    volume28Kg: sets.filter((s) => inRange(s.performed_on, from28, today)).reduce((t, s) => t + setVolume(s), 0),
    avgMinutes: mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : null,
    flags: clientFlags({
      clientId: profile.id, goalType: profile.goal_type, unit: profile.weight_unit, plan,
      sessions, sets: sets.filter((s) => s.performed_on >= addDays(today, -120)), weights,
    }, today),
  };
}

/** "Today", "Yesterday", "3d ago", "2w ago" for a timestamp. */
export function ago(ts: string | null, today: string): string | null {
  if (!ts) return null;
  const d = ts.slice(0, 10);
  const days = Math.round((new Date(today + "T12:00:00").getTime() - new Date(d + "T12:00:00").getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Green / amber / red band for a consistency percentage. */
export const consistencyTone = (pct: number | null): "good" | "ok" | "low" | "none" =>
  pct === null ? "none" : pct >= 80 ? "good" : pct >= 50 ? "ok" : "low";
