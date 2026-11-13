"use client";
import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Columns2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { daysIn, fmtSets, monthBounds, periodTotals, prEvents, type PeriodTotals, type SessionRow, type SetRow } from "@/lib/analytics";
import { muscleLabel } from "@/lib/muscles";
import MuscleMap from "@/components/MuscleMap";
import { HeatLegend, loadTargets, muscleStats, onView, statsTones } from "@/components/MuscleHeatMap";
import { Card, ErrorBox, Field, Input, Segmented, Select, Skeleton } from "@/components/ui";
import { addDays, cn, fmtDate, fromKg, localDate, type Unit } from "@/lib/utils";

type Period = { from: string; to: string; label: string };
type Preset = "month" | "4w" | "7d" | "custom";

function presetPeriods(p: Preset, today: string, custom: [Period, Period]): [Period, Period] {
  if (p === "month") {
    const m = monthBounds(today);
    return [
      { from: m.from, to: today, label: `${fmtDate(m.from, { month: "long" })} so far` },
      { from: m.prevFrom, to: m.prevTo, label: fmtDate(m.prevFrom, { month: "long" }) },
    ];
  }
  const n = p === "4w" ? 28 : 7;
  if (p === "4w" || p === "7d") {
    return [
      { from: addDays(today, -(n - 1)), to: today, label: `Last ${p === "4w" ? "4 weeks" : "7 days"}` },
      { from: addDays(today, -(2 * n - 1)), to: addDays(today, -n), label: `${p === "4w" ? "4 weeks" : "7 days"} before` },
    ];
  }
  return custom;
}

const short = (d: string) => fmtDate(d, { month: "short", day: "numeric" });

/** Coach-only: two periods side by side — heat map, key totals and sets per muscle. */
export default function PeriodCompare({ clientId, unit }: { clientId: string; unit: Unit }) {
  const supabase = createClient();
  const today = localDate();
  const [preset, setPreset] = useState<Preset>("month");
  const [view, setView] = useState<"front" | "back">("front");
  const [custom, setCustom] = useState<[Period, Period]>([
    { from: addDays(today, -13), to: today, label: "Period A" },
    { from: addDays(today, -27), to: addDays(today, -14), label: "Period B" },
  ]);
  const [a, b] = presetPeriods(preset, today, custom);
  const earliest = a.from < b.from ? a.from : b.from;

  const { data, loading, error, reload } = useAsync(async () => {
    // a year before the earliest period so PRs are judged against real previous bests
    const histFrom = addDays(earliest, -365);
    const [sets, sessions, targets] = await Promise.all([
      supabase.rpc("completed_sets", { p_client: clientId, p_from: histFrom, p_to: today }),
      supabase.from("workout_sessions").select("id, scheduled_date, status, started_at, completed_at")
        .eq("client_id", clientId).gte("scheduled_date", earliest).order("scheduled_date"),
      loadTargets(supabase, clientId),
    ]);
    const rows = must(sets) as SetRow[];
    return { sets: rows, sessions: must(sessions) as SessionRow[], targets, prs: prEvents(rows) };
  }, [clientId, earliest, today]);

  const sides = useMemo(() => {
    if (!data) return null;
    return [a, b].map((p) => {
      const sets = data.sets.filter((s) => s.performed_on >= p.from && s.performed_on <= p.to);
      const days = daysIn(p.from, p.to);
      return { p, days, stats: muscleStats(sets, data.targets, days), totals: periodTotals(p.from, p.to, data.sessions, data.sets, data.prs) };
    });
  }, [data, a, b]);

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        <Columns2 className="mt-0.5 size-5 text-brand" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Compare periods</h2>
          <p className="text-xs text-muted">Two periods side by side. Muscle colours use sets per week, so periods of different length compare fairly.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} aria-label="Periods" className="w-auto">
          <option value="month">This month vs last month</option>
          <option value="4w">Last 4 weeks vs 4 weeks before</option>
          <option value="7d">Last 7 days vs 7 days before</option>
          <option value="custom">Custom periods</option>
        </Select>
        <Segmented label="Side" value={view} onChange={setView} options={[{ value: "front", label: "Front" }, { value: "back", label: "Back" }]} />
      </div>
      {preset === "custom" && (
        <div className="grid gap-2 sm:grid-cols-2">
          {custom.map((p, i) => (
            <fieldset key={i} className="flex flex-wrap gap-2 rounded-xl border border-line p-2">
              <legend className="px-1 text-xs font-semibold text-muted">{i === 0 ? "Period A" : "Period B"}</legend>
              <Field label="From"><Input type="date" value={p.from} max={p.to} onChange={(e) => e.target.value && setCustom(custom.map((c, j) => (j === i ? { ...c, from: e.target.value } : c)) as [Period, Period])} /></Field>
              <Field label="To"><Input type="date" value={p.to} min={p.from} max={today} onChange={(e) => e.target.value && setCustom(custom.map((c, j) => (j === i ? { ...c, to: e.target.value } : c)) as [Period, Period])} /></Field>
            </fieldset>
          ))}
        </div>
      )}

      {loading ? (
        <Skeleton className="h-80" />
      ) : error || !data || !sides ? (
        <ErrorBox message={error ?? "Couldn't load the comparison"} onRetry={reload} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {sides.map((s, i) => (
              <div key={i} className="min-w-0 space-y-1 rounded-xl bg-surface-2 p-2 text-center">
                <p className="truncate text-sm font-semibold">{s.p.label}</p>
                <p className="text-[11px] text-muted">{short(s.p.from)} – {short(s.p.to)} · {s.days} days</p>
                <MuscleMap tones={statsTones(s.stats)} view={view} size="md" className="h-52" />
              </div>
            ))}
          </div>
          <HeatLegend targets={data.targets} />
          <TotalsTable a={sides[0].totals} b={sides[1].totals} labels={[a.label, b.label]} unit={unit} />
          <MuscleTable a={sides[0].stats} b={sides[1].stats} labels={[a.label, b.label]} view={view} />
        </>
      )}
    </Card>
  );
}

