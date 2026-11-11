"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionSet } from "./data";

// Set edits are written here before the network request, so a set logged just before
// the app is closed (or while offline) is sent the next time the workout opens.

type Patch = Partial<Pick<SessionSet, "weight_kg" | "reps" | "completed">>;
type Entry = { sessionId: string; patch: Patch };
const KEY = "coachly:pending-sets";

function read(): Record<string, Entry> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function write(all: Record<string, Entry>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage full or disabled — the network write still runs */
  }
}

export function queueSetPatch(setId: string, sessionId: string, patch: Patch) {
  const all = read();
  all[setId] = { sessionId, patch: { ...all[setId]?.patch, ...patch } };
  write(all);
}

export function clearSetPatch(setId: string, sent: Patch) {
  const all = read();
  const e = all[setId];
  if (!e) return;
  // only clear if nothing newer was queued while this request was in flight
  if (Object.entries(e.patch).every(([k, v]) => sent[k as keyof Patch] === v)) {
    delete all[setId];
    write(all);
  }
}

/** Sends any queued edits for a session. Returns how many could not be sent. */
export async function flushPendingSets(supabase: SupabaseClient, sessionId: string) {
  const all = read();
  let failed = 0;
  for (const [setId, e] of Object.entries(all)) {
    if (e.sessionId !== sessionId) continue;
    const { error } = await supabase.from("session_sets").update(e.patch).eq("id", setId);
    if (error) failed++;
    else clearSetPatch(setId, e.patch);
  }
  return failed;
}
