"use client";
import { useId, useMemo, useState } from "react";
import { Flame, SlidersHorizontal } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import {
  DEFAULT_TARGET, daysIn, fmtSets, muscleExercises, muscleTargets, perWeek, setsPerMuscle, STATUS_LABEL, volumeStatus,
  type MuscleTargetRow, type MuscleTargets, type SetRow, type VolumeStatus,
} from "@/lib/analytics";
import { MUSCLES, muscleLabel, type Muscle } from "@/lib/muscles";
import MuscleMap, { TONE_PATTERN, TonePatterns, type Tone } from "@/components/MuscleMap";
import { Sheet, useSheet } from "@/components/Sheet";
import { Badge, Button, Card, ErrorBox, Field, Input, NumInput, Segmented, Skeleton } from "@/components/ui";
import { addDays, cn, errMsg, fmtDate, localDate } from "@/lib/utils";

const BACK_VIEW = new Set<Muscle>(["rear_delts", "triceps", "lats", "lower_back", "glutes", "hamstrings"]);
const FRONT_VIEW = new Set<Muscle>(["chest", "front_delts", "biceps", "abs", "obliques", "quads"]);
/** Muscles drawn on a view (some, like side delts and calves, appear on both). */
export const onView = (m: Muscle, view: "front" | "back") => (view === "front" ? !BACK_VIEW.has(m) : !FRONT_VIEW.has(m));

export const STATUS_TONE: Record<VolumeStatus, Tone | undefined> = { none: undefined, below: "low", within: "mid", above: "high" };

export async function loadTargets(supabase: SupabaseClient, clientId: string): Promise<MuscleTargets> {
  const rows = must(await supabase.from("muscle_targets").select("muscle, min_sets, max_sets").eq("client_id", clientId)) as MuscleTargetRow[];
  return muscleTargets(rows);
}

export type MuscleStat = { m: Muscle; sets: number; weekly: number; status: VolumeStatus };

/** Sets per muscle over a range, as weekly averages compared with each muscle's weekly target. */
export function muscleStats(sets: SetRow[], targets: MuscleTargets, days: number): MuscleStat[] {
  const counts = setsPerMuscle(sets);
  return MUSCLES.map((m) => {
    const weekly = perWeek(counts[m], days);
    return { m, sets: counts[m], weekly, status: volumeStatus(weekly, targets[m]) };
  });
}

export const statsTones = (stats: MuscleStat[]) =>
  Object.fromEntries(stats.map((s) => [s.m, STATUS_TONE[s.status]]).filter(([, t]) => t)) as Partial<Record<Muscle, Tone>>;

const SWATCH: Record<VolumeStatus, string> = { none: "fill-line", below: "fill-brand/30", within: "fill-brand", above: "fill-danger" };

/** Legend with swatch, texture and words, so the scale never depends on colour alone. */
export function HeatLegend({ targets }: { targets?: MuscleTargets }) {
  const id = useId().replace(/:/g, "");
  const custom = targets && MUSCLES.some((m) => targets[m].custom);
  const { min, max } = DEFAULT_TARGET;
  const items: { s: VolumeStatus; text: string }[] = [
    { s: "none", text: "Not trained (0 sets)" },
    { s: "below", text: custom ? "Below target: undertrained" : `Below target (under ${min} sets / week)` },
    { s: "within", text: custom ? "Within target: on track" : `On target (${min}–${max} sets / week)` },
    { s: "above", text: custom ? "Above target: possible overload" : `Above target (over ${max} / week): possible overload` },
  ];
  return (
    <div className="space-y-1">
    <ul className="grid gap-1 text-xs text-muted sm:grid-cols-2" aria-label="Heat map legend">
      {items.map(({ s, text }) => {
        const pattern = STATUS_TONE[s] && TONE_PATTERN[STATUS_TONE[s]!];
        return (
          <li key={s} className="flex items-center gap-2">
            <svg viewBox="0 0 14 14" className="size-4 shrink-0" aria-hidden>
              <TonePatterns id={`${id}${s}`} />
              <rect width="14" height="14" rx="3" className={cn(SWATCH[s], "stroke-line")} strokeWidth="1" />
              {pattern && <rect width="14" height="14" rx="3" fill={`url(#${id}${s}-${pattern})`} />}
            </svg>
            <span>{text}</span>
          </li>
        );
      })}
    </ul>
    {custom && <p className="text-[11px] text-muted">Targets are set per muscle by the coach (default {min}–{max} sets per week).</p>}
    </div>
  );
}

type Range = "7" | "30" | "custom";

/**
 * Front/back muscle heat map (spec §5): each completed set counts 1 for primary muscles and
 * 0.5 for secondary, summed over the range and compared with the client's weekly targets.
 */
