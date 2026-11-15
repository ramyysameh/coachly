import type { SessionSet, SetType } from "./data";

export const SET_TYPES: { type: SetType; label: string; short: string; hint: string }[] = [
  { type: "normal", label: "Working set", short: "", hint: "Counts towards PRs and volume" },
  { type: "warmup", label: "Warm-up", short: "W", hint: "Not counted in PRs, volume or weekly sets" },
  { type: "drop", label: "Drop set", short: "D", hint: "Weight reduced straight after a set" },
  { type: "failure", label: "To failure", short: "F", hint: "No more reps possible with good form" },
];

export const setTypeInfo = (t: SetType | undefined) => SET_TYPES.find((x) => x.type === (t ?? "normal"))!;

/** Text colour for the set badge. Normal sets show their number in the muted colour. */
export const SET_TYPE_TONE: Record<SetType, string> = {
  normal: "text-muted",
  warmup: "text-warn",
  drop: "text-brand-dark",
  failure: "text-danger",
};

/** Warm-ups are preparation, so they're left out of volume, PRs and weekly set counts (see migration 009). */
export const isWorkingSet = (s: Pick<SessionSet, "set_type">) => s.set_type !== "warmup";

/**
 * Label in the Set column: warm-ups and other types show their letter, and working sets are
 * numbered 1, 2, 3… skipping warm-ups, so "W, W, 1, 2, 3" reads the way lifters count.
 */
export function setLabels(sets: Pick<SessionSet, "set_type">[]): string[] {
  let n = 0;
  return sets.map((s) => (s.set_type === "warmup" ? "W" : String(++n)) + (s.set_type === "drop" ? "D" : s.set_type === "failure" ? "F" : ""));
}
