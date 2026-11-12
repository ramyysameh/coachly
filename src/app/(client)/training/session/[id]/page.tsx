"use client";
import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, Minus, Plus, Timer, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { SESSION_SELECT, sortSession, type Session, type SessionExercise, type SessionSet } from "@/lib/data";
import { useProfile } from "@/components/AppShell";
import { Badge, Button, ErrorBox, Spinner, Textarea } from "@/components/ui";
import { cn, errMsg, fmtDate, fmtRest, fromKg, toKg, type Unit } from "@/lib/utils";
import { clearSetPatch, flushPendingSets, pendingPatchesFor, queueSetPatch } from "@/lib/pendingSets";

type Prev = { exercise_id: string; performed_on: string; set_number: number; reps: number | null; weight_kg: number | null };

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const supabase = createClient();
  const { profile } = useProfile();
  const unit = profile.weight_unit;
  const [rest, setRest] = useState<{ until: number; total: number } | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, loading, error: loadError, reload, setData } = useAsync(async () => {
    // send set edits that didn't reach the server last time (app closed / offline)
    await flushPendingSets(supabase, id);
    const [s, prev] = await Promise.all([
      supabase.from("workout_sessions").select(SESSION_SELECT).eq("id", id).maybeSingle(),
      supabase.rpc("last_performance", { p_session: id }),
    ]);
    const session = sortSession(must(s) as Session | null);
    if (!session) throw new Error("Workout not found");
    // Show edits made on this phone that haven't reached the server yet.
    const pending = pendingPatchesFor(id);
    session.session_exercises?.forEach((e) => e.session_sets.forEach((st) => Object.assign(st, pending[st.id] ?? {})));
    // "Last time" numbers are nice to have — offline the workout still opens without them.
    const prevBy: Record<string, Prev[]> = {};
    for (const p of prev.error ? [] : ((prev.data as Prev[]) ?? [])) (prevBy[p.exercise_id] ??= []).push(p);
    return { session, prevBy };
  }, [id]);

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
    router.push("/today?done=1");
  }

  if (loading) return <Spinner label="Loading workout…" />;
  if (loadError || !data) return <ErrorBox message={loadError ?? "Workout not found"} onRetry={reload} />;

  const { session, prevBy } = data;
  const exercises = session.session_exercises ?? [];
  const allSets = exercises.flatMap((e) => e.session_sets);
  const doneSets = allSets.filter((s) => s.completed).length;
  const completed = session.status === "completed";

  return (
    <div className="-mx-1 space-y-3">
      <div className="flex items-center gap-2">
        <Link href="/today" className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-line/60" aria-label="Back">
          <ChevronLeft className="size-6" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{session.name}</h1>
          <p className="text-xs text-muted">
            {fmtDate(session.scheduled_date)} · {doneSets}/{allSets.length} sets
          </p>
        </div>
        {completed ? <Badge tone="brand">Completed</Badge> : <Badge tone="warn">In progress</Badge>}
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="h-full bg-brand transition-all" style={{ width: `${allSets.length ? (doneSets / allSets.length) * 100 : 0}%` }} />
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
          onCompleted={() => !completed && setRest({ until: Date.now() + ex.rest_seconds * 1000, total: ex.rest_seconds })}
        />
      ))}

      <SessionNotes session={session} />

      {error && <ErrorBox message={error} />}
      {!completed ? (
        <Button size="lg" className="w-full" onClick={finish} loading={finishing}>
          <Check className="size-5" /> Finish workout
        </Button>
      ) : (
        <Button size="lg" variant="secondary" className="w-full" onClick={() => router.push("/today")}>Done</Button>
      )}
      <p className="pb-4 text-center text-xs text-muted">Progress saves as you go. You can close the app and resume any time.</p>

      {rest && <RestTimer rest={rest} onClose={() => setRest(null)} />}
    </div>
  );
}

