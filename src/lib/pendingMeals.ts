"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Meal } from "./data";
import { isUnreachable } from "./supabase/authState";

// Meal adds/edits/deletes made without a connection are kept here, in order, and replayed
// when the app is back online. New meals get their id on the device, so replaying an add
// that actually reached the server is harmless (upsert by id).

export type MealRow = Omit<Meal, "updated_at">;
type Op = { op: "upsert"; row: MealRow } | { op: "delete"; id: string; client_id: string; entry_date: string };
const KEY = "coachly:pending-meals";

function read(): Op[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}
function write(ops: Op[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ops));
  } catch {
    /* storage full or disabled */
  }
}

function idOf(op: Op) {
  return op.op === "upsert" ? op.row.id : op.id;
}

function queue(op: Op) {
  // Keep only the latest operation per meal.
  write([...read().filter((o) => idOf(o) !== idOf(op)), op]);
}

async function run(supabase: SupabaseClient, op: Op) {
  if (op.op === "upsert") return supabase.from("meal_entries").upsert(op.row, { onConflict: "id" });
  return supabase.from("meal_entries").delete().eq("id", op.id);
}

/** Saves now if possible; if the server can't be reached, queues it. */
export async function saveMealOp(supabase: SupabaseClient, op: Op): Promise<{ queued?: boolean; error?: string }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    queue(op);
    return { queued: true };
  }
  const { error } = await run(supabase, op);
  if (!error) return {};
  if (isUnreachable(error)) {
    queue(op);
    return { queued: true };
  }
  return { error: error.message };
}

export function pendingMealCount() {
  return read().length;
}

/** Applies queued operations on top of meals loaded from the server (or the offline cache). */
export function withPendingMeals(meals: Meal[], clientId: string, date: string): { meals: Meal[]; pendingIds: Set<string> } {
  const byId = new Map(meals.map((m) => [m.id, m]));
  const pendingIds = new Set<string>();
  for (const op of read()) {
    if (op.op === "upsert") {
      if (op.row.client_id !== clientId) continue;
      if (op.row.entry_date === date) {
        byId.set(op.row.id, { ...(byId.get(op.row.id) ?? { updated_at: "" }), ...op.row } as Meal);
        pendingIds.add(op.row.id);
      } else byId.delete(op.row.id); // moved to another day
    } else if (op.client_id === clientId) byId.delete(op.id);
  }
  return { meals: [...byId.values()], pendingIds };
}

/** Replays queued operations in order. Stops at the first connection failure. Returns how many remain. */
export async function flushPendingMeals(supabase: SupabaseClient) {
  const ops = read();
  let i = 0;
  for (; i < ops.length; i++) {
    const { error } = await run(supabase, ops[i]);
    if (error && isUnreachable(error)) break;
    // Any other error (e.g. a validation rule) can't succeed on retry; drop it so the queue isn't stuck.
    if (error) console.warn("Dropping meal change the server rejected", error.message);
  }
  // Keep anything not yet sent, plus anything queued while we were flushing.
  const remaining = [...ops.slice(i), ...read().slice(ops.length)];
  write(remaining);
  return remaining.length;
}
