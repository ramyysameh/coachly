"use client";
import { useEffect, useState, type ReactNode } from "react";
import NumberFlow from "@number-flow/react";
import { CheckCircle2, Flame, Medal, Share2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { getActivePlan, SESSION_SELECT, sortSession, type Session } from "@/lib/data";
import { streak, type CalSession } from "@/lib/calendar";
import { PR_LABEL, prEvents, setsPerMuscle, type SetRow } from "@/lib/analytics";
import { MUSCLES } from "@/lib/muscles";
import { fmtMinutes, summaryStats, volumeComparison } from "@/lib/summary";
import { shareCard } from "@/lib/shareImage";
import { notify } from "@/lib/notify";
import MuscleMap, { type Tone } from "@/components/MuscleMap";
import { prValue } from "@/components/ProgressView";
import { Button, Skeleton } from "@/components/ui";
import { celebrate } from "@/components/Achievement";
import { addDays, errMsg, fmtDate, fromKg, type Unit } from "@/lib/utils";

/**
 * The screen after "Finish workout": what this session added up to, PRs, the muscles worked and a
 * shareable image. Everything is read from what's already stored; nothing new is saved.
 */
export default function WorkoutSummary({ clientId, sessionId, unit }: { clientId: string; sessionId: string; unit: Unit }) {
  const supabase = createClient();
  const [sharing, setSharing] = useState(false);

  const { data, loading } = useAsync(async () => {
    const session = sortSession(must(await supabase.from("workout_sessions").select(SESSION_SELECT).eq("id", sessionId).maybeSingle()) as Session | null);
    if (!session || session.status !== "completed") return null;
    const [count, plan, history, sessions] = await Promise.all([
      supabase.from("workout_sessions").select("id", { count: "exact", head: true })
        .eq("client_id", clientId).eq("status", "completed").lte("completed_at", session.completed_at!),
      getActivePlan(supabase, clientId).catch(() => null),
      supabase.rpc("completed_sets", { p_client: clientId, p_from: addDays(session.scheduled_date, -730), p_to: session.scheduled_date }),
      supabase.from("workout_sessions").select("id, scheduled_date, name, status, plan_day_id, started_at, completed_at")
        .eq("client_id", clientId).gte("scheduled_date", addDays(session.scheduled_date, -400)),
    ]);
    const rows = (history.error ? [] : history.data) as SetRow[];
    return {
      session,
      number: count.error ? null : count.count,
      streak: sessions.error ? 0 : streak(plan, sessions.data as CalSession[], session.scheduled_date),
      prs: prEvents(rows).filter((e) => e.session_id === sessionId),
      perMuscle: setsPerMuscle(rows.filter((r) => r.session_id === sessionId)),
    };
  }, [clientId, sessionId]);

  // One "workout complete" pop-up per finished session (not again on a reload of Today).
  useEffect(() => {
    if (!data) return;
    const key = `celebrated:${sessionId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch { /* storage blocked: still celebrate */ }
    const prs = new Set(data.prs.map((e) => e.key)).size;
    const lines = [
      data.number ? `Workout #${data.number}` : null,
      data.streak > 1 ? `${data.streak} planned sessions in a row` : null,
      prs ? `${prs} personal record${prs > 1 ? "s" : ""}` : null,
    ].filter((l): l is string => !!l);
    celebrate({ kind: data.streak >= 3 ? "streak" : "workout", title: "Workout done!", subtitle: data.session.name, lines });
  }, [data, sessionId]);

  if (loading) return <Skeleton className="h-72" />;
  // Not finished (or not found): the plain confirmation is enough.
  if (!data) {
    return (
      <p className="flex items-center gap-2 rounded-2xl border border-brand/20 bg-brand/10 p-3 text-sm font-medium text-brand-dark" role="status">
        <CheckCircle2 className="size-5" /> Workout saved. Nice work!
      </p>
    );
  }

  const { session, number, prs, perMuscle } = data;
  const stats = summaryStats(session);
  const volume = Math.round(fromKg(stats.volumeKg, unit) ?? 0);
  const comparison = volumeComparison(stats.volumeKg);
  // Muscles with at least 3 sets count as worked hard; anything less as touched.
  const tones = Object.fromEntries(MUSCLES.filter((m) => perMuscle[m] > 0).map((m) => [m, (perMuscle[m] >= 3 ? "primary" : "secondary") as Tone]));
  const prLines = prs.map((e) => `${e.label}: ${PR_LABEL[e.kind].toLowerCase()} ${prValue(e, unit)}`);

  async function share() {
    setSharing(true);
    try {
      const result = await shareCard({
        title: session.name,
        date: fmtDate(session.scheduled_date, { weekday: "short", month: "short", day: "numeric" }),
        workoutNumber: number,
        streak: data!.streak,
        stats: [
          { label: "Duration", value: fmtMinutes(stats.minutes) },
          { label: "Volume", value: volume ? `${volume.toLocaleString()} ${unit}` : "—" },
          { label: "Sets", value: String(stats.sets) },
          { label: "Exercises", value: String(stats.exercises) },
        ],
        comparison,
        prs: prLines,
      });
      if (result === "downloaded") notify.success("Image saved to your downloads");
    } catch (e) {
      notify.error(errMsg(e));
    } finally {
      setSharing(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-brand/25 bg-surface" aria-label="Workout summary" role="status">
      <div className="bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-brand)_14%,transparent),transparent)] p-4 pb-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-dark">
          <CheckCircle2 className="size-5" aria-hidden /> Workout saved{number ? ` · #${number}` : ""}
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">{session.name}</h2>
        {data.streak > 1 && (
          <p className="mt-1 flex items-center gap-1 text-sm text-muted">
            <Flame className="size-4 text-warn" aria-hidden /> {data.streak} planned workouts in a row
          </p>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-2 px-4">
        <Tile label="Duration">{fmtMinutes(stats.minutes)}</Tile>
        <Tile label={`Volume (${unit})`}>{volume ? <NumberFlow value={volume} /> : "—"}</Tile>
        <Tile label="Sets"><NumberFlow value={stats.sets} /></Tile>
        <Tile label="Exercises"><NumberFlow value={stats.exercises} /></Tile>
      </dl>
      {comparison && <p className="px-4 pt-3 text-sm">That&apos;s {comparison} in total.</p>}

      {prs.length > 0 && (
        <div className="mx-4 mt-3 rounded-xl border border-brand/25 bg-brand/8 p-3">
          <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-brand-dark">
            <Medal className="size-4" aria-hidden /> {prs.length} new personal record{prs.length > 1 ? "s" : ""}
          </p>
          <ul className="space-y-0.5 text-sm">
            {prs.map((e) => (
              <li key={`${e.key}-${e.kind}`}>
                <span className="font-medium">{e.label}</span>
                <span className="text-muted"> · {PR_LABEL[e.kind]} </span>
                <span className="font-mono tabular-nums">{prValue(e, unit)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {Object.keys(tones).length > 0 && (
        <div className="mt-3 flex items-center gap-3 px-4">
          <MuscleMap tones={tones} size="sm" view="both" />
          <p className="text-xs text-muted">Muscles worked. Darker means 3 or more sets.</p>
        </div>
      )}

      <div className="p-4">
        <Button variant="secondary" className="w-full" onClick={share} loading={sharing}>
          <Share2 className="size-4" aria-hidden /> Share summary
        </Button>
      </div>
    </section>
  );
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line px-3 py-2">
      <dt className="text-label font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="font-mono text-xl font-semibold tabular-nums">{children}</dd>
    </div>
  );
}
