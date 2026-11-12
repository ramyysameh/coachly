"use client";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Flame } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { getActivePlan, SESSION_SELECT, sortSession, type Plan, type Session } from "@/lib/data";
import { adherence, buildDays, monthGrid, streak, TYPE_STYLE, weekDates, type CalDay, type CalSession, type SessionType } from "@/lib/calendar";
import { Sheet } from "@/components/ExerciseLibrary";
import SessionDetail from "@/components/SessionDetail";
import SessionPrs from "@/components/SessionPrs";
import { Card, ErrorBox, Skeleton, Spinner } from "@/components/ui";
import { addDays, cn, fmtDate, fmtWeight, localDate, WEEKDAYS, type Unit } from "@/lib/utils";

const SESSION_COLS = "id, scheduled_date, name, status, plan_day_id, started_at, completed_at";

/** Active plan + a year of sessions (enough for the streak and any month the user pages to). */
function useCalendarData(clientId: string) {
  const supabase = createClient();
  return useAsync(async () => {
    const today = localDate();
    const [plan, sessions] = await Promise.all([
      getActivePlan(supabase, clientId),
      supabase.from("workout_sessions").select(SESSION_COLS).eq("client_id", clientId)
        .gte("scheduled_date", addDays(today, -400)).lte("scheduled_date", addDays(today, 60)).order("scheduled_date"),
    ]);
    return { plan, sessions: must(sessions) as CalSession[] };
  }, [clientId]);
}

function DayMark({ day, size = "md" }: { day: CalDay; size?: "md" | "lg" }) {
  const base = size === "lg" ? "size-3" : "size-2.5";
  switch (day.status) {
    case "trained":
      return <span className={cn(base, "rounded-full", TYPE_STYLE[day.type ?? "other"].dot)} />;
    case "missed":
      return <span className={cn(base, "rounded-full border-2 border-danger")} />;
    case "rest":
      return <span className={cn(base, "rounded-full border-2 border-muted/40")} />;
    case "upcoming":
    case "today-planned":
      return <span className={cn(base, "rounded-full opacity-35", TYPE_STYLE[day.type ?? "other"].dot)} />;
    default:
      return <span className={base} />;
  }
}

const STATUS_TEXT: Record<CalDay["status"], string> = {
  trained: "Trained", rest: "Rest day", missed: "Missed", upcoming: "Planned", "today-planned": "Planned for today", none: "Nothing planned",
};

