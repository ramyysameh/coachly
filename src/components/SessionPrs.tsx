"use client";
import { Medal } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { PR_LABEL, prEvents, type PrEvent, type SetRow } from "@/lib/analytics";
import { addDays, fromKg, type Unit } from "@/lib/utils";

/**
 * PRs hit in one session, worked out against everything logged up to and including that day.
 * Renders nothing when the session set no records.
 */
export default function SessionPrs({ clientId, sessionId, date, unit, celebrate }: {
  clientId: string; sessionId: string; date: string; unit: Unit; celebrate?: boolean;
}) {
  const supabase = createClient();
  const { data } = useAsync(async () => {
    const rows = must(await supabase.rpc("completed_sets", { p_client: clientId, p_from: addDays(date, -730), p_to: date })) as SetRow[];
    return prEvents(rows).filter((e) => e.session_id === sessionId);
  }, [clientId, sessionId, date]);

  if (!data?.length) return null;
  // One line per exercise, listing each record it beat
  const byExercise = new Map<string, PrEvent[]>();
  data.forEach((e) => byExercise.set(e.key, [...(byExercise.get(e.key) ?? []), e]));
  const n = byExercise.size;
  return (
    <div className="rounded-2xl border border-brand/25 bg-brand/8 p-3" role="status">
      <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-brand-dark">
        <Medal className="size-4" aria-hidden />
        {celebrate ? "New PR! " : ""}{n} exercise{n > 1 ? "s" : ""} with a personal record
      </p>
      <ul className="space-y-1.5 text-sm">
        {[...byExercise.values()].map((events) => (
          <li key={events[0].key}>
            <span className="font-medium">{events[0].label}</span>
            {events.map((e) => (
              <span key={e.kind} className="block pl-3 text-muted">
                {PR_LABEL[e.kind]}: <span className="font-mono text-ink tabular-nums">{fmt(e.kind, e.kind === "e1rm" ? e.value : e.weight, e.reps, unit)}</span>
                <span className="text-xs"> (was {e.kind === "reps" ? `${e.previous} reps` : `${fromKg(e.previous, unit)} ${unit}`})</span>
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

function fmt(kind: PrEvent["kind"], kg: number | null, reps: number | null, unit: Unit) {
  if (kind === "reps") return `${reps} reps`;
  if (kind === "weight") return `${fromKg(kg, unit)} ${unit} × ${reps}`;
  return `${fromKg(kg, unit)} ${unit}`;
}
