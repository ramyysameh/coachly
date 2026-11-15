"use client";
import { use, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import NumberFlow from "@number-flow/react";
import { useRouter } from "next/navigation";
import { Calculator, Check, ChevronLeft, Flame, Minus, Plus, Timer, X } from "lucide-react";
import { BAR_OPTIONS, PLATES, platesPerSide, RPE_CHOICES, warmupRamp } from "@/lib/gymMath";
import { createClient } from "@/lib/supabase/client";
import { playChime, primeChime } from "@/lib/chime";
import { useAsync, must } from "@/lib/useAsync";
import { SESSION_SELECT, sortSession, type Session, type SessionExercise, type SessionSet, type SetType } from "@/lib/data";
import { useProfile } from "@/components/AppShell";
import { Badge, Button, ErrorBox, Field, NumInput, Spinner, Textarea } from "@/components/ui";
import { ConfirmSheet, Sheet } from "@/components/Sheet";
import { notify } from "@/lib/notify";
import { isUnreachable } from "@/lib/supabase/authState";
import { checkLivePr, liveRecords, PR_LABEL, type LiveRecord, type SetRow as HistoryRow } from "@/lib/analytics";
import { isWorkingSet, SET_TYPE_TONE, SET_TYPES, setLabels, setTypeInfo } from "@/lib/setTypes";
import { addDays, cn, errMsg, fmtDate, fmtRest, fromKg, localDate, toKg, type Unit } from "@/lib/utils";
import { clearSetPatch, flushPendingSets, pendingPatchesFor, queueSetPatch } from "@/lib/pendingSets";

type Prev = { exercise_id: string; performed_on: string; set_number: number; reps: number | null; weight_kg: number | null; set_type?: SetType };

/**
 * Lines this session's sets up with last time's: the nth warm-up with the nth warm-up and the
 * nth working set with the nth working set, so adding warm-ups doesn't shift the comparisons.
 */
function matchPrev(sets: SessionSet[], prev: Prev[] | undefined): (Prev | undefined)[] {
  const warm = (prev ?? []).filter((p) => p.set_type === "warmup");
  const work = (prev ?? []).filter((p) => p.set_type !== "warmup");
  let w = 0, k = 0;
  return sets.map((s) => (isWorkingSet(s) ? work[k++] : warm[w++]));
}

/** A rest countdown starting now. Only called from event handlers. */
const restFor = (sec: number) => ({ until: Date.now() + sec * 1000, total: sec });

/** Set edits queue offline; adding or removing a set row doesn't, so say that plainly instead of a generic error. */
function setRowError(error: unknown) {
  return isUnreachable(error) || !navigator.onLine
    ? "Adding or removing sets needs a connection. The sets you've logged are kept on this phone."
    : errMsg(error);
}

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const supabase = createClient();
  const { profile } = useProfile();
  const unit = profile.weight_unit;
  const [rest, setRest] = useState<{ until: number; total: number } | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Records to beat for live PR toasts. Empty (so no toasts) when the history couldn't load.
  const records = useRef<Map<string, LiveRecord>>(new Map());

  const { data, loading, error: loadError, reload, setData } = useAsync(async () => {
    // send set edits that didn't reach the server last time (app closed / offline)
    await flushPendingSets(supabase, id);
    const today = localDate();
    const [s, prev, history] = await Promise.all([
      supabase.from("workout_sessions").select(SESSION_SELECT).eq("id", id).maybeSingle(),
      supabase.rpc("last_performance", { p_session: id }),
      supabase.rpc("completed_sets", { p_client: profile.id, p_from: addDays(today, -730), p_to: addDays(today, 1) }),
    ]);
    const session = sortSession(must(s) as Session | null);
    if (!session) throw new Error("Workout not found");
    // Show edits made on this phone that haven't reached the server yet.
    const pending = pendingPatchesFor(id);
    session.session_exercises?.forEach((e) => e.session_sets.forEach((st) => Object.assign(st, pending[st.id] ?? {})));
    // "Last time" numbers and PR history are nice to have — offline the workout still opens without them.
    const prevBy: Record<string, Prev[]> = {};
    for (const p of prev.error ? [] : ((prev.data as Prev[]) ?? [])) (prevBy[p.exercise_id] ??= []).push(p);
    const done = (session.session_exercises ?? []).flatMap((e) =>
      e.session_sets.filter((x) => x.completed && isWorkingSet(x)).map((x) => ({ ...x, exercise_id: e.exercise_id, exercise_name: e.exercise_name })),
    );
    records.current = history.error ? new Map() : liveRecords((history.data as HistoryRow[]) ?? [], id, session.scheduled_date, done);
    return { session, prevBy };
  }, [id]);

  function onSetCompleted(ex: SessionExercise, set: Pick<SessionSet, "weight_kg" | "reps" | "set_type">) {
    if (data?.session.status === "completed") return;
    if (isWorkingSet(set)) {
      const kinds = checkLivePr(records.current, { exercise_id: ex.exercise_id, exercise_name: ex.exercise_name, weight_kg: set.weight_kg, reps: set.reps });
      if (kinds.length) {
        navigator.vibrate?.([60, 40, 60]);
        const what = set.weight_kg ? `${fromKg(set.weight_kg, unit)} ${unit} × ${set.reps}` : `${set.reps} reps`;
        notify.pr(`New PR: ${ex.exercise_name}`, `${kinds.map((k) => PR_LABEL[k]).join(" · ")}. ${what}`);
      }
    }
    // rest 0 means the coach turned the timer off for this exercise
    if (ex.rest_seconds > 0) setRest(restFor(ex.rest_seconds));
  }

  function patchSession(fn: (s: Session) => void) {
    setData((d) => {
      if (!d) return d;
      const copy: Session = structuredClone(d.session);
      fn(copy);
      return { ...d, session: copy };
    });
  }

  async function finish() {
    if (!data) return;
    setFinishing(true);
    setError(null);
    if (await flushPendingSets(supabase, id)) {
      setFinishing(false);
      return setError("Some sets haven't saved yet. Check your connection and try again.");
    }
    const { error } = await supabase
      .from("workout_sessions")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", id);
    setFinishing(false);
    if (error) return setError(errMsg(error));
    // replace, so Back from Today doesn't reopen the finished workout
    router.replace(`/today?done=1&session=${id}`);
  }

  if (loading) return <Spinner label="Loading workout…" />;
  if (loadError || !data) return <ErrorBox message={loadError ?? "Workout not found"} onRetry={reload} />;

  const { session, prevBy } = data;
  const exercises = session.session_exercises ?? [];
  const allSets = exercises.flatMap((e) => e.session_sets);
  const doneSets = allSets.filter((s) => s.completed).length;
  const completed = session.status === "completed";
  const volumeKg = allSets.filter((s) => s.completed && isWorkingSet(s)).reduce((t, s) => t + Number(s.weight_kg ?? 0) * Number(s.reps ?? 0), 0);

  return (
    <div className="-mx-1 space-y-3">
      <div className="flex items-center gap-2">
        <Link href="/today" className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-line/60" aria-label="Back">
          <ChevronLeft className="size-6" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{session.name}</h1>
          <p className="text-xs text-muted">{fmtDate(session.scheduled_date)}</p>
        </div>
        {completed ? <Badge tone="brand">Completed</Badge> : <Badge tone="warn">In progress</Badge>}
      </div>

      <dl className="grid grid-cols-3 gap-2 text-center" aria-label="Workout stats">
        <Stat label="Duration"><Elapsed from={session.started_at} to={session.completed_at} /></Stat>
        <Stat label={`Volume (${unit})`}><NumberFlow value={Math.round(fromKg(volumeKg, unit) ?? 0)} /></Stat>
        <Stat label="Sets"><NumberFlow value={doneSets} />/{allSets.length}</Stat>
      </dl>

      <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
        <div
          className="h-full w-full origin-left bg-brand transition-transform duration-350 ease-out-quart"
          style={{ transform: `scaleX(${allSets.length ? doneSets / allSets.length : 0})` }}
        />
      </div>

      {completed && (
        <p className="rounded-xl bg-brand/10 p-3 text-sm text-brand-dark">
          This workout is complete. You can still correct any set. Changes save automatically.
        </p>
      )}

      {exercises.length === 0 && <p className="text-muted">This workout has no exercises.</p>}

      {exercises.map((ex) => (
        <ExerciseCard
          key={ex.id}
          ex={ex}
          unit={unit}
          prev={ex.exercise_id ? prevBy[ex.exercise_id] : undefined}
          onSetChange={(setId, patch) =>
            patchSession((s) => {
              const st = s.session_exercises!.flatMap((e) => e.session_sets).find((x) => x.id === setId);
              if (st) Object.assign(st, patch);
            })
          }
          onSetsReplaced={(sets) =>
            patchSession((s) => {
              const e = s.session_exercises!.find((x) => x.id === ex.id);
              if (e) e.session_sets = sets;
            })
          }
          // Undo of a removed set: works from the latest state, since other sets may have changed since.
          onSetRestored={(set) =>
            patchSession((s) => {
              const e = s.session_exercises!.find((x) => x.id === ex.id);
              if (e) e.session_sets = [...e.session_sets.filter((x) => x.id !== set.id), set].sort((a, b) => a.set_number - b.set_number);
            })
          }
          onCompleted={(set) => onSetCompleted(ex, set)}
        />
      ))}

      <SessionNotes session={session} />

      {error && <ErrorBox message={error} />}
      {!completed ? (
        <Button size="lg" className="w-full" onClick={() => (doneSets < allSets.length ? setConfirmFinish(true) : finish())} loading={finishing}>
          <Check className="size-5" /> Finish workout
        </Button>
      ) : (
        <Button size="lg" variant="secondary" className="w-full" onClick={() => router.push("/today")}>Done</Button>
      )}
      <p className="pb-4 text-center text-xs text-muted">Progress saves as you go. You can close the app and resume any time.</p>

      {/* Room for the floating rest timer, so it never covers the last sets or the Finish button. */}
      {rest && <div aria-hidden className="h-20" />}
      {rest && (
        <RestTimer
          rest={rest}
          onClose={() => setRest(null)}
          // −15 past zero ends the rest; the bar restarts from the new remaining share
          onAdjust={(sec) => setRest((r) => (r ? { until: r.until + sec * 1000, total: Math.max(1, r.total + sec) } : r))}
        />
      )}

      <ConfirmSheet
        open={confirmFinish}
        onOpenChange={setConfirmFinish}
        title="Finish with sets left?"
        description={`${doneSets} of ${allSets.length} sets are checked off. Unchecked sets won't count towards this workout.`}
        confirmLabel="Finish anyway"
        tone="primary"
        onConfirm={finish}
      />
    </div>
  );
}

