"use client";
import { useMemo, useState } from "react";
import NumberFlow, { type Format } from "@number-flow/react";
import { ArrowDownRight, ArrowUpRight, CalendarCheck, Dumbbell, Medal, Scale, Target, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { getActivePlan, type Plan } from "@/lib/data";
import { buildDays, type CalSession } from "@/lib/calendar";
import {
  currentRecords, DEFAULT_TARGET, exerciseOptions, inRange, monthBounds, periodTotals, PR_LABEL, prEvents, setsPerMuscle,
  strengthSeries, volumeStatus, weekStart, weightWithAverage, type GroupBy, type PeriodTotals, type PrEvent, type SessionRow, type SetRow,
} from "@/lib/analytics";
import { MUSCLES, muscleLabel, type Muscle } from "@/lib/muscles";
import { BarsChart, TrendChart } from "@/components/Charts";
import { Badge, Button, Card, Empty, ErrorBox, NumInput, Select, Skeleton } from "@/components/ui";
import { addDays, cn, errMsg, fmtDate, fromKg, localDate, toKg, type Unit } from "@/lib/utils";

type BW = { id: string; entry_date: string; weight_kg: number };
type Data = { sets: SetRow[]; sessions: (SessionRow & CalSession)[]; plan: Plan | null; bw: BW[]; prs: PrEvent[] };

/**
 * Stats for one client, shared by the coach (client profile → Progress) and the client (Progress page).
 * Everything is calculated from logged sets, sessions and weigh-ins.
 */
export default function ProgressView({ clientId, unit, canLogWeight, from, to }: { clientId: string; unit: Unit; canLogWeight: boolean; from?: string; to?: string }) {
  const supabase = createClient();
  const today = localDate();
  const rangeFrom = from ?? addDays(today, -89);
  const rangeTo = to ?? today;

  const { data, loading, error, reload } = useAsync(async (): Promise<Data> => {
    // A year of history so records and "previous best" are right even for a short range.
    const histFrom = addDays(rangeFrom < addDays(today, -365) ? rangeFrom : addDays(today, -365), 0);
    const [sets, sessions, plan, bw] = await Promise.all([
      supabase.rpc("completed_sets", { p_client: clientId, p_from: histFrom, p_to: today }),
      supabase.from("workout_sessions").select("id, scheduled_date, name, status, plan_day_id, started_at, completed_at")
        .eq("client_id", clientId).gte("scheduled_date", histFrom).order("scheduled_date"),
      getActivePlan(supabase, clientId),
      supabase.from("body_weights").select("*").eq("client_id", clientId).order("entry_date"),
    ]);
    const rows = must(sets) as SetRow[];
    return { sets: rows, sessions: must(sessions) as Data["sessions"], plan, bw: must(bw) as BW[], prs: prEvents(rows) };
  }, [clientId, rangeFrom, today]);

  if (loading) return <div className="space-y-4"><Skeleton className="h-36" /><Skeleton className="h-64" /><Skeleton className="h-64" /></div>;
  if (error || !data) return <ErrorBox message={error ?? "Couldn't load stats"} onRetry={reload} />;

  return (
    <div className="space-y-4">
      <MonthCompare data={data} unit={unit} today={today} />
      <Consistency data={data} from={rangeFrom} to={rangeTo} today={today} />
      <StrengthProgress data={data} unit={unit} from={rangeFrom} to={rangeTo} />
      <Records data={data} unit={unit} today={today} />
      <MuscleVolume data={data} today={today} />
      <BodyWeight clientId={clientId} unit={unit} entries={data.bw} canLog={canLogWeight} onSaved={() => reload({ silent: true })} from={rangeFrom} to={rangeTo} />
    </div>
  );
}

function Header({ icon, title, sub, action }: { icon: React.ReactNode; title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      <span className="mt-0.5 text-brand [&_svg]:size-5" aria-hidden>{icon}</span>
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold">{title}</h2>
        {sub && <p className="text-xs text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

const signed: Format = { maximumFractionDigits: 1, signDisplay: "exceptZero" };
const oneDecimal: Format = { minimumFractionDigits: 1, maximumFractionDigits: 1 };

function Tile({ label, value, format, suffix, sub, delta }: { label: string; value: number | null; format?: Format; suffix?: string; sub?: string; delta?: { text: string; up: boolean | null } }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="font-mono text-lg font-semibold tabular-nums">{value === null ? "—" : <NumberFlow value={value} format={format} suffix={suffix} />}</p>
      {delta && (
        <p className="flex items-center gap-0.5 text-[11px] text-muted">
          {delta.up === true && <ArrowUpRight className="size-3.5 text-brand" aria-hidden />}
          {delta.up === false && <ArrowDownRight className="size-3.5" aria-hidden />}
          {delta.text}
        </p>
      )}
      {sub && <p className="text-[11px] leading-tight text-muted">{sub}</p>}
    </div>
  );
}

const fmtBig = (kg: number, unit: Unit) => {
  const v = fromKg(kg, unit) ?? 0;
  return v >= 10000 ? `${(v / 1000).toFixed(1)}k ${unit}` : `${Math.round(v).toLocaleString()} ${unit}`;
};

/** Total-lifted tile parts: whole units below 10,000, otherwise thousands with one decimal ("12.3k kg"). */
function big(kg: number, unit: Unit): { value: number; format?: Format; suffix: string } {
  const v = fromKg(kg, unit) ?? 0;
  return v >= 10000
    ? { value: Number((v / 1000).toFixed(1)), format: oneDecimal, suffix: `k ${unit}` }
    : { value: Math.round(v), suffix: ` ${unit}` };
}

function delta(cur: number, prev: number, fmt: (n: number) => string = (n) => String(Math.round(n))) {
  if (prev === 0 && cur === 0) return { text: "same as last month", up: null };
  const d = cur - prev;
  return { text: `${d > 0 ? "+" : d < 0 ? "−" : "±"}${fmt(Math.abs(d))} vs last month`, up: d > 0 ? true : d < 0 ? false : null };
}

/** "This month vs last month": sessions, total lifted, PRs, average duration. */
function MonthCompare({ data, unit, today }: { data: Data; unit: Unit; today: string }) {
  const m = monthBounds(today);
  const cur: PeriodTotals = periodTotals(m.from, today, data.sessions, data.sets, data.prs);
  const prev: PeriodTotals = periodTotals(m.prevFrom, m.prevTo, data.sessions, data.sets, data.prs);
  return (
    <Card className="space-y-3">
      <Header icon={<CalendarCheck />} title={`${fmtDate(m.from, { month: "long" })} so far`} sub={`Compared with all of ${fmtDate(m.prevFrom, { month: "long" })}`} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Sessions" value={cur.sessions} delta={delta(cur.sessions, prev.sessions)} />
        <Tile label="Total lifted" value={big(cur.volumeKg, unit).value} format={big(cur.volumeKg, unit).format} suffix={big(cur.volumeKg, unit).suffix} delta={delta(cur.volumeKg, prev.volumeKg, (n) => fmtBig(n, unit))} />
        <Tile label="PRs" value={cur.prs} delta={delta(cur.prs, prev.prs)} />
        <Tile label="Avg session" value={cur.avgMinutes ? Math.round(cur.avgMinutes) : null} suffix=" min" sub={prev.avgMinutes ? `${Math.round(prev.avgMinutes)} min last month` : undefined} />
      </div>
    </Card>
  );
}

/** Adherence % per week and in the range, sessions per week, average duration. */
function Consistency({ data, from, to, today }: { data: Data; from: string; to: string; today: string }) {
  const weeks = useMemo(() => {
    const start = weekStart(addDays(today, -7 * 7));
    return Array.from({ length: 8 }, (_, i) => {
      const ws = addDays(start, i * 7);
      const days = buildDays(Array.from({ length: 7 }, (_, d) => addDays(ws, d)), data.plan, data.sessions, today);
      const planned = days.filter((d) => d.planned && (d.date < today || (d.date === today && d.status === "trained")));
      const hit = planned.filter((d) => d.status === "trained").length;
      return { date: ws, pct: planned.length ? Math.round((hit / planned.length) * 100) : null, done: days.filter((d) => d.status === "trained").length };
    });
  }, [data, today]);

  const rangeDays = useMemo(() => {
    const dates: string[] = [];
    for (let d = from; d <= (to < today ? to : today); d = addDays(d, 1)) dates.push(d);
    return buildDays(dates, data.plan, data.sessions, today);
  }, [data, from, to, today]);
  const planned = rangeDays.filter((d) => d.planned && (d.date < today || d.status === "trained"));
  const hit = planned.filter((d) => d.status === "trained").length;
  const missed = rangeDays.filter((d) => d.status === "missed").length;
  const done = data.sessions.filter((s) => s.status === "completed" && inRange(s.scheduled_date, from, to));
  // Count weeks from the first logged session, so a new client isn't averaged over empty weeks
  const firstSession = data.sessions.find((s) => s.status === "completed")?.scheduled_date;
  const effFrom = firstSession && firstSession > from ? firstSession : from;
  const effTo = to < today ? to : today;
  const nWeeks = Math.max(1, ((new Date(effTo + "T12:00:00").getTime() - new Date(effFrom + "T12:00:00").getTime()) / 86400000 + 1) / 7);
  const totals = periodTotals(from, to, data.sessions, data.sets, data.prs);

  return (
    <Card className="space-y-3">
      <Header icon={<Target />} title="Consistency" sub={`${fmtDate(from)} – ${fmtDate(to)}`} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Adherence" value={planned.length ? Math.round((hit / planned.length) * 100) : null} suffix="%" sub={planned.length ? `${hit} of ${planned.length} planned` : "no plan in range"} />
        <Tile label="Missed" value={missed} sub="planned, not logged" />
        <Tile label="Sessions / week" value={Number((done.length / nWeeks).toFixed(1))} format={oneDecimal} sub={`${done.length} sessions`} />
        <Tile label="Avg duration" value={totals.avgMinutes ? Math.round(totals.avgMinutes) : null} suffix=" min" />
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-muted">Weekly adherence, last 8 weeks</p>
        {weeks.every((w) => w.pct === null) ? (
          <p className="text-sm text-muted">No planned sessions yet, so there&apos;s nothing to measure against.</p>
        ) : (
          <BarsChart data={weeks} valueKey="pct" label="Adherence" max={100} unit="%" reference={80}
            colorFor={(r) => (r.pct !== null && Number(r.pct) < 50 ? "var(--color-warn-solid)" : "var(--color-brand)")} />
        )}
        <p className="mt-1 text-[11px] text-muted">Dashed line: 80%. Weeks under 50% are amber.</p>
      </div>
    </Card>
  );
}

/** Estimated 1RM per exercise over time, per variant (default) or per base movement. */
function StrengthProgress({ data, unit, from, to }: { data: Data; unit: Unit; from: string; to: string }) {
  const [by, setBy] = useState<GroupBy>("variant");
  const options = useMemo(() => exerciseOptions(data.sets, by), [data.sets, by]);
  const [picked, setPicked] = useState<string>("");
  const key = options.some((o) => o.key === picked) ? picked : options[0]?.key ?? "";
  const opt = options.find((o) => o.key === key);
  const series = useMemo(() => strengthSeries(data.sets, key, by), [data.sets, key, by]);
  const inR = series.filter((p) => inRange(p.date, from, to));
  const weighted = opt?.weighted ?? false;
  const rows = inR.map((p) => ({ date: p.date, value: weighted ? fromKg(p.e1rm, unit) : p.bestReps }));
  const first = inR.find((p) => (weighted ? p.e1rm : p.bestReps));
  const best = inR.reduce<typeof inR[number] | null>((b, p) => (!b || (weighted ? (p.e1rm ?? 0) > (b.e1rm ?? 0) : p.bestReps > b.bestReps) ? p : b), null);
  const last = inR.at(-1);
  const change = weighted && first?.e1rm && last?.e1rm ? last.e1rm - first.e1rm : !weighted && first && last ? last.bestReps - first.bestReps : null;

  return (
    <Card className="space-y-3">
      <Header
        icon={<Dumbbell />}
        title="Strength progress"
        sub={weighted ? "Estimated 1-rep max (Epley), best set each session" : "Best reps each session"}
        action={
          <div className="flex rounded-lg bg-surface-2 p-0.5" role="radiogroup" aria-label="Group by">
            {(["variant", "movement"] as GroupBy[]).map((g) => (
              <button key={g} role="radio" aria-checked={by === g} onClick={() => setBy(g)}
                className={cn("min-h-8 rounded-md px-2.5 text-xs font-semibold", by === g ? "bg-surface text-ink shadow-card" : "text-muted")}>
                {g === "variant" ? "Per variant" : "Per movement"}
              </button>
            ))}
          </div>
        }
      />
      {options.length === 0 ? (
        <Empty title="No exercises logged yet">Complete a workout to see strength over time.</Empty>
      ) : (
        <>
          <Select value={key} onChange={(e) => setPicked(e.target.value)} aria-label="Exercise">
            {options.map((o) => <option key={o.key} value={o.key}>{o.label} ({o.sessions} sessions)</option>)}
          </Select>
          {by === "movement" && <p className="text-xs text-muted">Combines every variant of this movement. Loads from different equipment aren&apos;t directly comparable.</p>}
          {rows.length === 0 ? (
            <p className="text-sm text-muted">No sessions in this date range.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Tile label={weighted ? "Latest est. 1RM" : "Latest best reps"} value={weighted ? fromKg(last?.e1rm, unit) : last?.bestReps ?? null} suffix={weighted ? ` ${unit}` : undefined} />
                <Tile label="Change in range" value={change === null ? null : weighted ? fromKg(change, unit) : change} format={signed} suffix={weighted ? ` ${unit}` : undefined} />
                <Tile label="Best set" value={best ? (weighted ? fromKg(best.weight, unit) : best.bestReps) : null} suffix={best ? (weighted ? ` × ${best.reps}` : " reps") : undefined} sub={best ? fmtDate(best.date, { month: "short", day: "numeric" }) : undefined} />
              </div>
              <TrendChart data={rows} series={[{ key: "value", label: weighted ? "Est. 1RM" : "Best reps", color: "var(--color-brand)" }]} unit={weighted ? unit : "reps"} digits={weighted ? 1 : 0} />
            </>
          )}
        </>
      )}
    </Card>
  );
}

/** Recent PRs and the current record for each exercise. */
function Records({ data, unit, today }: { data: Data; unit: Unit; today: string }) {
  const [showAll, setShowAll] = useState(false);
  const recent = data.prs.filter((e) => e.date >= addDays(today, -30)).sort((a, b) => b.date.localeCompare(a.date));
  const records = currentRecords(data.sets, data.prs).sort((a, b) => (b.lastPr ?? "").localeCompare(a.lastPr ?? "") || a.label.localeCompare(b.label));
  const shown = showAll ? records : records.slice(0, 6);
  return (
    <Card className="space-y-3">
      <Header icon={<Trophy />} title="Personal records" sub="Per variant. A PR is any set that beats your previous best." />
      {records.length === 0 ? (
        <p className="text-sm text-muted">Records appear after your first logged sets.</p>
      ) : (
        <>
          {recent.length > 0 ? (
            <ul className="space-y-1.5" aria-label="PRs in the last 30 days">
              {recent.slice(0, 6).map((e, i) => (
                <li key={`${e.key}-${e.kind}-${e.date}-${i}`} className="flex items-center gap-2 rounded-xl border border-brand/20 bg-brand/5 px-3 py-2 text-sm">
                  <Medal className="size-4 shrink-0 text-brand" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{e.label}</span>
                    <span className="text-muted"> · {PR_LABEL[e.kind]}: </span>
                    <span className="font-mono tabular-nums">{prValue(e, unit)}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{fmtDate(e.date, { month: "short", day: "numeric" })}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No new PRs in the last 30 days.</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] tracking-wide text-muted uppercase">
                  <th className="py-1 pr-2 font-semibold">Exercise</th>
                  <th className="px-2 py-1 font-semibold">Heaviest</th>
                  <th className="px-2 py-1 font-semibold">Est. 1RM</th>
                  <th className="py-1 pl-2 font-semibold">Last PR</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.key} className="border-t border-line/60 tabular-nums">
                    <td className="py-1.5 pr-2 font-medium">{r.label}</td>
                    <td className="px-2 py-1.5">{r.bodyweight ? `${r.reps ?? "—"} reps` : `${fromKg(r.weight, unit)} ${unit} × ${r.weightReps}`}</td>
                    <td className="px-2 py-1.5">{r.e1rm ? `${fromKg(r.e1rm, unit)} ${unit}` : "—"}</td>
                    <td className="py-1.5 pl-2 text-muted">{r.lastPr ? fmtDate(r.lastPr, { month: "short", day: "numeric" }) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {records.length > 6 && (
            <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${records.length}`}</Button>
          )}
        </>
      )}
    </Card>
  );
}

export function prValue(e: PrEvent, unit: Unit) {
  if (e.kind === "reps") return `${e.reps} reps`;
  if (e.kind === "weight") return `${fromKg(e.weight, unit)} ${unit} × ${e.reps}`;
  return `${fromKg(e.value, unit)} ${unit}`;
}

/** Sets per muscle for a week (primary = 1, secondary = 0.5) against a 10–20 set target. */
function MuscleVolume({ data, today }: { data: Data; today: string }) {
  const [period, setPeriod] = useState<"last7" | "prev7" | "avg4">("last7");
  const counts = useMemo(() => {
    if (period === "avg4") {
      const raw = setsPerMuscle(data.sets.filter((s) => inRange(s.performed_on, addDays(today, -27), today)));
      return Object.fromEntries(MUSCLES.map((m) => [m, raw[m] / 4])) as Record<Muscle, number>;
    }
    const end = period === "last7" ? today : addDays(today, -7);
    return setsPerMuscle(data.sets.filter((s) => inRange(s.performed_on, addDays(end, -6), end)));
  }, [data.sets, period, today]);
  const rows = MUSCLES.map((m) => ({ m, sets: counts[m], status: volumeStatus(counts[m]) })).sort((a, b) => b.sets - a.sets);
  const scaleMax = Math.max(DEFAULT_TARGET.max + 4, ...rows.map((r) => r.sets));
  const pct = (v: number) => `${(v / scaleMax) * 100}%`;
  const counts3 = { below: rows.filter((r) => r.status === "below" || r.status === "none").length, within: rows.filter((r) => r.status === "within").length, above: rows.filter((r) => r.status === "above").length };

  return (
    <Card className="space-y-3">
      <Header
        icon={<Target />}
        title="Weekly sets per muscle"
        sub={`Each set counts 1 for primary muscles, 0.5 for secondary. Target ${DEFAULT_TARGET.min}–${DEFAULT_TARGET.max} sets.`}
        action={
          <Select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} aria-label="Period" className="w-auto">
            <option value="last7">Last 7 days</option>
            <option value="prev7">7 days before</option>
            <option value="avg4">4-week average</option>
          </Select>
        }
      />
      <div className="flex flex-wrap gap-1.5 text-xs">
        <Badge>{counts3.below} under target</Badge>
        <Badge tone="brand">{counts3.within} on track</Badge>
        {counts3.above > 0 && <Badge tone="warn">{counts3.above} above target</Badge>}
      </div>
      <ul className="space-y-1.5" aria-label="Sets per muscle">
        {rows.map((r) => (
          <li key={r.m} className="grid grid-cols-[7.5rem_1fr_3.5rem] items-center gap-2 text-sm" title={`${muscleLabel(r.m)}: ${r.sets.toFixed(1)} sets`}>
            <span className="truncate">{muscleLabel(r.m)}</span>
            <span className="relative h-3 rounded-full bg-surface-2">
              {/* target band */}
              <span className="absolute inset-y-0 rounded-full bg-brand/10 ring-1 ring-brand/20" style={{ left: pct(DEFAULT_TARGET.min), width: pct(DEFAULT_TARGET.max - DEFAULT_TARGET.min) }} aria-hidden />
              {r.sets > 0 && (
                <span
                  className={cn("absolute inset-y-0.5 left-0 rounded-full", r.status === "above" ? "bg-warn-solid" : r.status === "within" ? "bg-brand" : "bg-muted/50")}
                  style={{ width: `max(6px, ${pct(r.sets)})` }}
                />
              )}
            </span>
            <span className={cn("text-right font-mono text-xs tabular-nums", r.status === "none" && "text-muted")}>
              {r.sets ? r.sets.toFixed(r.sets % 1 ? 1 : 0) : "0"}
              {r.status === "above" && <span className="sr-only"> (above target)</span>}
              {r.status === "below" && <span className="sr-only"> (under target)</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted">Shaded band: target range. Grey bars are under target, teal on track, amber above (possible overload).</p>
    </Card>
  );
}

/** Weigh-ins as dots with the 7-day average as a line, so daily noise doesn't hide the trend. */
function BodyWeight({ clientId, unit, entries, canLog, onSaved, from, to }: { clientId: string; unit: Unit; entries: BW[]; canLog: boolean; onSaved: () => void; from: string; to: string }) {
  const supabase = createClient();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const rows = weightWithAverage(entries)
    .filter((e) => inRange(e.date, from, to))
    .map((e) => ({ date: e.date, weight: fromKg(e.weight, unit), avg7: fromKg(e.avg7, unit) }));
  const latest = rows.at(-1);
  const firstAvg = rows[0]?.avg7;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const v = parseFloat(value.replace(",", "."));
    const kg = toKg(v, unit);
    if (!kg || kg < 20 || kg > 500) return setError(`Enter a weight between ${unit === "kg" ? "20 and 500 kg" : "44 and 1100 lb"}.`);
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("body_weights").upsert({ client_id: clientId, entry_date: localDate(), weight_kg: Number(kg.toFixed(2)) }, { onConflict: "client_id,entry_date" });
    setSaving(false);
    if (error) return setError(errMsg(error));
    setValue("");
    onSaved();
  }

  return (
    <Card className="space-y-3">
      <Header icon={<Scale />} title="Body weight" sub="Dots are weigh-ins; the line is the 7-day average." />
      {latest && (
        <div className="grid grid-cols-2 gap-2">
          <Tile label="7-day average" value={latest.avg7 ?? null} format={oneDecimal} suffix={` ${unit}`} />
          <Tile label="Trend in range" value={firstAvg != null && latest.avg7 != null && rows.length > 1 ? latest.avg7 - firstAvg : null} format={signed} suffix={` ${unit}`} />
        </div>
      )}
      {rows.length > 1 ? (
        <TrendChart
          data={rows}
          series={[
            { key: "weight", label: "Weigh-in", color: "var(--color-muted)", dotsOnly: true },
            { key: "avg7", label: "7-day average", color: "var(--color-brand)" },
          ]}
          unit={unit}
          height={200}
        />
      ) : (
        <p className="text-sm text-muted">{rows.length === 1 ? "Log one more entry to see a trend." : "No body-weight entries in this range (optional)."}</p>
      )}
      {canLog && (
        <form onSubmit={save} className="flex gap-2" noValidate>
          <NumInput decimal placeholder={`Today's weight (${unit})`} value={value} onChange={(e) => setValue(e.target.value)} aria-label={`Body weight in ${unit}`} className="flex-1" />
          <Button type="submit" loading={saving}>Log</Button>
        </form>
      )}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </Card>
  );
}
