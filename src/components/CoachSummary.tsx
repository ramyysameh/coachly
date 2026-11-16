"use client";
import { AlertTriangle, CalendarCheck, ChevronRight, Clock, Dumbbell, Medal, Scale, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { rpcAll } from "@/lib/rpcAll";
import { getActivePlan } from "@/lib/data";
import type { CalSession } from "@/lib/calendar";
import { PR_LABEL, type SetRow } from "@/lib/analytics";
import { ago, clientStats, consistencyTone, type StatsProfile } from "@/lib/clientStats";
import { Card, ErrorBox, Skeleton } from "@/components/ui";
import { addDays, cn, fmtDate, fromKg, localDate, type Unit } from "@/lib/utils";

const TONE = { good: "text-emerald-400", ok: "text-warn", low: "text-brand-dark", none: "text-muted" } as const;

/**
 * The coach's first look at a client: six numbers that answer "are they showing up and
 * progressing?", anything that needs attention, and their latest PRs.
 */
export default function CoachSummary({ clientId, unit, onOpen }: { clientId: string; unit: Unit; onOpen: (tab: "training" | "progress") => void }) {
  const supabase = createClient();
  const today = localDate();
  const { data, loading, error, reload } = useAsync(async () => {
    const [p, plan, sessions, sets, weights] = await Promise.all([
      supabase.from("profiles").select("id, date_of_birth, goal_type, weight_unit, training_days_per_week").eq("id", clientId).maybeSingle(),
      getActivePlan(supabase, clientId).catch(() => null),
      supabase.from("workout_sessions").select("id, scheduled_date, name, status, plan_day_id, started_at, completed_at")
        .eq("client_id", clientId).gte("scheduled_date", addDays(today, -91)).order("scheduled_date"),
      rpcAll(supabase, "completed_sets", { p_client: clientId, p_from: addDays(today, -365), p_to: today }),
      supabase.from("body_weights").select("entry_date, weight_kg").eq("client_id", clientId).gte("entry_date", addDays(today, -120)),
    ]);
    return clientStats({
      // A former coach can't read the profile any more: summarise without its details.
      profile: (must(p) as StatsProfile | null) ?? ({ id: clientId, date_of_birth: null, goal_type: null, weight_unit: unit, training_days_per_week: null } as StatsProfile),
      plan,
      sessions: must(sessions) as CalSession[],
      sets: must(sets) as SetRow[],
      weights: must(weights) as { entry_date: string; weight_kg: number }[],
    }, today);
  }, [clientId, today, unit]);

  if (loading) return <Skeleton className="h-56" />;
  if (error || !data) return <ErrorBox message={error ?? "Couldn't load summary"} onRetry={reload} />;
  const s = data;
  const tone = consistencyTone(s.consistency);
  const change = s.weight?.change != null ? fromKg(s.weight.change, unit) ?? 0 : null;
  const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "±");
  // one line per exercise per session, newest first
  const prs = [...new Map(s.recentPrs.map((e) => [`${e.session_id}|${e.key}`, e])).values()].slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Kpi icon={<CalendarCheck className="size-4" />} label="Consistency (4 wks)" value={s.consistency !== null ? `${s.consistency}%` : "—"}
          valueClass={TONE[tone]} sub={s.consistency === null ? "No plan or weekly target" : `${s.sessions28} workouts in 28 days`} />
        <Kpi icon={<Dumbbell className="size-4" />} label="This week" value={s.week.target ? `${s.week.done} / ${s.week.target}` : String(s.week.done)}
          sub={s.streak > 1 ? `${s.streak} planned sessions in a row` : "workouts in the last 7 days"} />
        <Kpi icon={<Clock className="size-4" />} label="Last workout" value={ago(s.lastWorkout, today) ?? "None yet"}
          sub={s.lastWorkout ? fmtDate(s.lastWorkout.slice(0, 10)) : undefined} />
        <Kpi icon={<Medal className="size-4" />} label="PRs (30 days)" value={String(s.prs30)} valueClass={s.prs30 ? "text-brand-dark" : undefined}
          sub={s.prs30 ? "personal records" : "no new records"} />
        <Kpi icon={<Scale className="size-4" />} label="Bodyweight" value={s.weight ? `${fromKg(s.weight.latest, unit)} ${unit}` : "—"}
          sub={change !== null ? `${sign(change)}${Math.abs(change)} ${unit} in 30 days` : s.weight ? `on ${fmtDate(s.weight.date)}` : "no weigh-ins"} />
        <Kpi icon={<TrendingUp className="size-4" />} label="Volume (4 wks)" value={`${Math.round(fromKg(s.volume28Kg, unit) ?? 0).toLocaleString()} ${unit}`}
          sub={s.avgMinutes ? `avg ${Math.round(s.avgMinutes)} min / session` : undefined} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-2">
          <h2 className="flex items-center gap-2 font-semibold tracking-tight">
            <AlertTriangle className={cn("size-4", s.flags.length ? "text-warn" : "text-muted")} aria-hidden /> Needs attention
          </h2>
          {s.flags.length === 0 ? (
            <p className="text-sm text-muted">All good. Nothing flagged.</p>
          ) : (
            <ul className="space-y-1.5">
              {s.flags.map((f) => (
                <li key={f.kind + f.title}>
                  <button onClick={() => onOpen(f.tab === "overview" ? "training" : "progress")}
                    className="flex w-full items-center gap-2 rounded-xl border border-warn-line bg-warn-bg px-3 py-2 text-left text-sm hover:brightness-110">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-warn">{f.title}</span>
                      <span className="block text-xs text-muted">{f.detail}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-2">
          <h2 className="flex items-center gap-2 font-semibold tracking-tight"><Medal className="size-4 text-brand-dark" aria-hidden /> Recent PRs</h2>
          {prs.length === 0 ? (
            <p className="text-sm text-muted">No personal records in the last 30 days.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {prs.map((e) => (
                <li key={`${e.session_id}|${e.key}`} className="flex items-baseline gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate"><span className="font-medium">{e.label}</span> <span className="text-xs text-muted">{PR_LABEL[e.kind]}</span></span>
                  <span className="font-mono font-semibold tabular-nums">{e.kind === "reps" ? `${e.reps} reps` : `${fromKg(e.kind === "e1rm" ? e.value : e.weight, unit)} ${unit}`}</span>
                  <span className="w-16 text-right text-xs text-muted">{ago(e.date, today)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub, valueClass }: { icon: React.ReactNode; label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="panel rounded-2xl border border-line px-3 py-3 shadow-card">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted">{icon}{label}</p>
      <p className={cn("mt-0.5 font-display text-2xl font-bold tabular-nums", valueClass)}>{value}</p>
      {sub && <p className="truncate text-xs text-muted">{sub}</p>}
    </div>
  );
}
