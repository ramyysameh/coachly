/**
 * Phase 2 analytics. Everything here is calculated from completed sets
 * (public.completed_sets) and sessions — nothing is stored twice.
 */
import { MUSCLES, type Muscle } from "@/lib/muscles";
import { addDays, isoWeekday } from "@/lib/utils";

export type SetRow = {
  session_id: string; performed_on: string; session_name: string;
  exercise_id: string | null; exercise_name: string; movement_id: string | null; movement_name: string | null; is_bodyweight: boolean;
  set_number: number; weight_kg: number | null; reps: number | null;
  primary_muscles: string[]; secondary_muscles: string[];
};

export type SessionRow = { id: string; scheduled_date: string; started_at: string; completed_at: string | null; status: "in_progress" | "completed" };

/** Estimated one-rep max (Epley): w × (1 + reps / 30). A single is its own 1RM. */
export function e1rm(weight: number | null, reps: number | null): number | null {
  const w = Number(weight ?? 0);
  const r = Number(reps ?? 0);
  if (w <= 0 || r <= 0) return null;
  return r === 1 ? w : w * (1 + r / 30);
}

export const setVolume = (s: Pick<SetRow, "weight_kg" | "reps">) => Number(s.weight_kg ?? 0) * Number(s.reps ?? 0);

// ───────────────────────── Grouping: per variant or per movement ─────────────────────────
export type GroupBy = "variant" | "movement";

export function groupKey(s: SetRow, by: GroupBy): string {
  if (by === "movement" && s.movement_id) return `m:${s.movement_id}`;
  return s.exercise_id ? `e:${s.exercise_id}` : `n:${s.exercise_name}`;
}
export function groupLabel(s: SetRow, by: GroupBy): string {
  return by === "movement" && s.movement_name ? s.movement_name : s.exercise_name;
}

export type ExerciseOption = { key: string; label: string; sessions: number; weighted: boolean };

/** Exercises (or movements) that have logged sets, most-trained first. */
export function exerciseOptions(sets: SetRow[], by: GroupBy): ExerciseOption[] {
  const map = new Map<string, { label: string; sessions: Set<string>; weighted: boolean }>();
  for (const s of sets) {
    const k = groupKey(s, by);
    const g = map.get(k) ?? { label: groupLabel(s, by), sessions: new Set<string>(), weighted: false };
    g.sessions.add(s.session_id);
    if (Number(s.weight_kg ?? 0) > 0) g.weighted = true;
    map.set(k, g);
  }
  return [...map.entries()]
    .map(([key, g]) => ({ key, label: g.label, sessions: g.sessions.size, weighted: g.weighted }))
    .sort((a, b) => b.sessions - a.sessions || a.label.localeCompare(b.label));
}

export type StrengthPoint = { date: string; e1rm: number | null; weight: number | null; reps: number | null; bestReps: number };

