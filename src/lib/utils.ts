export type Unit = "kg" | "lb";

const LB_PER_KG = 2.2046226218;

/** Weights are stored in kg; convert for display in the user's unit. */
export function fromKg(kg: number | null | undefined, unit: Unit): number | null {
  if (kg === null || kg === undefined) return null;
  const v = unit === "lb" ? Number(kg) * LB_PER_KG : Number(kg);
  return Math.round(v * 10) / 10;
}

export function toKg(value: number | null | undefined, unit: Unit): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return unit === "lb" ? value / LB_PER_KG : value;
}

export function fmtWeight(kg: number | null | undefined, unit: Unit): string {
  const v = fromKg(kg, unit);
  return v === null ? "-" : `${v} ${unit}`;
}

/** Local calendar date as YYYY-MM-DD (not UTC). */
export function localDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + n);
  return localDate(d);
}

/** ISO weekday 1 (Mon) … 7 (Sun) for a YYYY-MM-DD date. */
export function isoWeekday(date: string): number {
  const d = new Date(date + "T12:00:00").getDay();
  return d === 0 ? 7 : d;
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function fmtDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) {
  return new Date(date.length === 10 ? date + "T12:00:00" : date).toLocaleDateString(undefined, opts);
}

export function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function fmtDateTime(ts: string) {
  const d = new Date(ts);
  const today = localDate();
  const day = localDate(d);
  if (day === today) return fmtTime(ts);
  if (day === addDays(today, -1)) return `Yesterday ${fmtTime(ts)}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${fmtTime(ts)}`;
}

export function fmtRest(sec: number) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m} min`;
}

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/** Turns a Supabase/Postgres error into a readable message. */
export function errMsg(e: unknown): string {
  if (!e) return "Something went wrong";
  if (typeof e === "string") return e;
  const anyE = e as { message?: string };
  return anyE.message || "Something went wrong";
}