export default function MuscleHeatMap({ clientId, canEditTargets = false, onTargetsSaved }: { clientId: string; canEditTargets?: boolean; onTargetsSaved?: () => void }) {
  const supabase = createClient();
  const today = localDate();
  const [range, setRange] = useState<Range>("7");
  const [custom, setCustom] = useState({ from: addDays(today, -13), to: today });
  const [view, setView] = useState<"front" | "back">("front");
  const [selected, setSelected] = useState<Muscle | null>(null);
  const targetsSheet = useSheet<true>();
  const from = range === "custom" ? custom.from : addDays(today, -(Number(range) - 1));
  const to = range === "custom" ? custom.to : today;
  const days = daysIn(from, to);

  const { data, loading, error, reload } = useAsync(async () => {
    const [sets, targets] = await Promise.all([
      supabase.rpc("completed_sets", { p_client: clientId, p_from: from, p_to: to }),
      loadTargets(supabase, clientId),
    ]);
    return { sets: must(sets) as SetRow[], targets };
  }, [clientId, from, to]);

  const stats = useMemo(() => (data ? muscleStats(data.sets, data.targets, days) : []), [data, days]);
  const sel = selected ? stats.find((s) => s.m === selected) : null;
  const exercises = useMemo(() => (data && selected ? muscleExercises(data.sets, selected) : []), [data, selected]);
  const pick = (m: Muscle) => {
    setSelected((cur) => (cur === m ? null : m));
    if (!onView(m, view)) setView(view === "front" ? "back" : "front");
  };

  return (
    <Card className="space-y-3" >
      <div className="flex flex-wrap items-start gap-2">
        <Flame className="mt-0.5 size-5 text-brand" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Muscle heat map</h2>
          <p className="text-xs text-muted">Sets per muscle against the weekly target. Primary muscles count 1 per set, secondary 0.5.</p>
        </div>
        {canEditTargets && data && (
          <Button size="sm" variant="secondary" onClick={() => targetsSheet.show(true)}><SlidersHorizontal className="size-4" /> Set targets</Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Range" value={range} onChange={setRange} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "custom", label: "Custom" }]} />
        <Segmented label="Side" value={view} onChange={setView} options={[{ value: "front", label: "Front" }, { value: "back", label: "Back" }]} />
      </div>
      {range === "custom" && (
        <div className="flex flex-wrap gap-2">
          <Field label="From"><Input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} /></Field>
          <Field label="To"><Input type="date" value={custom.to} min={custom.from} max={today} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} /></Field>
        </div>
      )}
      <p className="text-xs text-muted">
        {fmtDate(from, { month: "short", day: "numeric" })} – {fmtDate(to, { month: "short", day: "numeric" })}
        {days > 7 && " · colours use the weekly average"}
      </p>

      {loading ? (
        <Skeleton className="h-72" />
      ) : error || !data ? (
        <ErrorBox message={error ?? "Couldn't load the heat map"} onRetry={reload} />
      ) : (
        <>
          <div className="grid items-center gap-4 sm:grid-cols-[auto_1fr]">
            <MuscleMap tones={statsTones(stats)} view={view} size="md" className="h-72" onSelect={pick} selected={selected} />
            <div className="min-h-32 rounded-xl bg-surface-2 p-3" aria-live="polite">
              {sel ? (
                <MuscleDetail stat={sel} target={data.targets[sel.m]} days={days} exercises={exercises} />
              ) : (
                <p className="text-sm text-muted">Tap a muscle on the body or in the list below to see its set count and the exercises that trained it.</p>
              )}
            </div>
          </div>
          <HeatLegend targets={data.targets} />
          {data.sets.length === 0 && <p className="text-sm text-muted">No completed sets in this range yet.</p>}
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2" aria-label="Sets per muscle">
            {stats.filter((s) => onView(s.m, view)).map((s) => (
              <li key={s.m}>
                <button type="button" onClick={() => pick(s.m)} aria-pressed={selected === s.m}
                  className={cn("flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-surface-2", selected === s.m && "bg-surface-2 ring-1 ring-line")}>
                  <span className="min-w-0 flex-1 truncate">{muscleLabel(s.m)}</span>
                  <span className="font-mono text-xs tabular-nums">{fmtSets(Math.round(s.weekly * 10) / 10)}</span>
                  <StatusBadge status={s.status} />
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted">{days > 7 ? "Numbers are sets per week (average over the range)." : "Numbers are sets in the last 7 days."} Showing {view} muscles; switch sides for the rest.</p>
          <MuscleTargetsEditor
            key={targetsSheet.key}
            {...targetsSheet.bind}
            clientId={clientId}
            targets={data.targets}
            onSaved={() => { targetsSheet.close(); reload({ silent: true }); onTargetsSaved?.(); }}
          />
        </>
      )}
    </Card>
  );
}

export function StatusBadge({ status }: { status: VolumeStatus }) {
  const tone = status === "within" ? "brand" : status === "above" ? "danger" : "neutral";
  return <span className="w-24 shrink-0 text-right"><Badge tone={tone}>{STATUS_LABEL[status]}</Badge></span>;
}

function MuscleDetail({ stat, target, days, exercises }: { stat: MuscleStat; target: MuscleTargets[Muscle]; days: number; exercises: ReturnType<typeof muscleExercises> }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex-1 font-semibold">{muscleLabel(stat.m)}</h3>
        <StatusBadge status={stat.status} />
      </div>
      <p className="text-sm">
        <span className="font-mono text-lg font-semibold tabular-nums">{fmtSets(stat.sets)}</span> sets
        {days > 7 && <span className="text-muted"> · {fmtSets(Math.round(stat.weekly * 10) / 10)} per week</span>}
      </p>
      <p className="text-xs text-muted">Target {fmtSets(target.min)}–{fmtSets(target.max)} sets per week{target.custom ? " (set by coach)" : " (default)"}</p>
      {exercises.length > 0 ? (
        <ul className="space-y-1 text-sm" aria-label={`Exercises that trained ${muscleLabel(stat.m)}`}>
          {exercises.map((e) => (
            <li key={e.key} className="flex gap-2">
              <span className="min-w-0 flex-1 truncate">{e.label}</span>
              <span className="text-xs text-muted">{e.role}</span>
              <span className="w-10 text-right font-mono text-xs tabular-nums">{fmtSets(e.sets)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Not trained in this range.</p>
      )}
    </div>
  );
}

/** Coach edits weekly set targets per muscle; rows left at the default aren't stored. */
/** Bottom sheet for a client's weekly set targets. Key it on the sheet's `key` so each open starts from `targets`. */
export function MuscleTargetsEditor({ clientId, targets, open, onOpenChange, onClosed, onSaved }: {
  clientId: string; targets: MuscleTargets; open: boolean; onOpenChange: (open: boolean) => void; onClosed?: () => void; onSaved: () => void;
}) {
  const supabase = createClient();
  const [f, setF] = useState(() => Object.fromEntries(MUSCLES.map((m) => [m, { min: String(targets[m].min), max: String(targets[m].max) }])) as Record<Muscle, { min: string; max: string }>);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const parsed = MUSCLES.map((m) => ({ m, min: Number(f[m].min.replace(",", ".")), max: Number(f[m].max.replace(",", ".")) }));
    const bad = parsed.find((p) => f[p.m].min.trim() === "" || f[p.m].max.trim() === "" || !(p.min >= 0) || !(p.max <= 60) || p.max < p.min);
    if (bad) return setErr(`${muscleLabel(bad.m)}: enter a minimum and maximum between 0 and 60, with the maximum at least the minimum.`);
    const { data: auth } = await supabase.auth.getUser();
    const isDefault = (p: (typeof parsed)[number]) => p.min === DEFAULT_TARGET.min && p.max === DEFAULT_TARGET.max;
    const upserts = parsed.filter((p) => !isDefault(p)).map((p) => ({
      client_id: clientId, muscle: p.m, min_sets: p.min, max_sets: p.max, updated_by: auth.user?.id, updated_at: new Date().toISOString(),
    }));
    const deletes = parsed.filter((p) => isDefault(p) && targets[p.m].custom).map((p) => p.m);
    setSaving(true);
    setErr(null);
    const results = await Promise.all([
      upserts.length ? supabase.from("muscle_targets").upsert(upserts, { onConflict: "client_id,muscle" }) : null,
      deletes.length ? supabase.from("muscle_targets").delete().eq("client_id", clientId).in("muscle", deletes) : null,
    ]);
    setSaving(false);
    const failed = results.find((r) => r?.error);
    if (failed?.error) return setErr(errMsg(failed.error));
    onSaved();
  }

  const reset = () => setF(Object.fromEntries(MUSCLES.map((m) => [m, { min: String(DEFAULT_TARGET.min), max: String(DEFAULT_TARGET.max) }])) as typeof f);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      onClosed={onClosed}
      title="Weekly set targets"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={reset} className="mr-auto">Reset all to {DEFAULT_TARGET.min}–{DEFAULT_TARGET.max}</Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} loading={saving}>Save targets</Button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-muted">Hard sets per week for this client. The heat map and weekly volume colour each muscle against these.</p>
      <div className="grid grid-cols-[1fr_4.5rem_4.5rem] items-center gap-x-2 gap-y-1.5 text-sm">
        <span className="text-xs font-semibold text-muted uppercase">Muscle</span>
        <span className="text-xs font-semibold text-muted uppercase">Min</span>
        <span className="text-xs font-semibold text-muted uppercase">Max</span>
        {MUSCLES.map((m) => (
          <TargetRow key={m} m={m} value={f[m]} onChange={(v) => { setF({ ...f, [m]: v }); setErr(null); }} />
        ))}
      </div>
      {err && <p className="mt-3 text-sm text-danger" role="alert">{err}</p>}
    </Sheet>
  );
}

function TargetRow({ m, value, onChange }: { m: Muscle; value: { min: string; max: string }; onChange: (v: { min: string; max: string }) => void }) {
  return (
    <>
      <label htmlFor={`t-${m}-min`}>{muscleLabel(m)}</label>
      <NumInput decimal id={`t-${m}-min`} value={value.min} onChange={(e) => onChange({ ...value, min: e.target.value })} aria-label={`${muscleLabel(m)} minimum sets`} />
      <NumInput decimal value={value.max} onChange={(e) => onChange({ ...value, max: e.target.value })} aria-label={`${muscleLabel(m)} maximum sets`} />
    </>
  );
}