/** One point per session date: the best estimated 1RM and the set that produced it. */
export function strengthSeries(sets: SetRow[], key: string, by: GroupBy): StrengthPoint[] {
  const byDate = new Map<string, StrengthPoint>();
  for (const s of sets) {
    if (groupKey(s, by) !== key) continue;
    const p = byDate.get(s.performed_on) ?? { date: s.performed_on, e1rm: null, weight: null, reps: null, bestReps: 0 };
    const est = e1rm(s.weight_kg, s.reps);
    if (est !== null && (p.e1rm === null || est > p.e1rm)) {
      p.e1rm = est;
      p.weight = Number(s.weight_kg);
      p.reps = s.reps;
    }
    p.bestReps = Math.max(p.bestReps, Number(s.reps ?? 0));
    byDate.set(s.performed_on, p);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ───────────────────────── Personal records ─────────────────────────
export type PrKind = "weight" | "reps" | "e1rm";
export const PR_LABEL: Record<PrKind, string> = { weight: "Heaviest weight", reps: "Most reps", e1rm: "Best est. 1RM" };

export type PrEvent = {
  kind: PrKind; key: string; label: string; date: string; session_id: string;
  value: number; weight: number | null; reps: number | null; previous: number;
};

/**
 * Walks sets in date order per exercise variant and emits an event each time a record
 * is beaten. The first session of an exercise sets the baseline and is not a PR.
 * Records are per variant: flat dumbbell and flat barbell loads aren't comparable.
 */
export function prEvents(sets: SetRow[]): PrEvent[] {
  // "Most reps" only means something for bodyweight work; loaded lifts use weight and est. 1RM
  const weighted = new Set(sets.filter((s) => Number(s.weight_kg ?? 0) > 0).map((s) => groupKey(s, "variant")));
  const best = new Map<string, Record<PrKind, number>>();
  const firstSession = new Map<string, string>();
  const events: PrEvent[] = [];
  // sets arrive ordered by date/session; process a session's sets together so
  // several sets in one session only produce one event per record type
  const sessions = new Map<string, SetRow[]>();
  for (const s of sets) sessions.set(s.session_id, [...(sessions.get(s.session_id) ?? []), s]);
  for (const [sessionId, rows] of sessions) {
    const byEx = new Map<string, SetRow[]>();
    rows.forEach((s) => byEx.set(groupKey(s, "variant"), [...(byEx.get(groupKey(s, "variant")) ?? []), s]));
    for (const [key, exRows] of byEx) {
      if (!firstSession.has(key)) firstSession.set(key, sessionId);
      const prev = best.get(key) ?? { weight: 0, reps: 0, e1rm: 0 };
      const top: Record<PrKind, { v: number; s: SetRow } | null> = { weight: null, reps: null, e1rm: null };
      for (const s of exRows) {
        const w = Number(s.weight_kg ?? 0), r = Number(s.reps ?? 0), est = e1rm(s.weight_kg, s.reps) ?? 0;
        if (w > 0 && (!top.weight || w > top.weight.v || (w === top.weight.v && r > Number(top.weight.s.reps ?? 0)))) top.weight = { v: w, s };
        if (r > 0 && (!top.reps || r > top.reps.v)) top.reps = { v: r, s };
        if (est > 0 && (!top.e1rm || est > top.e1rm.v)) top.e1rm = { v: est, s };
      }
      const baseline = firstSession.get(key) === sessionId;
      for (const kind of ["weight", "reps", "e1rm"] as PrKind[]) {
        const t = top[kind];
        if (!t || t.v <= prev[kind] + 1e-9) continue;
        if (kind === "reps" && weighted.has(key)) continue;
        if (!baseline) {
          events.push({
            kind, key, label: t.s.exercise_name, date: t.s.performed_on, session_id: sessionId,
            value: t.v, weight: t.s.weight_kg !== null ? Number(t.s.weight_kg) : null, reps: t.s.reps, previous: prev[kind],
          });
        }
        prev[kind] = t.v;
      }
      best.set(key, prev);
    }
  }
  return events;
}

export type CurrentRecord = { key: string; label: string; weight: number | null; weightReps: number | null; e1rm: number | null; reps: number | null; lastPr: string | null; bodyweight: boolean };

/** Current best weight / est. 1RM / reps for each variant. */
export function currentRecords(sets: SetRow[], events: PrEvent[]): CurrentRecord[] {
  const map = new Map<string, CurrentRecord>();
  for (const s of sets) {
    const key = groupKey(s, "variant");
    const r = map.get(key) ?? { key, label: s.exercise_name, weight: null, weightReps: null, e1rm: null, reps: null, lastPr: null, bodyweight: true };
    const w = Number(s.weight_kg ?? 0), reps = Number(s.reps ?? 0), est = e1rm(s.weight_kg, s.reps);
    if (w > 0) r.bodyweight = false;
    if (w > 0 && (r.weight === null || w > r.weight || (w === r.weight && reps > (r.weightReps ?? 0)))) { r.weight = w; r.weightReps = reps; }
    if (est !== null && (r.e1rm === null || est > r.e1rm)) r.e1rm = est;
    if (reps > 0 && (r.reps === null || reps > r.reps)) r.reps = reps;
    map.set(key, r);
  }
  events.forEach((e) => {
    const r = map.get(e.key);
    if (r && (!r.lastPr || e.date > r.lastPr)) r.lastPr = e.date;
  });
  return [...map.values()];
}

// ───────────────────────── Weekly sets per muscle ─────────────────────────
/** Each completed set counts 1 for its primary muscles and 0.5 for secondary muscles. */
export function setsPerMuscle(sets: SetRow[]): Record<Muscle, number> {
  const out = Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;
  for (const s of sets) {
    s.primary_muscles.forEach((m) => { if (m in out) out[m as Muscle] += 1; });
    s.secondary_muscles.forEach((m) => { if (m in out && !s.primary_muscles.includes(m)) out[m as Muscle] += 0.5; });
  }
  return out;
}

export const DEFAULT_TARGET = { min: 10, max: 20 };
export type VolumeStatus = "none" | "below" | "within" | "above";
export function volumeStatus(sets: number, target = DEFAULT_TARGET): VolumeStatus {
  if (sets <= 0) return "none";
  if (sets < target.min) return "below";
  if (sets > target.max) return "above";
  return "within";
}

/** Monday of the week containing `date`. */
export const weekStart = (date: string) => addDays(date, -(isoWeekday(date) - 1));

export const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

// ───────────────────────── Body weight ─────────────────────────
/** Each weigh-in with the average of all weigh-ins in the 7 days ending that day. */
export function weightWithAverage(entries: { entry_date: string; weight_kg: number }[]) {
  const sorted = [...entries].sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  return sorted.map((e) => {
    const from = addDays(e.entry_date, -6);
    const win = sorted.filter((x) => x.entry_date >= from && x.entry_date <= e.entry_date);
    return { date: e.entry_date, weight: Number(e.weight_kg), avg7: win.reduce((t, x) => t + Number(x.weight_kg), 0) / win.length };
  });
}

// ───────────────────────── Sessions: frequency, duration, totals ─────────────────────────
export function durationMin(s: SessionRow): number | null {
  if (!s.completed_at) return null;
  const m = (new Date(s.completed_at).getTime() - new Date(s.started_at).getTime()) / 60000;
  return m > 1 && m < 300 ? m : null; // ignore sessions left open for hours
}

export type PeriodTotals = { sessions: number; volumeKg: number; sets: number; prs: number; avgMinutes: number | null };

export function periodTotals(from: string, to: string, sessions: SessionRow[], sets: SetRow[], events: PrEvent[]): PeriodTotals {
  const done = sessions.filter((s) => s.status === "completed" && inRange(s.scheduled_date, from, to));
  const mins = done.map(durationMin).filter((m): m is number => m !== null);
  const periodSets = sets.filter((s) => inRange(s.performed_on, from, to));
  return {
    sessions: done.length,
    volumeKg: periodSets.reduce((t, s) => t + setVolume(s), 0),
    sets: periodSets.length,
    // one per exercise per session, even if a set beat both the weight and the est. 1RM record
    prs: new Set(events.filter((e) => inRange(e.date, from, to)).map((e) => `${e.session_id}|${e.key}`)).size,
    avgMinutes: mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : null,
  };
}

/** First and last day of the calendar month containing `date`, and of the month before. */
export function monthBounds(date: string) {
  const first = date.slice(0, 8) + "01";
  const d = new Date(first + "T12:00:00");
  d.setMonth(d.getMonth() + 1);
  const nextFirst = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const prevLast = addDays(first, -1);
  return { from: first, to: addDays(nextFirst, -1), prevFrom: prevLast.slice(0, 8) + "01", prevTo: prevLast };
}