export default function TrainingCalendar({ clientId, unit }: { clientId: string; unit: Unit }) {
  const { data, loading, error, reload } = useCalendarData(clientId);
  const today = localDate();
  const [month, setMonth] = useState(today.slice(0, 8) + "01");
  const [open, setOpen] = useState<CalDay | null>(null);

  const cells = useMemo(() => monthGrid(month), [month]);
  const days = useMemo(
    () => (data ? buildDays(cells.filter(Boolean) as string[], data.plan, data.sessions, today) : []),
    [cells, data, today],
  );

  if (loading) return <Skeleton className="h-96" />;
  if (error || !data) return <ErrorBox message={error ?? "Couldn't load the calendar"} onRetry={reload} />;

  const byDate = new Map(days.map((d) => [d.date, d]));
  const adh = adherence(days, today);
  const trainedThisMonth = days.filter((d) => d.status === "trained").length;
  const plannedThisMonth = days.filter((d) => d.planned).length;
  const typesSeen = [...new Set(days.filter((d) => d.status === "trained" || d.planned).map((d) => d.type).filter(Boolean))] as SessionType[];
  const shift = (n: number) => {
    const d = new Date(month + "T12:00:00");
    d.setMonth(d.getMonth() + n);
    setMonth(localDate(d).slice(0, 8) + "01");
  };

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 font-semibold">{fmtDate(month, { month: "long", year: "numeric" })}</h2>
        {month !== today.slice(0, 8) + "01" && (
          <button onClick={() => setMonth(today.slice(0, 8) + "01")} className="min-h-9 rounded-lg px-2 text-sm font-semibold text-brand hover:bg-surface-2">Today</button>
        )}
        <button onClick={() => shift(-1)} aria-label="Previous month" className="flex size-10 items-center justify-center rounded-lg hover:bg-surface-2"><ChevronLeft className="size-5" /></button>
        <button onClick={() => shift(1)} aria-label="Next month" className="flex size-10 items-center justify-center rounded-lg hover:bg-surface-2"><ChevronRight className="size-5" /></button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label="Training calendar">
        {WEEKDAYS.map((w) => <div key={w} className="pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{w.slice(0, 1)}<span className="max-sm:hidden">{w.slice(1)}</span></div>)}
        {cells.map((date, i) => {
          if (!date) return <div key={`b${i}`} />;
          const day = byDate.get(date)!;
          const isToday = date === today;
          return (
            <button
              key={date}
              onClick={() => setOpen(day)}
              aria-label={`${fmtDate(date, { weekday: "long", month: "long", day: "numeric" })}: ${STATUS_TEXT[day.status]}${day.planned ? ` (${day.planned})` : ""}`}
              className={cn(
                "flex aspect-square min-h-11 flex-col sm:aspect-auto sm:h-14 items-center justify-center gap-1 rounded-xl text-sm tabular-nums hover:bg-surface-2",
                isToday && "ring-2 ring-brand",
                date > today && "text-muted",
              )}
            >
              <span className={cn(isToday && "font-semibold text-brand-dark")}>{Number(date.slice(8))}</span>
              <DayMark day={day} />
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat icon={<Flame className="size-4 text-orange-500" aria-hidden />} label="Current streak" value={`${streak(data.plan, data.sessions, today)}`} sub="planned sessions in a row" />
        <Stat label="This month" value={`${trainedThisMonth}/${plannedThisMonth}`} sub="sessions done / planned" />
        <Stat label="Adherence" value={adh.pct === null ? "—" : `${adh.pct}%`} sub={adh.planned ? `${adh.hit} of ${adh.planned} planned so far` : "nothing planned yet"} />
      </div>

      <Legend types={typesSeen} />
      {!data.plan && <p className="text-sm text-muted">No active plan, so rest and missed days can&apos;t be shown yet. Logged workouts still appear.</p>}

      {open && <DaySheet day={open} unit={unit} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function Stat({ icon, label, value, sub }: { icon?: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2">
      <p className="flex items-center gap-1 text-xs font-medium text-muted">{icon}{label}</p>
      <p className="font-mono text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] leading-tight text-muted">{sub}</p>
    </div>
  );
}

function Legend({ types }: { types: SessionType[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted" aria-label="Legend">
      {types.map((t) => <li key={t} className="flex items-center gap-1.5"><span className={cn("size-2.5 rounded-full", TYPE_STYLE[t].dot)} />{TYPE_STYLE[t].label}</li>)}
      <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-muted/40" />Rest</li>
      <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-danger" />Missed</li>
      <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-slate-500 opacity-35" />Planned</li>
      <li className="flex items-center gap-1.5"><span className="size-3 rounded-full ring-2 ring-brand" />Today</li>
    </ul>
  );
}

/** Tap a day: what was planned, and a summary + full log of each session. */
function DaySheet({ day, unit, onClose }: { day: CalDay; unit: Unit; onClose: () => void }) {
  const supabase = createClient();
  const ids = day.sessions.map((s) => s.id);
  const { data, loading, error } = useAsync(async () => {
    if (!ids.length) return [] as Session[];
    const rows = must(await supabase.from("workout_sessions").select(SESSION_SELECT).in("id", ids)) as Session[];
    return rows.map(sortSession);
  }, [ids.join(",")]);

  return (
    <Sheet title={fmtDate(day.date, { weekday: "long", month: "long", day: "numeric" })} onClose={onClose}>
      <div className="space-y-4">
        <p className="flex items-center gap-2 text-sm">
          <DayMark day={day} size="lg" />
          <span className="font-semibold">{STATUS_TEXT[day.status]}</span>
          {day.planned && <span className="text-muted">· plan: {day.planned}</span>}
        </p>
        {loading ? <Spinner /> : error ? <ErrorBox message={error} /> : (data ?? []).map((s) => <SessionSummary key={s.id} s={s} unit={unit} />)}
        {!loading && ids.length === 0 && (
          <p className="text-sm text-muted">
            {day.status === "missed" ? "No workout was logged on this planned day." : day.status === "rest" ? "Scheduled rest day." : day.planned ? "Not logged yet." : "No workout logged."}
          </p>
        )}
      </div>
    </Sheet>
  );
}

function SessionSummary({ s, unit }: { s: Session; unit: Unit }) {
  const sets = (s.session_exercises ?? []).flatMap((e) => e.session_sets.filter((x) => x.completed));
  const volume = sets.reduce((t, x) => t + Number(x.weight_kg ?? 0) * Number(x.reps ?? 0), 0);
  const mins = s.completed_at ? Math.round((new Date(s.completed_at).getTime() - new Date(s.started_at).getTime()) / 60000) : null;
  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-semibold">{s.name} {s.status !== "completed" && <span className="text-xs font-normal text-muted">(in progress)</span>}</h3>
        <dl className="mt-2 grid grid-cols-4 gap-2 text-center">
          <Mini label="Exercises" value={String(s.session_exercises?.length ?? 0)} />
          <Mini label="Sets done" value={String(sets.length)} />
          <Mini label="Volume" value={volume ? fmtWeight(volume, unit).replace(/\.\d+/, "") : "—"} />
          <Mini label="Duration" value={mins !== null && mins > 0 && mins < 600 ? `${mins} min` : "—"} />
        </dl>
      </div>
      {s.status === "completed" && <SessionPrs clientId={s.client_id} sessionId={s.id} date={s.scheduled_date} unit={unit} />}
      <SessionDetail session={s} unit={unit} />
    </section>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-1 py-2">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** "This week at a glance": Mon–Sun strip with status marks and done / planned count. */
export function WeekGlance({ clientId, unit, plan: planProp }: { clientId: string; unit: Unit; plan?: Plan | null }) {
  const { data, loading, error, reload } = useCalendarData(clientId);
  const [open, setOpen] = useState<CalDay | null>(null);
  const today = localDate();
  if (loading) return <Skeleton className="h-28" />;
  if (error || !data) return <ErrorBox message={error ?? "Couldn't load this week"} onRetry={reload} />;
  const days = buildDays(weekDates(today), planProp !== undefined ? planProp : data.plan, data.sessions, today);
  const done = days.filter((d) => d.status === "trained").length;
  const planned = days.filter((d) => d.planned).length;
  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">This week</h2>
        <p className="text-sm text-muted"><span className="font-mono font-semibold text-ink tabular-nums">{done}/{planned}</span> sessions done</p>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => (
          <button key={d.date} onClick={() => setOpen(d)}
            aria-label={`${fmtDate(d.date, { weekday: "long" })}: ${STATUS_TEXT[d.status]}${d.planned ? ` (${d.planned})` : ""}`}
            className={cn("flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl hover:bg-surface-2", d.date === today && "ring-2 ring-brand")}>
            <span className="text-[11px] font-semibold text-muted uppercase">{WEEKDAYS[Number(new Date(d.date + "T12:00:00").getDay() + 6) % 7].slice(0, 1)}</span>
            <span className="text-sm tabular-nums">{Number(d.date.slice(8))}</span>
            <DayMark day={d} />
          </button>
        ))}
      </div>
      {open && <DaySheet day={open} unit={unit} onClose={() => setOpen(null)} />}
    </Card>
  );
}
