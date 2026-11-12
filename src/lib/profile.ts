import type { GoalType, Level } from "@/lib/supabase/server";
import { addDays } from "@/lib/utils";

export const GOALS: { value: GoalType; label: string }[] = [
  { value: "fat_loss", label: "Fat loss" },
  { value: "muscle_gain", label: "Muscle gain" },
  { value: "strength", label: "Strength" },
  { value: "general", label: "General fitness" },
];
export const LEVELS: { value: Level; label: string }[] = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];
export const goalLabel = (g: string | null) => GOALS.find((x) => x.value === g)?.label ?? null;
export const levelLabel = (l: string | null) => LEVELS.find((x) => x.value === l)?.label ?? null;

/** Whole years between a YYYY-MM-DD birth date and today. */
export function ageFrom(dob: string | null, today = new Date()): number | null {
  if (!dob) return null;
  const [y, m, d] = dob.split("-").map(Number);
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return age;
}

const CM_PER_IN = 2.54;
export function cmToFtIn(cm: number) {
  const totalIn = Math.round(cm / CM_PER_IN);
  return { ft: Math.floor(totalIn / 12), inch: totalIn % 12 };
}
export const ftInToCm = (ft: number, inch: number) => Math.round((ft * 12 + inch) * CM_PER_IN * 10) / 10;

export function fmtHeight(cm: number | null, unit: "cm" | "ft"): string | null {
  if (cm === null || cm === undefined) return null;
  if (unit === "ft") {
    const { ft, inch } = cmToFtIn(Number(cm));
    return `${ft}′${inch}″`;
  }
  return `${Math.round(Number(cm))} cm`;
}

/** Latest weight and the change against the last entry on/before 30 days earlier (or the oldest entry in that window). */
export function weightTrend(entries: { entry_date: string; weight_kg: number }[]) {
  if (entries.length === 0) return null;
  const sorted = [...entries].sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  const latest = sorted[sorted.length - 1];
  const cutoff = addDays(latest.entry_date, -30);
  const before = sorted.filter((e) => e.entry_date <= cutoff);
  const base = before.length ? before[before.length - 1] : sorted.find((e) => e.entry_date >= cutoff)!;
  const change = base === latest ? null : Number(latest.weight_kg) - Number(base.weight_kg);
  return { latest: Number(latest.weight_kg), date: latest.entry_date, change };
}
