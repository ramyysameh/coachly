import type { Unit } from "./utils";

/** Smallest jump you can usually make on a barbell: two of the smallest common plates. */
export const LOAD_STEP: Record<Unit, number> = { kg: 2.5, lb: 5 };
export const BAR_OPTIONS: Record<Unit, number[]> = { kg: [20, 15, 10, 0], lb: [45, 35, 25, 0] };
export const PLATES: Record<Unit, number[]> = { kg: [25, 20, 15, 10, 5, 2.5, 1.25], lb: [45, 35, 25, 10, 5, 2.5] };

/** RPE choices offered while logging: 10 = nothing left, 9 = one rep left, 8 = two, … */
export const RPE_CHOICES = [6, 7, 7.5, 8, 8.5, 9, 9.5, 10];

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

/**
 * A standard ramp up to the working weight: 40% × 10, 60% × 5, 80% × 3, rounded to a loadable
 * jump. Steps that round to nothing, repeat an earlier load, or reach the working weight are
 * dropped, so a light working weight gets fewer warm-ups. Weights are in the display unit.
 */
export function warmupRamp(working: number, unit: Unit): { weight: number; reps: number }[] {
  if (!(working > 0)) return [];
  const out: { weight: number; reps: number }[] = [];
  for (const [pct, reps] of [[0.4, 10], [0.6, 5], [0.8, 3]] as const) {
    const weight = roundTo(working * pct, LOAD_STEP[unit]);
    if (weight <= 0 || weight >= working || out.some((s) => s.weight === weight)) continue;
    out.push({ weight, reps });
  }
  return out;
}

/**
 * Plates for one side of the bar, heaviest first (greedy, which is exact for standard plate sets).
 * `remainder` is what's left per side when the total can't be loaded exactly.
 */
export function platesPerSide(total: number, bar: number, unit: Unit): { plates: number[]; remainder: number } | null {
  if (!(total >= bar)) return null;
  let side = (total - bar) / 2;
  const plates: number[] = [];
  for (const p of PLATES[unit]) {
    while (side >= p - 1e-9) {
      plates.push(p);
      side -= p;
    }
  }
  return { plates, remainder: Math.round(side * 1000) / 1000 };
}
