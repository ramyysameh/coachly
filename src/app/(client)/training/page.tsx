"use client";
import Link from "next/link";
import { useState } from "react";
import { BookOpen, ChevronRight, ClipboardList, History } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { getActivePlan, type Session } from "@/lib/data";
import { useProfile } from "@/components/AppShell";
import { Badge, Card, Empty, ErrorBox, LinkButton, PageHeader, Spinner, Tabs } from "@/components/ui";
import { fmtDate, fmtRest, WEEKDAYS } from "@/lib/utils";

type SessionRow = Session & { session_exercises: { session_sets: { completed: boolean }[] }[] };

export default function TrainingPage() {
  const supabase = createClient();
  const { profile } = useProfile();
  const [tab, setTab] = useState<"plan" | "history">("plan");

  const { data, loading, error, reload } = useAsync(async () => {
    const [plan, sessions] = await Promise.all([
      getActivePlan(supabase, profile.id),
      supabase
        .from("workout_sessions")
        .select("*, session_exercises(session_sets(completed))")
        .eq("client_id", profile.id)
        .order("scheduled_date", { ascending: false })
        .order("started_at", { ascending: false })
        .limit(100),
    ]);
    return { plan, sessions: must(sessions) as SessionRow[] };
  }, [profile.id]);

  return (
    <div className="space-y-4">
      <PageHeader title="Training" action={<LinkButton href="/library" variant="secondary"><BookOpen className="size-4" /> Library</LinkButton>} />
      <Tabs value={tab} onChange={setTab} options={[{ value: "plan", label: "My plan" }, { value: "history", label: "History" }]} />
      {loading ? (
        <Spinner />
      ) : error || !data ? (
        <ErrorBox message={error ?? "Couldn't load training"} onRetry={reload} />
      ) : tab === "plan" ? (
        !data.plan ? (
          <Empty icon={<ClipboardList className="size-8" />} title="No plan assigned">Your coach will assign a training split here.</Empty>
        ) : (
          <div className="space-y-3">
            <Card>
              <p className="text-lg font-semibold">{data.plan.name}</p>
              {data.plan.description && <p className="text-sm text-muted">{data.plan.description}</p>}
              <p className="mt-1 text-xs text-muted">Started {fmtDate(data.plan.start_date!)}</p>
            </Card>
            {data.plan.plan_days.map((d) => (
              <Card key={d.id} className="p-0">
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <h2 className="font-semibold">{d.name}</h2>
                  <span className="text-xs font-semibold text-muted">{d.weekdays.map((w) => WEEKDAYS[w - 1]).join(" · ") || "Unscheduled"}</span>
                </div>
                <ul className="divide-y divide-line">
                  {d.plan_exercises.map((pe) => (
                    <li key={pe.id} className="px-4 py-2.5 text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">{pe.exercises.name}</span>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                          {pe.target_sets} × {pe.rep_min}-{pe.rep_max} · {fmtRest(pe.rest_seconds)}
                        </span>
                      </div>
                      {pe.notes && <p className="text-xs text-brand-dark">{pe.notes}</p>}
                    </li>
                  ))}
                  {d.plan_exercises.length === 0 && <li className="px-4 py-3 text-sm text-muted">No exercises yet.</li>}
                </ul>
              </Card>
            ))}
          </div>
        )
      ) : data.sessions.length === 0 ? (
        <Empty icon={<History className="size-8" />} title="No workouts logged yet">Start today&apos;s workout from the Today tab.</Empty>
      ) : (
        <ul className="space-y-2">
          {data.sessions.map((s) => {
            const sets = s.session_exercises.flatMap((e) => e.session_sets);
            return (
              <li key={s.id}>
                <Link href={`/training/session/${s.id}`} className="flex min-h-16 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
                  <div className="flex-1">
                    <p className="font-semibold">{s.name}</p>
                    <p className="text-xs text-muted">{fmtDate(s.scheduled_date)} · {sets.filter((x) => x.completed).length}/{sets.length} sets</p>
                  </div>
                  {s.status === "completed" ? <Badge tone="brand">Done</Badge> : <Badge tone="warn">In progress</Badge>}
                  <ChevronRight className="size-5 text-muted" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
