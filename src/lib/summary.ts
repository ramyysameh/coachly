import type { Session } from "./data";
import { isWorkingSet } from "./setTypes";

export type SummaryStats = { minutes: number | null; exercises: number; sets: number; volumeKg: number };

/** What a finished workout adds up to. Warm-ups don't count, and only exercises with a logged set do. */
export function summaryStats(s: Session): SummaryStats {
  const exs = s.session_exercises ?? [];
  const done = exs.map((e) => e.session_sets.filter((x) => x.completed && isWorkingSet(x)));
  const mins = s.completed_at ? Math.round((new Date(s.completed_at).getTime() - new Date(s.started_at).getTime()) / 60000) : null;
  return {
    // A session left open overnight isn't a 9-hour workout: hide implausible durations.
    minutes: mins !== null && mins > 0 && mins < 600 ? mins : null,
    exercises: done.filter((d) => d.length > 0).length,
    sets: done.reduce((n, d) => n + d.length, 0),
    volumeKg: done.flat().reduce((t, x) => t + Number(x.weight_kg ?? 0) * Number(x.reps ?? 0), 0),
  };
}

// Rough, commonly quoted weights. Heaviest first.
const THINGS: { kg: number; one: string; many: string }[] = [
  { kg: 12000, one: "city bus", many: "city buses" },
  { kg: 5000, one: "elephant", many: "elephants" },
  { kg: 1500, one: "car", many: "cars" },
  { kg: 400, one: "grand piano", many: "grand pianos" },
  { kg: 70, one: "washing machine", many: "washing machines" },
];

/**
 * "about 3 grand pianos": total volume as everyday objects, picking the biggest object it reaches.
 * Null for tiny totals (bodyweight-only days), where the comparison would be silly.
 */
export function volumeComparison(kg: number): string | null {
  const thing = THINGS.find((t) => kg >= t.kg);
  if (!thing) return null;
  const n = kg / thing.kg;
  const rounded = n < 10 ? Math.round(n * 10) / 10 : Math.round(n);
  return rounded === 1 ? `about a ${thing.one}` : `about ${rounded} ${thing.many}`;
}

/** "1h 05m" / "48 min". */
export function fmtMinutes(m: number | null): string {
  if (m === null) return "—";
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`;
}