function ExerciseCard({
  ex, unit, prev, onSetChange, onSetsReplaced, onSetRestored, onCompleted,
}: {
  ex: SessionExercise;
  unit: Unit;
  prev?: Prev[];
  onSetChange: (setId: string, patch: Partial<SessionSet>) => void;
  onSetsReplaced: (sets: SessionSet[]) => void;
  onSetRestored: (set: SessionSet) => void;
  onCompleted: (set: Pick<SessionSet, "weight_kg" | "reps" | "set_type">) => void;
}) {
  const supabase = createClient();
  const [notes, setNotes] = useState(ex.client_notes ?? "");
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<"warmup" | "plates" | null>(null);
  const prevMatched = useMemo(() => matchPrev(ex.session_sets, prev), [ex.session_sets, prev]);
  // The first working set's load (typed, else last time's): what warm-ups ramp to and the plate default.
  const firstWork = ex.session_sets.findIndex(isWorkingSet);
  const workingKg = firstWork < 0 ? null : (ex.session_sets[firstWork].weight_kg ?? prevMatched[firstWork]?.weight_kg ?? null);
  const hasWarmups = ex.session_sets.some((s) => !isWorkingSet(s));

  async function addWarmups(sets: { weight: number; reps: number }[]) {
    setBusy(true);
    const { data, error } = await supabase.rpc("add_warmup_sets", {
      p_session_exercise: ex.id,
      p_sets: sets.map((s) => ({ weight_kg: Number(toKg(s.weight, unit)!.toFixed(3)), reps: s.reps })),
    });
    setBusy(false);
    if (error) return notify.error(setRowError(error));
    setSheet(null);
    onSetsReplaced(data as SessionSet[]);
  }

  async function addSet() {
    setBusy(true);
    const next = (ex.session_sets.at(-1)?.set_number ?? 0) + 1;
    const { data, error } = await supabase
      .from("session_sets")
      .insert({ session_exercise_id: ex.id, set_number: next })
      .select()
      .single();
    setBusy(false);
    if (error) return notify.error(setRowError(error));
    onSetsReplaced([...ex.session_sets, data as SessionSet]);
  }

  async function removeSet() {
    const last = ex.session_sets.at(-1);
    if (!last) return;
    setBusy(true);
    const { error } = await supabase.from("session_sets").delete().eq("id", last.id);
    setBusy(false);
    if (error) return notify.error(setRowError(error));
    onSetsReplaced(ex.session_sets.slice(0, -1));
    // The removed set may hold logged reps and weight, so it can be put back exactly as it was.
    const row = { id: last.id, session_exercise_id: last.session_exercise_id, set_number: last.set_number, reps: last.reps, weight_kg: last.weight_kg, completed: last.completed, set_type: last.set_type, rpe: last.rpe };
    notify.undo(`Set ${last.set_number} removed`, async () => {
      const { data, error } = await createClient().from("session_sets").insert(row).select().single();
      if (error) return notify.error(setRowError(error));
      onSetRestored(data as SessionSet);
    });
  }

  async function saveNotes() {
    if ((ex.client_notes ?? "") === notes) return;
    const { error } = await supabase.from("session_exercises").update({ client_notes: notes || null }).eq("id", ex.id);
    if (error) notify.error(errMsg(error));
  }

  const prevWork = (prev ?? []).filter((p) => p.set_type !== "warmup");
  const lastTime = prevWork.length ? prevWork.map((p) => `${p.weight_kg != null ? fromKg(p.weight_kg, unit) : "BW"}×${p.reps ?? "-"}`).join(", ") : null;
  const labels = setLabels(ex.session_sets);

  return (
    <section className="rounded-2xl border border-line bg-surface" aria-label={ex.exercise_name}>
      <div className="border-b border-line px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-semibold leading-tight">{ex.exercise_name}</h2>
          <span className="shrink-0 text-xs font-semibold text-muted">
            {ex.target_sets} × {ex.rep_min === ex.rep_max ? ex.rep_min : `${ex.rep_min}-${ex.rep_max}`}
            {ex.target_rpe != null && ` @ RPE ${Number(ex.target_rpe)}`} · {ex.rest_seconds > 0 ? `rest ${fmtRest(ex.rest_seconds)}` : "no rest timer"}
          </span>
        </div>
        {ex.coach_notes && <p className="mt-0.5 text-xs text-brand-dark">Coach: {ex.coach_notes}</p>}
        <p className="mt-0.5 text-xs text-muted">
          Last time: {lastTime ? <span className="font-medium text-ink">{lastTime}</span> : "no previous log"}
        </p>
      </div>

      <div className="px-2 py-1">
        <div className="grid grid-cols-[2rem_4.5rem_1fr_1fr_3.25rem] items-center gap-1.5 px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          <span>Set</span>
          <span>Prev</span>
          <span className="text-center">{ex.is_bodyweight ? `+${unit}` : unit}</span>
          <span className="text-center">Reps</span>
          <span className="sr-only">Done</span>
        </div>
        {ex.session_sets.map((s, i) => (
          <SetRow
            key={s.id}
            sessionId={ex.session_id}
            set={s}
            label={labels[i]}
            exerciseName={ex.exercise_name}
            unit={unit}
            bodyweight={ex.is_bodyweight}
            prev={prevMatched[i]}
            targetRpe={ex.target_rpe}
            // Suggest from the nearest earlier set of the same kind, so a warm-up never seeds a working set.
            above={ex.session_sets.slice(0, i).findLast((x) => isWorkingSet(x) === isWorkingSet(s))}
            repTarget={ex.rep_max}
            onChange={(patch) => onSetChange(s.id, patch)}
            onCompleted={onCompleted}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-3 py-2">
        <Button variant="ghost" size="sm" onClick={addSet} disabled={busy} aria-label="Add set"><Plus className="size-4" aria-hidden /> Set</Button>
        <Button variant="ghost" size="sm" onClick={removeSet} disabled={busy || ex.session_sets.length <= 1} aria-label="Remove last set"><Minus className="size-4" aria-hidden /> Set</Button>
        {!ex.is_bodyweight && (
          <div className="ml-auto flex items-center gap-1">
            {!hasWarmups && (
              <Button variant="ghost" size="sm" onClick={() => setSheet("warmup")} disabled={busy} aria-label="Add warm-up sets">
                <Flame className="size-4" aria-hidden /> Warm-up
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setSheet("plates")} aria-label="Plate calculator" title="Plate calculator" className="px-2.5">
              <Calculator className="size-4" aria-hidden />
            </Button>
          </div>
        )}
      </div>
      <WarmupSheet open={sheet === "warmup"} onOpenChange={(o) => setSheet(o ? "warmup" : null)} exerciseName={ex.exercise_name}
        unit={unit} workingKg={workingKg} busy={busy} onAdd={addWarmups} />
      <PlateSheet open={sheet === "plates"} onOpenChange={(o) => setSheet(o ? "plates" : null)} exerciseName={ex.exercise_name}
        unit={unit} defaultKg={workingKg} />
      <div className="px-3 pb-3">
        <Textarea placeholder="Notes for this exercise (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} rows={1} className="min-h-11 text-sm" />
      </div>
    </section>
  );
}

function WarmupSheet({ open, onOpenChange, exerciseName, unit, workingKg, busy, onAdd }: {
  open: boolean; onOpenChange: (o: boolean) => void; exerciseName: string; unit: Unit; workingKg: number | null; busy: boolean;
  onAdd: (sets: { weight: number; reps: number }[]) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`Warm-up · ${exerciseName}`}>
      <WarmupBody key={String(workingKg)} unit={unit} workingKg={workingKg} busy={busy} onAdd={onAdd} />
    </Sheet>
  );
}

function WarmupBody({ unit, workingKg, busy, onAdd }: { unit: Unit; workingKg: number | null; busy: boolean; onAdd: (sets: { weight: number; reps: number }[]) => void }) {
  const [working, setWorking] = useState(workingKg != null ? String(fromKg(workingKg, unit)) : "");
  const sets = warmupRamp(parseNum(working) ?? 0, unit);
  return (
    <div className="space-y-3">
      <Field label={`Working weight (${unit})`} hint="Warm-ups ramp 40% × 10, 60% × 5, 80% × 3, rounded to the nearest loadable jump.">
        <NumInput decimal value={working} onChange={(e) => setWorking(e.target.value.replace(/[^0-9.,]/g, ""))} aria-label={`Working weight in ${unit}`} />
      </Field>
      {sets.length > 0 ? (
        <ol className="divide-y divide-line rounded-xl border border-line">
          {sets.map((s, i) => (
            <li key={i} className="flex items-center gap-3 px-3 py-2 tabular-nums">
              <span className="font-semibold text-warn">W</span>
              <span className="font-mono font-semibold">{s.weight} {unit}</span>
              <span className="text-muted">× {s.reps}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted">Enter the weight of your first working set to see the warm-ups.</p>
      )}
      <Button className="w-full" disabled={!sets.length} loading={busy} onClick={() => onAdd(sets)}>
        Add {sets.length || ""} warm-up set{sets.length === 1 ? "" : "s"}
      </Button>
    </div>
  );
}

const BAR_KEY = "coachly:bar-weight";

function PlateSheet({ open, onOpenChange, exerciseName, unit, defaultKg }: {
  open: boolean; onOpenChange: (o: boolean) => void; exerciseName: string; unit: Unit; defaultKg: number | null;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`Plates · ${exerciseName}`}>
      <PlateBody key={String(defaultKg)} unit={unit} defaultKg={defaultKg} />
    </Sheet>
  );
}

function PlateBody({ unit, defaultKg }: { unit: Unit; defaultKg: number | null }) {
  const [total, setTotal] = useState(defaultKg != null ? String(fromKg(defaultKg, unit)) : "");
  // The bar is a per-phone preference, so it's kept in this browser only.
  const [bar, setBar] = useState(() => {
    try {
      const v = Number(localStorage.getItem(`${BAR_KEY}:${unit}`));
      return BAR_OPTIONS[unit].includes(v) && localStorage.getItem(`${BAR_KEY}:${unit}`) !== null ? v : BAR_OPTIONS[unit][0];
    } catch {
      return BAR_OPTIONS[unit][0];
    }
  });
  function chooseBar(v: number) {
    setBar(v);
    try { localStorage.setItem(`${BAR_KEY}:${unit}`, String(v)); } catch { /* storage unavailable: the choice lasts this visit */ }
  }
  const t = parseNum(total);
  const result = t === null ? null : platesPerSide(t, bar, unit);
  const biggest = PLATES[unit][0];
  return (
    <div className="space-y-3">
      <Field label={`Total weight (${unit})`}>
        <NumInput decimal value={total} onChange={(e) => setTotal(e.target.value.replace(/[^0-9.,]/g, ""))} aria-label={`Total weight in ${unit}`} />
      </Field>
      <div>
        <p className="mb-1.5 text-sm font-medium">Bar</p>
        <div className="flex gap-1.5" role="radiogroup" aria-label="Bar weight">
          {BAR_OPTIONS[unit].map((v) => (
            <button key={v} type="button" role="radio" aria-checked={bar === v} onClick={() => chooseBar(v)}
              className={cn("h-10 flex-1 rounded-lg border text-sm font-semibold tabular-nums", bar === v ? "border-brand bg-brand text-brand-fg" : "border-line hover:bg-line/40")}>
              {v === 0 ? "None" : `${v} ${unit}`}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-line p-3" aria-live="polite">
        {t === null ? (
          <p className="text-sm text-muted">Enter a total weight.</p>
        ) : !result ? (
          <p className="text-sm text-muted">That&apos;s less than the bar ({bar} {unit}).</p>
        ) : result.plates.length === 0 ? (
          <p className="text-sm">Just the bar.</p>
        ) : (
          <>
            <p className="mb-2 text-sm font-medium">Each side</p>
            <div className="flex items-center gap-1" aria-hidden>
              <span className="h-2 w-6 rounded-sm bg-muted/50" />
              {result.plates.map((p, i) => (
                <span key={i} className="flex w-7 items-center justify-center rounded-md bg-ink font-mono text-[10px] font-semibold text-paper"
                  style={{ height: `${2 + (p / biggest) * 4}rem` }}>
                  {p}
                </span>
              ))}
            </div>
            <p className="mt-2 font-mono text-sm tabular-nums">{result.plates.join(" + ")} {unit}</p>
          </>
        )}
        {result && result.remainder > 0 && (
          <p className="mt-1 text-xs font-medium text-warn">{result.remainder} {unit} per side can&apos;t be loaded with standard plates.</p>
        )}
      </div>
    </div>
  );
}

function parseNum(s: string): number | null {
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

type SetPatch = Partial<Pick<SessionSet, "weight_kg" | "reps" | "completed" | "set_type" | "rpe">>;

function SetRow({
  sessionId, set, label, exerciseName, unit, bodyweight, prev, targetRpe, above, repTarget, onChange, onCompleted,
}: {
  sessionId: string; set: SessionSet; label: string; exerciseName: string; unit: Unit; bodyweight: boolean; prev?: Prev; targetRpe: number | null;
  above?: SessionSet; repTarget: number;
  onChange: (p: Partial<SessionSet>) => void; onCompleted: (set: Pick<SessionSet, "weight_kg" | "reps" | "set_type">) => void;
}) {
  const supabase = createClient();
  const [weight, setWeight] = useState(set.weight_kg != null ? String(fromKg(set.weight_kg, unit)) : "");
  const [reps, setReps] = useState(set.reps != null ? String(set.reps) : "");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [typeOpen, setTypeOpen] = useState(false);
  const [rpeOpen, setRpeOpen] = useState(false);
  const lastSaved = useRef<Required<SetPatch>>({ weight_kg: set.weight_kg, reps: set.reps, completed: set.completed, set_type: set.set_type, rpe: set.rpe });

  // Suggested values: the set above in this session, else the same set last time.
  const suggestW = above?.weight_kg ?? prev?.weight_kg ?? null;
  const suggestR = above?.reps ?? prev?.reps ?? null;

  async function save(patch: SetPatch) {
    const next = { ...lastSaved.current, ...patch };
    const cur = lastSaved.current;
    if ((Object.keys(next) as (keyof SetPatch)[]).every((k) => next[k] === cur[k])) return true;
    setState("saving");
    onChange(patch);
    queueSetPatch(set.id, sessionId, patch);
    const { error } = await supabase.from("session_sets").update(patch).eq("id", set.id);
    if (error) {
      setState("error");
      // the edit stays queued on this device and is re-sent when the workout reopens
      setErr(`Not synced yet (${errMsg(error)}). Kept on this phone.`);
      return false;
    }
    clearSetPatch(set.id, patch);
    lastSaved.current = next;
    setState("idle");
    setErr(null);
    return true;
  }

  function valueFromInputs() {
    const w = parseNum(weight);
    const r = parseNum(reps);
    return { weight_kg: w === null ? null : Number(toKg(w, unit)!.toFixed(3)), reps: r === null ? null : Math.round(r) };
  }

  async function toggle() {
    if (set.completed) return save({ completed: false });
    primeChime(); // unlock audio inside this tap so the rest timer can chime later (iOS)
    let { weight_kg, reps: r } = valueFromInputs();
    // Tapping ✓ on an empty row accepts the suggested values.
    if (r === null && suggestR !== null) {
      r = suggestR;
      setReps(String(r));
    }
    if (weight_kg === null && suggestW !== null && !bodyweight) {
      weight_kg = suggestW;
      setWeight(String(fromKg(weight_kg, unit)));
    }
    if (r === null) {
      setState("error");
      setErr("Enter reps first");
      return;
    }
    const ok = await save({ weight_kg, reps: r, completed: true });
    if (ok) {
      onCompleted({ weight_kg, reps: r, set_type: set.set_type });
      // The coach asked for an effort rating on this exercise, so offer the choices straight away.
      if (targetRpe != null && isWorkingSet(set) && set.rpe == null) setRpeOpen(true);
    }
  }

  function chooseRpe(v: number) {
    setRpeOpen(false);
    // Tapping the current value again clears it.
    void save({ rpe: set.rpe != null && Number(set.rpe) === v ? null : v });
  }

  function chooseType(t: SetType) {
    setTypeOpen(false);
    void save({ set_type: t });
  }

  const prevLabel = prev ? `${prev.weight_kg != null ? fromKg(prev.weight_kg, unit) : "BW"}×${prev.reps ?? "-"}` : "-";
  const info = setTypeInfo(set.set_type);

  return (
    <div className={cn("rounded-xl", set.completed && "bg-brand/5")}>
      <div className="grid grid-cols-[2rem_4.5rem_1fr_1fr_3.25rem] items-center gap-1.5 px-1 py-1">
        <button
          type="button"
          onClick={() => setTypeOpen(true)}
          aria-label={`Set ${label}: ${info.label}. Change set type`}
          className={cn(
            "flex h-12 items-center justify-center rounded-lg font-semibold tabular-nums transition-colors hover:bg-line/60 active:scale-95",
            SET_TYPE_TONE[set.set_type],
          )}
        >
          {label}
        </button>
        <span className="truncate text-xs tabular-nums text-muted" title="Last time">{prevLabel}</span>
        <input
          aria-label={`Set ${label} weight in ${unit}`}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="next"
          className="h-12 w-full rounded-xl border border-line bg-surface text-center font-mono text-lg font-semibold tabular-nums transition-[border-color,box-shadow] duration-150 placeholder:font-normal placeholder:text-muted focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15"
          placeholder={bodyweight ? "BW" : suggestW != null ? String(fromKg(suggestW, unit)) : unit}
          value={weight}
          onChange={(e) => setWeight(e.target.value.replace(/[^0-9.,]/g, ""))}
          onBlur={() => save({ weight_kg: valueFromInputs().weight_kg })}
        />
        <input
          aria-label={`Set ${label} reps`}
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
          className="h-12 w-full rounded-xl border border-line bg-surface text-center font-mono text-lg font-semibold tabular-nums transition-[border-color,box-shadow] duration-150 placeholder:font-normal placeholder:text-muted focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15"
          placeholder={suggestR != null ? String(suggestR) : String(repTarget)}
          value={reps}
          onChange={(e) => setReps(e.target.value.replace(/[^0-9]/g, ""))}
          onBlur={() => save({ reps: valueFromInputs().reps })}
        />
        <button
          onClick={toggle}
          aria-label={set.completed ? `Mark set ${label} not done` : `Complete set ${label}`}
          aria-pressed={set.completed}
          aria-busy={state === "saving"}
          className={cn(
            "flex h-12 w-full items-center justify-center rounded-xl border-2 transition-[background-color,border-color,color,transform] duration-150 active:scale-95",
            set.completed ? "border-brand bg-brand text-brand-fg shadow-raised" : "border-line bg-surface text-muted hover:border-muted/40",
            state === "saving" && "opacity-60",
          )}
        >
          <Check className="size-6" strokeWidth={3} />
        </button>
      </div>
      {set.completed && isWorkingSet(set) && (
        <div className="px-1 pb-1.5">
          <button
            type="button"
            onClick={() => setRpeOpen((o) => !o)}
            aria-expanded={rpeOpen}
            aria-label={`Set ${label} effort (RPE): ${set.rpe != null ? Number(set.rpe) : "not rated"}`}
            className="ml-[2.375rem] rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-line/60"
          >
            RPE <span className="font-mono font-semibold text-ink">{set.rpe != null ? Number(set.rpe) : "–"}</span>
            {targetRpe != null && <span> · target {Number(targetRpe)}</span>}
          </button>
          {rpeOpen && (
            <div className="mt-1 flex gap-1" role="radiogroup" aria-label={`Set ${label} RPE`}>
              {RPE_CHOICES.map((v) => {
                const on = set.rpe != null && Number(set.rpe) === v;
                return (
                  <button key={v} type="button" role="radio" aria-checked={on} onClick={() => chooseRpe(v)}
                    className={cn(
                      "h-10 min-w-0 flex-1 rounded-lg border font-mono text-sm font-semibold tabular-nums transition-colors active:scale-95",
                      on ? "border-brand bg-brand text-brand-fg" : "border-line bg-surface hover:bg-line/40",
                      targetRpe != null && Number(targetRpe) === v && !on && "border-brand/60",
                    )}>
                    {v}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {state === "error" && (
        <p className="flex items-center gap-2 px-2 pb-1 text-xs font-medium text-danger" role="alert">
          {err ?? "Couldn't save"}
          {err !== "Enter reps first" && (
            <button className="underline" onClick={() => save({ ...valueFromInputs(), set_type: set.set_type, rpe: set.rpe })}>Retry</button>
          )}
        </p>
      )}
      <Sheet open={typeOpen} onOpenChange={setTypeOpen} title={`Set ${label} · ${exerciseName}`}>
        <ul className="space-y-1.5" role="radiogroup" aria-label="Set type">
          {SET_TYPES.map((t) => {
            const on = t.type === set.set_type;
            return (
              <li key={t.type}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => chooseType(t.type)}
                  className={cn(
                    "flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
                    on ? "border-brand bg-brand/8" : "border-line hover:bg-line/40",
                  )}
                >
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-paper font-semibold", SET_TYPE_TONE[t.type])} aria-hidden>
                    {t.short || "#"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{t.label}</span>
                    <span className="block text-xs text-muted">{t.hint}</span>
                  </span>
                  {on && <Check className="size-5 shrink-0 text-brand" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </div>
  );
}

function SessionNotes({ session }: { session: Session }) {
  const supabase = createClient();
  const [notes, setNotes] = useState(session.notes ?? "");
  const [saved, setSaved] = useState(false);
  async function save() {
    if ((session.notes ?? "") === notes) return;
    const { error } = await supabase.from("workout_sessions").update({ notes: notes || null }).eq("id", session.id);
    setSaved(!error);
  }
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <label className="text-sm font-semibold" htmlFor="session-notes">Workout notes</label>
      <Textarea id="session-notes" className="mt-1 text-sm" rows={2} placeholder="How did it feel? Anything for your coach?" value={notes}
        onChange={(e) => { setNotes(e.target.value); setSaved(false); }} onBlur={save} />
      {saved && <p className="mt-1 text-xs text-muted">Saved</p>}
    </div>
  );
}

const timerBtn =
  "flex h-11 min-w-11 items-center justify-center rounded-xl bg-paper/10 px-2 font-mono text-sm font-semibold tabular-nums transition-colors hover:bg-paper/20 active:scale-95 disabled:opacity-40";

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-2 py-1.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="font-mono text-lg font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

/** Live workout clock. Stops at completed_at. Shows a dash for implausible spans (a session left open for days). */
function Elapsed({ from, to }: { from: string; to: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (to) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [to]);
  const sec = Math.floor(((to ? new Date(to).getTime() : now) - new Date(from).getTime()) / 1000);
  if (!(sec >= 0) || sec > 12 * 3600) return <>—</>;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return <>{h ? `${h}:${String(m).padStart(2, "0")}` : m}:{String(s).padStart(2, "0")}</>;
}

function RestTimer({ rest, onClose, onAdjust }: { rest: { until: number; total: number }; onClose: () => void; onAdjust: (sec: number) => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((rest.until - now) / 1000));
  // The bar drains in one linear transition over the whole rest, rather than stepping with the
  // once-a-second countdown. Restarts when a new rest begins while the timer is still showing.
  const bar = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const ms = Math.max(0, rest.until - Date.now());
    el.style.transition = "none";
    el.style.transform = `scaleX(${rest.total ? Math.min(1, ms / (rest.total * 1000)) : 0})`;
    void el.offsetWidth; // commit the start width before transitioning away from it
    el.style.transition = `transform ${ms}ms linear`;
    el.style.transform = "scaleX(0)";
  }, [rest.until, rest.total]);
  useEffect(() => {
    if (left === 0) {
      navigator.vibrate?.(200);
      playChime();
      const t = setTimeout(onClose, 2500);
      return () => clearTimeout(t);
    }
  }, [left, onClose]);
  return (
    <div className="fixed inset-x-3 z-40 flex animate-enter items-center gap-3 overflow-hidden rounded-2xl bg-ink p-3 pl-4 text-paper shadow-[0_16px_40px_-12px_rgb(2_6_23/0.5)] md:left-auto md:right-8 md:w-80"
      style={{ bottom: "calc(4.75rem + env(safe-area-inset-bottom))" }} role="timer" aria-live="polite">
      <Timer className="size-6 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-paper/70">{left === 0 ? "Rest done. Next set!" : "Rest"}</p>
        <p className="font-mono text-2xl font-semibold tabular-nums">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</p>
      </div>
      <button onClick={() => onAdjust(-15)} disabled={left === 0} className={timerBtn} aria-label="15 seconds less rest">−15</button>
      <button onClick={() => onAdjust(15)} className={timerBtn} aria-label="15 seconds more rest">+15</button>
      <button onClick={onClose} className={cn(timerBtn, "w-11 px-0")} aria-label={left === 0 ? "Dismiss rest timer" : "Skip rest"}>
        <X className="size-5" />
      </button>
      {/* remaining-rest bar */}
      <span ref={bar} aria-hidden className="absolute inset-x-0 bottom-0 h-1 origin-left bg-brand" />
    </div>
  );
}
