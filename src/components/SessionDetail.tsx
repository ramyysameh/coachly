"use client";
import type { Session } from "@/lib/data";
import { SET_TYPE_TONE, setLabels, setTypeInfo } from "@/lib/setTypes";
import { cn, fmtWeight, type Unit } from "@/lib/utils";
import { fmtDuration, supersetRuns } from "@/lib/workout";

/** Read-only view of a logged session: targets as prescribed at the time + what was done. */
export default function SessionDetail({ session, unit }: { session: Session; unit: Unit }) {
  const exercises = session.session_exercises ?? [];
  const inSuperset = new Set(supersetRuns(exercises).filter((r) => r.superset).flatMap((r) => r.items.map((e) => e.id)));
  return (
    <div className="space-y-3">
      {session.notes && <p className="rounded-xl bg-paper p-3 text-sm"><span className="font-semibold">Client note:</span> {session.notes}</p>}
      {exercises.map((ex) => {
        const labels = setLabels(ex.session_sets);
        // Only show the RPE column when something was planned or logged for it.
        const showRpe = ex.target_rpe != null || ex.session_sets.some((s) => s.rpe != null);
        return (
          <div key={ex.id} className="rounded-xl border border-line">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 border-b border-line px-3 py-2">
              <p className="font-semibold">
                {ex.exercise_name}
                {inSuperset.has(ex.id) && <span className="ml-1.5 text-label font-semibold uppercase tracking-wide text-brand-dark">Superset</span>}
              </p>
              <p className="text-xs text-muted">
                Target {ex.target_sets} × {ex.rep_min}-{ex.rep_max}{ex.timed && "s"}
                {ex.target_rpe != null && ` @ RPE ${Number(ex.target_rpe)}`}
              </p>
            </div>
            {(ex.original_exercise_name || ex.added_mid_workout) && (
              <p className="border-b border-line px-3 py-1.5 text-xs text-warn">
                {ex.original_exercise_name ? `Client swapped this in for ${ex.original_exercise_name}` : "Client added this during the workout"}
              </p>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-label uppercase tracking-wide text-muted">
                  <th className="px-3 py-1 font-semibold">Set</th>
                  <th className="px-3 py-1 font-semibold">Weight</th>
                  <th className="px-3 py-1 font-semibold">{ex.timed ? "Time" : "Reps"}</th>
                  {showRpe && <th className="px-3 py-1 font-semibold">RPE</th>}
                  <th className="px-3 py-1 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {ex.session_sets.map((s, i) => (
                  <tr key={s.id} className="border-t border-line/60 tabular-nums">
                    <td className={cn("px-3 py-1.5", s.set_type !== "normal" && cn("font-semibold", SET_TYPE_TONE[s.set_type]))}
                      title={s.set_type !== "normal" ? setTypeInfo(s.set_type).label : undefined}>
                      {labels[i]}
                    </td>
                    <td className="px-3 py-1.5">{s.weight_kg != null ? fmtWeight(s.weight_kg, unit) : ex.is_bodyweight ? "Bodyweight" : "-"}</td>
                    <td className="px-3 py-1.5">{ex.timed ? fmtDuration(s.duration_s) : (s.reps ?? "-")}</td>
                    {showRpe && <td className="px-3 py-1.5">{s.rpe != null ? Number(s.rpe) : "-"}</td>}
                    <td className="px-3 py-1.5">{s.completed ? <span className="text-brand-dark">✓ Done</span> : <span className="text-muted">Not done</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ex.client_notes && <p className="border-t border-line px-3 py-2 text-xs"><span className="font-semibold">Note:</span> {ex.client_notes}</p>}
          </div>
        );
      })}
      {exercises.length === 0 && <p className="text-sm text-muted">No exercises in this session.</p>}
    </div>
  );
}
