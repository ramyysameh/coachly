"use client";
import type { Session } from "@/lib/data";
import { fmtWeight, type Unit } from "@/lib/utils";

/** Read-only view of a logged session: targets as prescribed at the time + what was done. */
export default function SessionDetail({ session, unit }: { session: Session; unit: Unit }) {
  const exercises = session.session_exercises ?? [];
  return (
    <div className="space-y-3">
      {session.notes && <p className="rounded-xl bg-paper p-3 text-sm"><span className="font-semibold">Client note:</span> {session.notes}</p>}
      {exercises.map((ex) => (
        <div key={ex.id} className="rounded-xl border border-line">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 border-b border-line px-3 py-2">
            <p className="font-semibold">{ex.exercise_name}</p>
            <p className="text-xs text-muted">
              Target {ex.target_sets} × {ex.rep_min}-{ex.rep_max}
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-3 py-1 font-semibold">Set</th>
                <th className="px-3 py-1 font-semibold">Weight</th>
                <th className="px-3 py-1 font-semibold">Reps</th>
                <th className="px-3 py-1 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {ex.session_sets.map((s) => (
                <tr key={s.id} className="border-t border-line/60 tabular-nums">
                  <td className="px-3 py-1.5">{s.set_number}</td>
                  <td className="px-3 py-1.5">{s.weight_kg != null ? fmtWeight(s.weight_kg, unit) : ex.is_bodyweight ? "Bodyweight" : "-"}</td>
                  <td className="px-3 py-1.5">{s.reps ?? "-"}</td>
                  <td className="px-3 py-1.5">{s.completed ? <span className="text-brand-dark">✓ Done</span> : <span className="text-muted">Not done</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ex.client_notes && <p className="border-t border-line px-3 py-2 text-xs"><span className="font-semibold">Note:</span> {ex.client_notes}</p>}
        </div>
      ))}
      {exercises.length === 0 && <p className="text-sm text-muted">No exercises in this session.</p>}
    </div>
  );
}