function Change({ a, b, fmt, invert = false }: { a: number; b: number; fmt: (n: number) => string; invert?: boolean }) {
  const d = a - b;
  if (Math.abs(d) < 1e-9) return <span className="text-muted">±0</span>;
  const up = d > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5", (invert ? !up : up) ? "text-brand-dark" : "text-muted")}>
      {up ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
      {up ? "+" : "−"}{fmt(Math.abs(d))}
    </span>
  );
}

function TotalsTable({ a, b, labels, unit }: { a: PeriodTotals; b: PeriodTotals; labels: [string, string]; unit: Unit }) {
  const kg = (n: number) => `${Math.round(fromKg(n, unit) ?? 0).toLocaleString()} ${unit}`;
  const int = (n: number) => String(Math.round(n));
  const rows: { label: string; a: number | null; b: number | null; fmt: (n: number) => string }[] = [
    { label: "Sessions", a: a.sessions, b: b.sessions, fmt: int },
    { label: "Sets", a: a.sets, b: b.sets, fmt: int },
    { label: "Total lifted", a: a.volumeKg, b: b.volumeKg, fmt: kg },
    { label: "PRs", a: a.prs, b: b.prs, fmt: int },
    { label: "Avg session", a: a.avgMinutes, b: b.avgMinutes, fmt: (n) => `${Math.round(n)} min` },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Key totals for both periods</caption>
        <thead>
          <tr className="text-left text-[11px] tracking-wide text-muted uppercase">
            <th className="py-1 pr-2 font-semibold">Total</th>
            <th className="px-2 py-1 font-semibold">{labels[0]}</th>
            <th className="px-2 py-1 font-semibold">{labels[1]}</th>
            <th className="py-1 pl-2 font-semibold">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-line/60 tabular-nums">
              <td className="py-1.5 pr-2 font-medium">{r.label}</td>
              <td className="px-2 py-1.5 font-mono">{r.a === null ? "—" : r.fmt(r.a)}</td>
              <td className="px-2 py-1.5 font-mono">{r.b === null ? "—" : r.fmt(r.b)}</td>
              <td className="py-1.5 pl-2 text-xs">{r.a === null || r.b === null ? "—" : <Change a={r.a} b={r.b} fmt={r.fmt} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MuscleTable({ a, b, labels, view }: { a: ReturnType<typeof muscleStats>; b: ReturnType<typeof muscleStats>; labels: [string, string]; view: "front" | "back" }) {
  const rows = a.map((s, i) => ({ m: s.m, a: s.weekly, b: b[i].weekly })).filter((r) => (r.a > 0 || r.b > 0) && onView(r.m, view));
  const f = (n: number) => fmtSets(Math.round(n * 10) / 10);
  if (rows.length === 0) return <p className="text-sm text-muted">No {view} muscles trained in either period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="mb-1 text-left text-xs text-muted">Sets per week, {view} muscles</caption>
        <thead>
          <tr className="text-left text-[11px] tracking-wide text-muted uppercase">
            <th className="py-1 pr-2 font-semibold">Muscle</th>
            <th className="px-2 py-1 font-semibold">{labels[0]}</th>
            <th className="px-2 py-1 font-semibold">{labels[1]}</th>
            <th className="py-1 pl-2 font-semibold">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.m} className="border-t border-line/60 tabular-nums">
              <td className="py-1.5 pr-2">{muscleLabel(r.m)}</td>
              <td className="px-2 py-1.5 font-mono">{f(r.a)}</td>
              <td className="px-2 py-1.5 font-mono">{f(r.b)}</td>
              <td className="py-1.5 pl-2 text-xs"><Change a={r.a} b={r.b} fmt={f} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