function ExerciseCard({
  ex, unit, prev, onSetChange, onSetsReplaced, onCompleted,
}: {
  ex: SessionExercise;
  unit: Unit;
  prev?: Prev[];
  onSetChange: (setId: string, patch: Partial<SessionSet>) => void;
  onSetsReplaced: (sets: SessionSet[]) => void;
  onCompleted: () => void;
}) {
  const supabase = createClient();
  const [notes, setNotes] = useState(ex.client_notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevBySet = useMemo(() => Object.fromEntries((prev ?? []).map((p) => [p.set_number, p])), [prev]);

  async function addSet() {
    setBusy(true);
    setError(null);
    const next = (ex.session_sets.at(-1)?.set_number ?? 0) + 1;
    const { data, error } = await supabase
      .from("session_sets")
      .insert({ session_exercise_id: ex.id, set_number: next })
      .select()
      .single();
    setBusy(false);
    if (error) return setError(errMsg(error));
    onSetsReplaced([...ex.session_sets, data as SessionSet]);
  }

  async function removeSet() {
    const last = ex.session_sets.at(-1);
    if (!last) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("session_sets").delete().eq("id", last.id);
    setBusy(false);
    if (error) return setError(errMsg(error));
    onSetsReplaced(ex.session_sets.slice(0, -1));
  }

  async function saveNotes() {
    if ((ex.client_notes ?? "") === notes) return;
    const { error } = await supabase.from("session_exercises").update({ client_notes: notes || null }).eq("id", ex.id);
    if (error) setError(errMsg(error));
  }

  const lastTime = prev?.length ? prev.map((p) => `${p.weight_kg != null ? fromKg(p.weight_kg, unit) : "BW"}×${p.reps ?? "-"}`).join(", ") : null;

  return (
    <section className="rounded-2xl border border-line bg-surface" aria-label={ex.exercise_name}>
      <div className="border-b border-line px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-semibold leading-tight">{ex.exercise_name}</h2>
          <span className="shrink-0 text-xs font-semibold text-muted">
            {ex.target_sets} × {ex.rep_min === ex.rep_max ? ex.rep_min : `${ex.rep_min}-${ex.rep_max}`} · rest {fmtRest(ex.rest_seconds)}
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
            unit={unit}
            bodyweight={ex.is_bodyweight}
            prev={prevBySet[s.set_number]}
            above={ex.session_sets[i - 1]}
            repTarget={ex.rep_max}
            onChange={(patch) => onSetChange(s.id, patch)}
            onCompleted={onCompleted}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-3 py-2">
        <Button variant="ghost" size="sm" onClick={addSet} disabled={busy}><Plus className="size-4" /> Set</Button>
        <Button variant="ghost" size="sm" onClick={removeSet} disabled={busy || ex.session_sets.length <= 1}><Minus className="size-4" /> Set</Button>
      </div>
      <div className="px-3 pb-3">
        <Textarea placeholder="Notes for this exercise (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} rows={1} className="min-h-11 text-sm" />
      </div>
      {error && <p className="px-3 pb-3 text-sm text-danger" role="alert">{error}</p>}
    </section>
  );
}

function parseNum(s: string): number | null {
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

function SetRow({
  sessionId, set, unit, bodyweight, prev, above, repTarget, onChange, onCompleted,
}: {
  sessionId: string; set: SessionSet; unit: Unit; bodyweight: boolean; prev?: Prev; above?: SessionSet; repTarget: number;
  onChange: (p: Partial<SessionSet>) => void; onCompleted: () => void;
}) {
  const supabase = createClient();
  const [weight, setWeight] = useState(set.weight_kg != null ? String(fromKg(set.weight_kg, unit)) : "");
  const [reps, setReps] = useState(set.reps != null ? String(set.reps) : "");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const lastSaved = useRef({ weight_kg: set.weight_kg, reps: set.reps, completed: set.completed });

  // Suggested values: the set above in this session, else the same set last time.
  const suggestW = above?.weight_kg ?? prev?.weight_kg ?? null;
  const suggestR = above?.reps ?? prev?.reps ?? null;

  async function save(patch: Partial<Pick<SessionSet, "weight_kg" | "reps" | "completed">>) {
    const next = { ...lastSaved.current, ...patch };
    if (next.weight_kg === lastSaved.current.weight_kg && next.reps === lastSaved.current.reps && next.completed === lastSaved.current.completed) return true;
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
    if (ok) onCompleted();
  }

  const prevLabel = prev ? `${prev.weight_kg != null ? fromKg(prev.weight_kg, unit) : "BW"}×${prev.reps ?? "-"}` : "-";

  return (
    <div className={cn("rounded-xl", set.completed && "bg-brand/5")}>
      <div className="grid grid-cols-[2rem_4.5rem_1fr_1fr_3.25rem] items-center gap-1.5 px-1 py-1">
        <span className="text-center font-semibold text-muted">{set.set_number}</span>
        <span className="truncate text-xs tabular-nums text-muted" title="Last time">{prevLabel}</span>
        <input
          aria-label={`Set ${set.set_number} weight in ${unit}`}
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
          aria-label={`Set ${set.set_number} reps`}
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
          aria-label={set.completed ? `Mark set ${set.set_number} not done` : `Complete set ${set.set_number}`}
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
      {state === "error" && (
        <p className="flex items-center gap-2 px-2 pb-1 text-xs font-medium text-danger" role="alert">
          {err ?? "Couldn't save"}
          {err !== "Enter reps first" && (
            <button className="underline" onClick={() => save(valueFromInputs())}>Retry</button>
          )}
        </p>
      )}
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

function RestTimer({ rest, onClose }: { rest: { until: number; total: number }; onClose: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((rest.until - now) / 1000));
  useEffect(() => {
    if (left === 0) {
      navigator.vibrate?.(200);
      const t = setTimeout(onClose, 2500);
      return () => clearTimeout(t);
    }
  }, [left, onClose]);
  return (
    <div className="fixed inset-x-3 z-40 flex animate-enter items-center gap-3 overflow-hidden rounded-2xl bg-ink p-3 pl-4 text-paper shadow-[0_16px_40px_-12px_rgb(2_6_23/0.5)] md:left-auto md:right-8 md:w-80"
      style={{ bottom: "calc(4.75rem + env(safe-area-inset-bottom))" }} role="timer" aria-live="polite">
      <Timer className="size-6 shrink-0" aria-hidden />
      <div className="flex-1">
        <p className="text-xs text-paper/70">{left === 0 ? "Rest done. Next set!" : "Rest"}</p>
        <p className="font-mono text-2xl font-semibold tabular-nums">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</p>
      </div>
      <button onClick={onClose} className="flex size-11 items-center justify-center rounded-xl bg-paper/10 transition-colors hover:bg-paper/20 active:scale-95" aria-label="Dismiss rest timer">
        <X className="size-5" />
      </button>
      {/* remaining-rest bar */}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-1 origin-left bg-brand transition-transform duration-300 ease-linear"
        style={{ transform: `scaleX(${rest.total ? left / rest.total : 0})` }}
      />
    </div>
  );
}
