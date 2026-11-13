/**
 * Coach-only automatic flags (feature spec §4), calculated from the same logs as
 * everything else: planned vs logged sessions, completed sets and weigh-ins.
 */
import type { Plan } from "@/lib/data";
import { buildDays, type CalSession } from "@/lib/calendar";
import { exerciseOptions, inRange, strengthSeries, type SetRow } from "@/lib/analytics";
import { addDays, fmtDate, fromKg, type Unit } from "@/lib/utils";

export type FlagKind = "missed" | "stalled" | "volume" | "bodyweight";
export type Flag = { clientId: string; kind: FlagKind; title: string; detail: string; tab: "overview" | "progress" };

export type FlagInput = {
  clientId: string;
  goalType: string | null;
  unit: Unit;
  plan: Plan | null;
  sessions: CalSession[];
  sets: SetRow[];
  weights: { entry_date: string; weight_kg: number }[];
};

/** Thresholds, kept together so they're easy to tune. */
export const FLAG_RULES = {
  missedInARow: 2,
  stallDays: 21,
  mainLifts: 3,
  volumeJump: 0.3,
  volumeMinPrevSets: 6,
  bodyweightWeeks: 2,
  bodyweightTolerance: 0.1, // kg change per week that still counts as "flat"
};

/** Planned sessions missed in a row, counting back from yesterday (today isn't missed yet). */
export function missedInARow(plan: Plan | null, sessions: CalSession[], today: string): { count: number; since: string | null } {
  if (!plan?.start_date) return { count: 0, since: null };
  const dates: string[] = [];
  for (let d = addDays(today, -1); d >= plan.start_date && d >= addDays(today, -90); d = addDays(d, -1)) dates.push(d);
  let count = 0;
  let since: string | null = null;
  for (const day of buildDays(dates, plan, sessions, today)) {
    if (day.status === "trained") break;
    if (day.status === "missed") { count++; since = day.date; }
  }
  return { count, since };
}

/**
 * Main lifts = the client's most-trained loaded exercises (3+ sessions in the last 6 weeks).
 * A lift is stalled when its best estimated 1RM hasn't improved for 3+ weeks while it's
 * still being trained.
 */
export function stalledLifts(sets: SetRow[], today: string) {
  const recent = sets.filter((s) => s.performed_on >= addDays(today, -41));
  const main = exerciseOptions(recent, "variant").filter((o) => o.weighted && o.sessions >= 3).slice(0, FLAG_RULES.mainLifts);
  const out: { label: string; days: number; best: number }[] = [];
  for (const lift of main) {
    const series = strengthSeries(sets, lift.key, "variant").filter((p) => p.e1rm !== null);
    let best = 0;
    let improvedOn: string | null = null;
    for (const p of series) {
      if ((p.e1rm ?? 0) > best + 1e-9) { best = p.e1rm!; improvedOn = p.date; }
    }
    if (!improvedOn) continue;
    const since = series.filter((p) => p.date > improvedOn!);
    const days = Math.round((new Date(today + "T12:00:00").getTime() - new Date(improvedOn + "T12:00:00").getTime()) / 86400000);
    const stillTraining = since.some((p) => p.date >= addDays(today, -13));
    if (days >= FLAG_RULES.stallDays && since.length >= 2 && stillTraining) out.push({ label: lift.label, days, best });
  }
  return out;
}

/** Completed sets in the last 7 days vs the 7 days before. */
export function weeklyVolume(sets: SetRow[], today: string) {
  const cur = sets.filter((s) => inRange(s.performed_on, addDays(today, -6), today)).length;
  const prev = sets.filter((s) => inRange(s.performed_on, addDays(today, -13), addDays(today, -7))).length;
  return { cur, prev, change: prev ? (cur - prev) / prev : null };
}

/** Average weigh-in for each of the last `weeks + 1` weeks (index 0 = the last 7 days). */
export function weeklyWeights(weights: FlagInput["weights"], today: string, weeks = FLAG_RULES.bodyweightWeeks) {
  return Array.from({ length: weeks + 1 }, (_, i) => {
    const to = addDays(today, -7 * i);
    const win = weights.filter((w) => inRange(w.entry_date, addDays(to, -6), to));
    return win.length ? win.reduce((t, w) => t + Number(w.weight_kg), 0) / win.length : null;
  });
}

/**
 * Bodyweight moving against the goal week after week: rising for fat loss, falling for
 * muscle gain. Strength and general goals don't have a direction, so they're never flagged.
 */
export function weightAgainstGoal(goalType: string | null, weights: FlagInput["weights"], today: string) {
  const dir = goalType === "fat_loss" ? 1 : goalType === "muscle_gain" ? -1 : 0; // direction that's "wrong"
  if (!dir) return null;
  const avgs = weeklyWeights(weights, today);
  if (avgs.some((a) => a === null)) return null;
  // avgs[0] is the latest week; compare each week with the one before it
  for (let i = 0; i < avgs.length - 1; i++) {
    if ((avgs[i]! - avgs[i + 1]!) * dir <= FLAG_RULES.bodyweightTolerance) return null;
  }
  return { change: avgs[0]! - avgs.at(-1)! };
}

export function clientFlags(c: FlagInput, today: string): Flag[] {
  const flags: Flag[] = [];
  const missed = missedInARow(c.plan, c.sessions, today);
  if (missed.count >= FLAG_RULES.missedInARow) {
    flags.push({ clientId: c.clientId, kind: "missed", tab: "overview", title: `Missed ${missed.count} planned sessions in a row`, detail: `No workout logged on a planned day since ${fmtDate(missed.since!)}` });
  }
  for (const s of stalledLifts(c.sets, today)) {
    flags.push({ clientId: c.clientId, kind: "stalled", tab: "progress", title: `No progress on ${s.label} for ${Math.floor(s.days / 7)} weeks`, detail: `Est. 1RM still ${fromKg(s.best, c.unit)} ${c.unit}` });
  }
  const vol = weeklyVolume(c.sets, today);
  if (vol.change !== null && vol.prev >= FLAG_RULES.volumeMinPrevSets && vol.change > FLAG_RULES.volumeJump) {
    flags.push({ clientId: c.clientId, kind: "volume", tab: "progress", title: `Weekly volume up ${Math.round(vol.change * 100)}%`, detail: `${vol.cur} sets in the last 7 days vs ${vol.prev} the week before (injury risk)` });
  }
  const bw = weightAgainstGoal(c.goalType, c.weights, today);
  if (bw) {
    const up = bw.change > 0;
    flags.push({
      clientId: c.clientId, kind: "bodyweight", tab: "progress",
      title: `Bodyweight ${up ? "rising" : "falling"} for ${FLAG_RULES.bodyweightWeeks}+ weeks`,
      detail: `${up ? "+" : "−"}${Math.abs(fromKg(bw.change, c.unit) ?? 0)} ${c.unit} (weekly average), against a ${c.goalType === "fat_loss" ? "fat loss" : "muscle gain"} goal`,
    });
  }
  return flags;
}
