"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarCheck, CheckCircle2, ChevronRight, Coffee, Play, RotateCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { getActivePlan, mealTotals, scheduledDay, type Meal, type Session, type Targets } from "@/lib/data";
import { useProfile } from "@/components/AppShell";
import { Button, Card, Empty, ErrorBox, Meter, PageHeader, Skeleton } from "@/components/ui";
import { WeekGlance } from "@/components/TrainingCalendar";
import SessionPrs from "@/components/SessionPrs";
import { addDays, errMsg, fmtDate, fmtRest, localDate, WEEKDAYS } from "@/lib/utils";
import { isUnreachable } from "@/lib/supabase/authState";

function TodayInner() {
  const supabase = createClient();
  const router = useRouter();
  const search = useSearchParams();
  const justFinished = search.get("done") === "1";
  const finishedSession = search.get("session");
  const { profile } = useProfile();
  const today = localDate();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const [plan, sessions, meals, targets, coach] = await Promise.all([
      getActivePlan(supabase, profile.id),
      supabase.from("workout_sessions").select("*").eq("client_id", profile.id).or(`scheduled_date.eq.${today},status.eq.in_progress`).order("started_at", { ascending: false }),
      supabase.from("meal_entries").select("*").eq("client_id", profile.id).eq("entry_date", today),
      supabase.from("nutrition_targets").select("*").eq("client_id", profile.id).maybeSingle(),
      supabase.from("coach_clients").select("status, profiles!coach_clients_coach_id_fkey(full_name)").eq("client_id", profile.id).eq("status", "active").maybeSingle(),
    ]);
    return {
      plan,
      sessions: must(sessions) as Session[],
      meals: must(meals) as Meal[],
      targets: must(targets) as Targets | null,
      coachName: (must(coach) as { profiles: { full_name: string } } | null)?.profiles?.full_name ?? null,
    };
  }, [profile.id, today]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-56" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (error || !data) return <ErrorBox message={error ?? "Couldn't load today"} onRetry={reload} />;

  const day = scheduledDay(data.plan, today);
  const todaySession = day ? data.sessions.find((s) => s.plan_day_id === day.id && s.scheduled_date === today) : undefined;
  const unfinished = data.sessions.filter((s) => s.status === "in_progress" && s.id !== todaySession?.id);
  const totals = mealTotals(data.meals);

  // Next scheduled workout after a rest day.
  let next: { date: string; name: string } | null = null;
  if (!day && data.plan) {
    for (let i = 1; i <= 7; i++) {
      const d = addDays(today, i);
      const nd = scheduledDay(data.plan, d);
      if (nd) { next = { date: d, name: nd.name }; break; }
    }
  }

  async function start() {
    if (!day) return;
    setStarting(true);
    setStartError(null);
    const { data: sid, error } = await supabase.rpc("start_session", { p_plan_day: day.id, p_date: today });
    if (error) {
      setStarting(false);
      return setStartError(
        isUnreachable(error) || !navigator.onLine
          ? "You're offline. Starting a new workout needs a connection, so try again once you have signal. Workouts you've already started can still be logged offline."
          : errMsg(error),
      );
    }
    router.push(`/training/session/${sid}`);
  }

  return (
    <div className="stagger space-y-4">
      <PageHeader
        title={`Hi, ${profile.full_name.split(" ")[0] || "there"}`}
        subtitle={fmtDate(today, { weekday: "long", month: "long", day: "numeric" })}
      />

      {justFinished && (
        <p className="flex items-center gap-2 rounded-2xl border border-brand/20 bg-brand/10 p-3 text-sm font-medium text-brand-dark" role="status">
          <CheckCircle2 className="size-5" /> Workout saved. Nice work!
        </p>
      )}
      {justFinished && finishedSession && (
        <SessionPrs clientId={profile.id} sessionId={finishedSession} date={today} unit={profile.weight_unit} celebrate />
      )}

      {unfinished.map((s) => (
        <Link key={s.id} href={`/training/session/${s.id}`} className="flex min-h-14 items-center gap-3 rounded-2xl border border-warn-line bg-warn-bg p-3 text-warn transition-transform duration-150 active:scale-[0.99]">
          <RotateCw className="size-5 shrink-0" />
          <span className="flex-1 text-sm">
            <span className="font-semibold">Unfinished: {s.name}</span> from {fmtDate(s.scheduled_date)}
          </span>
          <ChevronRight className="size-5" />
        </Link>
      ))}

      {/* Scheduled workout */}
      {!data.plan ? (
        <Empty icon={<CalendarCheck className="size-8" />} title="No training plan yet">
          {data.coachName ? `${data.coachName} hasn't assigned a plan yet. Check back soon or message them in Chat.` : "Accept an invite from your coach to get a plan."}
        </Empty>
      ) : !day ? (
        <Card className="flex items-start gap-3">
          <Coffee className="mt-0.5 size-6 text-muted" />
          <div>
            <p className="font-semibold">Rest day</p>
            <p className="text-sm text-muted">
              {data.plan.start_date && today < data.plan.start_date
                ? `Your plan "${data.plan.name}" starts ${fmtDate(data.plan.start_date)}.`
                : next ? `Next up: ${next.name} on ${fmtDate(next.date)}.` : "Nothing scheduled today."}
            </p>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-line bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-brand)_8%,transparent),transparent)] p-5 pb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-dark">Today&apos;s workout</p>
            <h2 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">{day.name}</h2>
            <p className="mt-1 text-sm text-muted">
              {data.plan.name} · {day.plan_exercises.length} exercises, {day.plan_exercises.reduce((n, e) => n + e.target_sets, 0)} sets
            </p>
          </div>
          <ul className="divide-y divide-line">
            {day.plan_exercises.map((pe, i) => (
              <li key={pe.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <span className="w-5 shrink-0 font-mono text-xs text-muted tabular-nums">{i + 1}</span>
                <span className="flex-1 font-medium">{pe.exercises.name}</span>
                <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
                  {pe.target_sets} × {pe.rep_min === pe.rep_max ? pe.rep_min : `${pe.rep_min}-${pe.rep_max}`} · {fmtRest(pe.rest_seconds)}
                </span>
              </li>
            ))}
          </ul>
          <div className="border-t border-line p-4">
            {startError && <div className="mb-2"><ErrorBox message={startError} /></div>}
            {todaySession?.status === "completed" ? (
              <div className="space-y-2">
                <p className="flex items-center gap-2 font-semibold text-brand-dark"><CheckCircle2 className="size-5" /> Completed</p>
                <Button variant="secondary" className="w-full" onClick={() => router.push(`/training/session/${todaySession.id}`)}>View or edit log</Button>
              </div>
            ) : todaySession ? (
              <Button size="lg" className="w-full" onClick={() => router.push(`/training/session/${todaySession.id}`)}>
                <RotateCw className="size-5" /> Resume workout
              </Button>
            ) : (
              <Button size="lg" className="w-full" onClick={start} loading={starting} disabled={day.plan_exercises.length === 0}>
                <Play className="size-5" fill="currentColor" /> Start Workout
              </Button>
            )}
          </div>
        </Card>
      )}

      <WeekGlance clientId={profile.id} unit={profile.weight_unit} plan={data.plan} />

      {/* Nutrition */}
      <Link href="/nutrition" className="block">
        <Card className="space-y-4 transition-[border-color,transform] duration-150 hover:border-brand/40 active:scale-[0.99]">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold tracking-tight">Nutrition today</h2>
            <ChevronRight className="size-5 text-muted" />
          </div>
          <Meter label="Calories" value={totals.calories} target={data.targets?.calories} unit="kcal" />
          <div className="grid grid-cols-3 gap-3">
            <Meter label="Protein" value={totals.protein_g} target={data.targets?.protein_g} unit="g" />
            <Meter label="Carbs" value={totals.carbs_g} target={data.targets?.carbs_g} unit="g" />
            <Meter label="Fat" value={totals.fat_g} target={data.targets?.fat_g} unit="g" />
          </div>
          {data.meals.length === 0 && <p className="text-sm text-muted">No meals logged yet today. Tap to add one.</p>}
        </Card>
      </Link>

      {data.plan && (
        <p className="px-4 text-center text-xs leading-relaxed text-muted">
          Schedule: {data.plan.plan_days.map((d) => `${d.name} (${d.weekdays.map((w) => WEEKDAYS[w - 1]).join("/") || "unscheduled"})`).join(" · ")}
        </p>
      )}
    </div>
  );
}

export default function TodayPage() {
  return (
    <Suspense>
      <TodayInner />
    </Suspense>
  );
}
