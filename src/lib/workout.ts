// Workout-structure helpers shared by the plan editor and the logger.

type Grouped = { superset_group: number | null };

/**
 * Splits exercises into runs. Adjacent exercises with the same non-null superset_group form a
 * superset; everything else is a run of one. A lone exercise with a group (after reordering)
 * is not a superset.
 */
export function supersetRuns<T extends Grouped>(items: T[]): { items: T[]; start: number; superset: boolean }[] {
  const runs: { items: T[]; start: number; superset: boolean }[] = [];
  items.forEach((it, i) => {
    const last = runs.at(-1);
    if (last && it.superset_group != null && last.items.at(-1)!.superset_group === it.superset_group) last.items.push(it);
    else runs.push({ items: [it], start: i, superset: false });
  });
  runs.forEach((r) => (r.superset = r.items.length > 1));
  return runs;
}

/** Canonical numbering: each superset run gets 1, 2, 3… in order, and singles get null. */
function normalize(groups: (number | null)[]): (number | null)[] {
  const out = groups.slice();
  let next = 1;
  supersetRuns(groups.map((g) => ({ superset_group: g }))).forEach((r) => {
    const id = r.superset ? next++ : null;
    r.items.forEach((_, k) => (out[r.start + k] = id));
  });
  return out;
}

/** Links exercise i with i + 1 into one superset, or splits them apart if they're already linked. */
export function toggleSupersetLink(groups: (number | null)[], i: number): (number | null)[] {
  const g = groups.slice();
  const linked = g[i] != null && g[i] === g[i + 1];
  const fresh = Math.max(0, ...g.map((x) => x ?? 0)) + 1;
  if (linked) {
    // Everything after i in this run moves to a new group.
    const old = g[i];
    for (let j = i + 1; j < g.length && g[j] === old; j++) g[j] = fresh;
  } else {
    const target = g[i] ?? g[i + 1] ?? fresh;
    const nextOld = g[i + 1];
    g[i] = target;
    // Pull i + 1's whole run into the group (a plain exercise just joins).
    for (let j = i + 1; j < g.length && (j === i + 1 || (nextOld != null && g[j] === nextOld)); j++) g[j] = target;
  }
  return normalize(g);
}

export const isLinkedToNext = (groups: (number | null)[], i: number) => groups[i] != null && groups[i] === groups[i + 1];

/** 45 → "45s", 90 → "1:30". */
export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null) return "-";
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** Accepts "90", "1:30" or "1.30" (minutes:seconds). Returns seconds, or null if unreadable. */
export function parseDuration(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const m = /^(\d+)[:.](\d{1,2})$/.exec(t);
  if (m) return Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
  return /^\d+$/.test(t) ? Number(t) : null;
}
