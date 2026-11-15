"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowLeftRight, ArrowUp, ChevronLeft, Copy, Info, Link2, Plus, Trash2, UserPlus, X } from "lucide-react";
import { isLinkedToNext, supersetRuns, toggleSupersetLink } from "@/lib/workout";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { PLAN_SELECT, sortPlan, type Exercise, type Plan, type PlanDay, type PlanExercise } from "@/lib/data";
import { ExerciseBrowser, ExerciseThumb, useLibrary, variantLabel } from "@/components/ExerciseLibrary";
import { useProfile } from "@/components/AppShell";
import { ConfirmSheet, Sheet, useSheet } from "@/components/Sheet";
import { Badge, Button, Empty, ErrorBox, Field, Input, NumInput, Select, Spinner, Textarea } from "@/components/ui";
import { cn, errMsg, fmtDate, localDate, WEEKDAYS } from "@/lib/utils";
import { notify } from "@/lib/notify";

type Result = { error: { message: string } | null };
type WriteFn = (fn: () => PromiseLike<Result>[] | PromiseLike<Result>) => Promise<boolean>;
type Targets = Pick<PlanExercise, "target_sets" | "rep_min" | "rep_max" | "rest_seconds">;

/**
 * Starting targets for a newly added exercise, so the coach only tweaks instead of retyping every row.
 * Timed holds use seconds; isolation/core work goes higher-rep with short rest; heavy barbell
 * squats and hinges get low reps and long rest; everything else lands in the usual hypertrophy range.
 */
function defaultTargets(ex: Exercise): Targets {
  const pattern = ex.movements?.pattern;
  if (ex.timed) return { target_sets: 3, rep_min: 30, rep_max: 60, rest_seconds: 60 };
  if (pattern === "isolation" || pattern === "core") return { target_sets: 3, rep_min: 10, rep_max: 15, rest_seconds: 60 };
  if (ex.is_bodyweight) return { target_sets: 3, rep_min: 8, rep_max: 15, rest_seconds: 90 };
  if ((pattern === "squat" || pattern === "hinge") && (ex.equipment === "Barbell" || ex.equipment === "Trap Bar")) {
    return { target_sets: 3, rep_min: 5, rep_max: 8, rest_seconds: 180 };
  }
  return { target_sets: 3, rep_min: 8, rep_max: 12, rest_seconds: 120 };
}

/** Rough session length: ~40 s of work per set plus the prescribed rest. */
function estimateMinutes(day: PlanDay) {
  const sec = day.plan_exercises.reduce((n, pe) => n + pe.target_sets * (40 + pe.rest_seconds), 0);
  return Math.round(sec / 60 / 5) * 5;
}

export default function PlanBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const supabase = createClient();
  const picker = useSheet<PlanDay>();
  const swapping = useSheet<PlanExercise>();
  const deleting = useSheet<PlanDay>();
  const assigning = useSheet<Plan>();
  const [nameError, setNameError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const inFlight = useRef(0);
  const failedSinceIdle = useRef(false);
  // The picker stays open so a coach can add a whole day in one go. Positions count up from where the
  // day ended when the picker opened, since `picker.item` is a snapshot that doesn't see the new rows.
  const [added, setAdded] = useState<ReadonlyMap<string, number>>(new Map());
  const nextPosition = useRef(0);

  const { data, loading, error, reload } = useAsync(async () => {
    const plan = sortPlan(must(await supabase.from("plans").select(PLAN_SELECT).eq("id", id).maybeSingle()) as Plan | null);
    let clientName: string | null = null;
    if (plan?.client_id) {
      const { data: c } = await supabase.from("profiles").select("full_name").eq("id", plan.client_id).maybeSingle();
      clientName = c?.full_name ?? null;
    }
    return plan ? { plan, clientName } : null;
  }, [id]);

  /** Runs a write, reports errors, then refreshes the plan quietly. Tracks "Saving…" across overlapping writes. */
  const write: WriteFn = async (fn) => {
    inFlight.current++;
    setStatus("saving");
    const results = await Promise.all([fn()].flat());
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      failedSinceIdle.current = true;
      notify.error(errMsg(failed.error));
    }
    await reload({ silent: true });
    if (--inFlight.current === 0) {
      setStatus(failedSinceIdle.current ? "error" : "saved");
      failedSinceIdle.current = false;
    }
    return !failed;
  };

  if (loading) return <Spinner label="Loading plan…" />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Empty title="Plan not found">It may have been deleted, or it isn&apos;t yours. <Link className="font-semibold text-brand" href="/coach/plans">Back to plans</Link></Empty>;

  const { plan, clientName } = data;
  const dayCount: Record<number, number> = {};
  plan.plan_days.forEach((d) => d.weekdays.forEach((w) => (dayCount[w] = (dayCount[w] ?? 0) + 1)));
  const clashes = Object.entries(dayCount).filter(([, n]) => n > 1).map(([w]) => WEEKDAYS[Number(w) - 1]);
  const totalExercises = plan.plan_days.reduce((n, d) => n + d.plan_exercises.length, 0);
  const statusText = { idle: "Changes save automatically", saving: "Saving…", saved: "All changes saved", error: "Some changes didn't save" }[status];

  /** Swaps two neighbours and writes only the rows whose position actually changed. */
  function move<T extends { id: string; position: number }>(table: "plan_days" | "plan_exercises", list: T[], index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    const order = [...list];
    [order[index], order[j]] = [order[j], order[index]];
    return write(() => order.flatMap((item, pos) => (item.position === pos ? [] : [supabase.from(table).update({ position: pos }).eq("id", item.id)])));
  }

  /** Copies a day (with its exercises) to the end of the plan. The copy is unscheduled so it never clashes. */
  function duplicateDay(day: PlanDay) {
    return write(async () => {
      const { data: nd, error } = await supabase.from("plan_days")
        .insert({ plan_id: plan.id, name: `${day.name} (copy)`, position: plan.plan_days.length, weekdays: [] })
        .select("id").single();
      if (error) return { error };
      if (!day.plan_exercises.length) return { error: null };
      return await supabase.from("plan_exercises").insert(day.plan_exercises.map((pe) => ({
        plan_day_id: nd.id, exercise_id: pe.exercise_id, position: pe.position, target_sets: pe.target_sets, rep_min: pe.rep_min,
        rep_max: pe.rep_max, rest_seconds: pe.rest_seconds, notes: pe.notes, target_rpe: pe.target_rpe, superset_group: pe.superset_group,
      })));
    });
  }

  async function swapExercise(pe: PlanExercise, ex: Exercise) {
    swapping.close();
    if (ex.id === pe.exercise_id) return;
    // Switching between a timed hold and a rep exercise changes what the targets mean, so reset them.
    const reset = ex.timed !== pe.exercises.timed ? { rep_min: defaultTargets(ex).rep_min, rep_max: defaultTargets(ex).rep_max } : {};
    const before = { exercise_id: pe.exercise_id, rep_min: pe.rep_min, rep_max: pe.rep_max };
    if (!(await write(() => supabase.from("plan_exercises").update({ exercise_id: ex.id, ...reset }).eq("id", pe.id)))) return;
    notify.undo(`Swapped to ${ex.name}`, async () => { await write(() => supabase.from("plan_exercises").update(before).eq("id", pe.id)); });
  }

  return (
    <div className="space-y-4">
      <Link href={plan.client_id ? `/coach/clients/${plan.client_id}` : "/coach/plans"} className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-muted">
        <ChevronLeft className="size-4" /> {plan.client_id ? `Back to ${clientName ?? "client"}` : "All templates"}
      </Link>

      <section className="space-y-3 rounded-2xl border border-line bg-surface p-4" aria-label="Plan details">
        <div className="flex flex-wrap items-center gap-2">
          {plan.client_id ? <Badge tone="brand">Assigned to {clientName}</Badge> : <Badge>Template</Badge>}
          <span className="text-xs text-muted">{plan.plan_days.length} days · {totalExercises} exercises</span>
          <span className={cn("ml-auto text-xs", status === "error" ? "font-semibold text-danger" : "text-muted")} role="status">{statusText}</span>
        </div>
        <Field label="Plan name" error={nameError}>
          <Input defaultValue={plan.name} onBlur={(e) => {
            const v = e.target.value.trim();
            if (!v) { e.target.value = plan.name; return setNameError("Plan name can't be empty."); }
            setNameError(null);
            if (v !== plan.name) write(() => supabase.from("plans").update({ name: v }).eq("id", plan.id));
          }} />
        </Field>
        <Field label="Description (optional)">
          <Textarea rows={2} defaultValue={plan.description ?? ""} onBlur={(e) => e.target.value !== (plan.description ?? "") && write(() => supabase.from("plans").update({ description: e.target.value || null }).eq("id", plan.id))} />
        </Field>
        {plan.client_id ? (
          <>
            <Field label="Start date">
              <Input type="date" defaultValue={plan.start_date ?? ""} onBlur={(e) => e.target.value && e.target.value !== plan.start_date && write(() => supabase.from("plans").update({ start_date: e.target.value }).eq("id", plan.id))} />
            </Field>
            <p className="flex gap-2 rounded-xl bg-brand/5 p-3 text-sm text-brand-dark">
              <Info className="mt-0.5 size-4 shrink-0" />
              Edits apply to future workouts. Sessions {clientName ?? "the client"} has already started or completed keep the targets they had at the time.
              {plan.start_date && ` Plan runs from ${fmtDate(plan.start_date)}.`}
            </p>
          </>
        ) : (
          <Button variant="secondary" className="w-full sm:w-auto" disabled={totalExercises === 0} onClick={() => assigning.show(plan)}>
            <UserPlus className="size-4" /> Assign to a client
          </Button>
        )}
      </section>

      {clashes.length > 0 && <p className="flex gap-2 rounded-xl border border-warn-line bg-warn-bg p-3 text-sm text-warn"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />More than one workout is scheduled on {clashes.join(", ")}. Clients will see the first one listed.</p>}

      {plan.plan_days.length === 0 && <Empty title="No workout days yet">Add a day such as &quot;Push&quot; or &quot;Upper&quot;, pick the weekdays it runs, then add exercises.</Empty>}

      {plan.plan_days.map((day, di) => (
        <DayCard
          key={day.id}
          day={day}
          first={di === 0}
          last={di === plan.plan_days.length - 1}
          write={write}
          onMove={(dir) => move("plan_days", plan.plan_days, di, dir)}
          onMoveExercise={(i, dir) => move("plan_exercises", day.plan_exercises, i, dir)}
          onSwapExercise={(pe) => swapping.show(pe)}
          onAddExercise={() => {
            nextPosition.current = day.plan_exercises.length;
            setAdded(new Map());
            picker.show(day);
          }}
          onDuplicate={() => duplicateDay(day)}
          onDelete={() => deleting.show(day)}
        />
      ))}

      <Button
        variant="secondary"
        className="w-full"
        onClick={() => write(() => supabase.from("plan_days").insert({ plan_id: plan.id, name: `Day ${plan.plan_days.length + 1}`, position: plan.plan_days.length, weekdays: [] }))}
      >
        <Plus className="size-4" /> Add workout day
      </Button>

      <ConfirmSheet
        {...deleting.bind}
        title="Delete day?"
        description={deleting.item ? `Delete "${deleting.item.name}" and its exercises? Logged workouts are kept.` : undefined}
        confirmLabel="Delete day"
        onConfirm={async () => {
          const day = deleting.item!;
          // ConfirmSheet toasts a thrown error, so don't go through write() (it toasts too).
          const { error } = await supabase.from("plan_days").delete().eq("id", day.id);
          if (error) throw error;
          setStatus("saved");
          await reload({ silent: true });
        }}
      />

      <ExercisePicker
        {...picker.bind}
        dayName={picker.item?.name ?? ""}
        added={added}
        onDone={picker.close}
        onPick={async (ex) => {
          const day = picker.item;
          if (!day) return;
          const position = nextPosition.current++;
          const ok = await write(() => supabase.from("plan_exercises").insert({ plan_day_id: day.id, exercise_id: ex.id, position, ...defaultTargets(ex) }));
          if (ok) setAdded((m) => new Map(m).set(ex.id, (m.get(ex.id) ?? 0) + 1));
        }}
      />

      <Sheet {...swapping.bind} title={swapping.item ? `Swap ${swapping.item.exercises.name}` : "Swap exercise"}>
        {swapping.item && <SwapBody current={swapping.item} onSwap={(ex) => swapExercise(swapping.item!, ex)} />}
      </Sheet>

      <Sheet {...assigning.bind} title="Assign to a client">
        {assigning.item && <AssignBody key={assigning.key} template={assigning.item} />}
      </Sheet>
    </div>
  );
}

function DayCard({ day, first, last, write, onMove, onMoveExercise, onSwapExercise, onAddExercise, onDuplicate, onDelete }: {
  day: PlanDay; first: boolean; last: boolean; write: WriteFn;
  onMove: (dir: -1 | 1) => void; onMoveExercise: (i: number, dir: -1 | 1) => void; onSwapExercise: (pe: PlanExercise) => void;
  onAddExercise: () => void; onDuplicate: () => void; onDelete: () => void;
}) {
  const supabase = createClient();
  // Weekday taps show at once and their writes run one after another. Each tap builds on the previous
  // tap (not on `day`, which only updates after a reload), so quick taps on Mon then Wed keep both.
  const [optimistic, setOptimistic] = useState<number[] | null>(null);
  const latest = useRef<number[]>(day.weekdays);
  const pending = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const weekdays = optimistic ?? day.weekdays;
  function toggleDay(w: number) {
    const base = pending.current ? latest.current : day.weekdays;
    const next = base.includes(w) ? base.filter((x) => x !== w) : [...base, w].sort((a, b) => a - b);
    latest.current = next;
    setOptimistic(next);
    pending.current++;
    queue.current = queue.current
      .then(() => write(() => supabase.from("plan_days").update({ weekdays: next }).eq("id", day.id)))
      .finally(() => {
        // Once the last write is in, show the reloaded server copy (it equals `next` unless a write failed).
        if (--pending.current === 0) setOptimistic(null);
      });
  }
  const groups = day.plan_exercises.map((pe) => pe.superset_group);
  const inSuperset = groups.map(() => false);
  supersetRuns(day.plan_exercises).forEach((r) => r.superset && r.items.forEach((_, k) => (inSuperset[r.start + k] = true)));
  function toggleLink(i: number) {
    const next = toggleSupersetLink(groups, i);
    const changed = day.plan_exercises.filter((pe, k) => pe.superset_group !== next[k]);
    write(() => changed.map((pe) => supabase.from("plan_exercises").update({ superset_group: next[day.plan_exercises.indexOf(pe)] }).eq("id", pe.id)));
  }
  const sets = day.plan_exercises.reduce((n, pe) => n + pe.target_sets, 0);
  const minutes = estimateMinutes(day);
  return (
    <section className="rounded-2xl border border-line bg-surface" aria-label={day.name}>
      <div className="flex items-center gap-1 border-b border-line p-3">
        <Input
          aria-label="Day name"
          className="mr-1 flex-1 font-semibold"
          defaultValue={day.name}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (!v) { e.target.value = day.name; return; }
            if (v !== day.name) write(() => supabase.from("plan_days").update({ name: v }).eq("id", day.id));
          }}
        />
        <IconBtn label="Move day up" disabled={first} onClick={() => onMove(-1)}><ArrowUp className="size-4" /></IconBtn>
        <IconBtn label="Move day down" disabled={last} onClick={() => onMove(1)}><ArrowDown className="size-4" /></IconBtn>
        <IconBtn label="Duplicate day" onClick={onDuplicate}><Copy className="size-4" /></IconBtn>
        <IconBtn label="Delete day" danger onClick={onDelete}><Trash2 className="size-4" /></IconBtn>
      </div>
      <div className="border-b border-line px-3 py-2">
        <div className="mb-1 flex items-baseline gap-2">
          <p className="text-xs font-semibold text-muted">Scheduled on</p>
          {day.plan_exercises.length > 0 && (
            <p className="ml-auto text-xs text-muted">{day.plan_exercises.length} exercises · {sets} sets{minutes > 0 && ` · ~${minutes} min`}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${day.name} weekdays`}>
          {WEEKDAYS.map((label, i) => {
            const w = i + 1;
            const on = weekdays.includes(w);
            return (
              <button key={w} onClick={() => toggleDay(w)} aria-pressed={on}
                className={cn("min-h-10 min-w-12 rounded-lg border px-2 text-sm font-semibold", on ? "border-brand bg-brand text-brand-fg" : "border-line bg-surface text-muted")}>
                {label}
              </button>
            );
          })}
        </div>
        {weekdays.length === 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-warn"><AlertTriangle className="size-3.5 shrink-0" aria-hidden />Not scheduled yet. Pick the days this workout runs.</p>
        )}
      </div>
      <ul className="divide-y divide-line">
        {day.plan_exercises.map((pe, i) => (
          <ExerciseRow key={pe.id} pe={pe} first={i === 0} last={i === day.plan_exercises.length - 1} write={write} onMove={(dir) => onMoveExercise(i, dir)}
            onSwap={() => onSwapExercise(pe)} superset={inSuperset[i]} linkedToNext={isLinkedToNext(groups, i)} onToggleLink={() => toggleLink(i)} />
        ))}
        {day.plan_exercises.length === 0 && <li className="p-3 text-sm text-muted">No exercises yet.</li>}
      </ul>
      <button onClick={onAddExercise} className="flex min-h-12 w-full items-center justify-center gap-2 border-t border-line text-sm font-semibold text-brand hover:bg-surface-2">
        <Plus className="size-4" /> Add exercise
      </button>
    </section>
  );
}

function ExerciseRow({ pe, first, last, write, onMove, onSwap, superset, linkedToNext, onToggleLink }: {
  pe: PlanExercise; first: boolean; last: boolean; write: WriteFn; onMove: (dir: -1 | 1) => void; onSwap: () => void;
  superset: boolean; linkedToNext: boolean; onToggleLink: () => void;
}) {
  const supabase = createClient();
  const [err, setErr] = useState<string | null>(null);
  // Timed exercises (plank, carries) use the rep targets as seconds.
  const timed = pe.exercises.timed;
  const repMax = timed ? 3600 : 100;

  function saveNum(field: keyof Targets, raw: string, min: number, max: number) {
    const v = Number(raw);
    if (raw.trim() === "" || !Number.isInteger(v) || v < min || v > max) return setErr(`Enter a whole number from ${min} to ${max}.`);
    const next = { rep_min: pe.rep_min, rep_max: pe.rep_max, [field]: v };
    if (next.rep_max < next.rep_min) return setErr(timed ? "Max time must be at least min time." : "Max reps must be at least min reps.");
    setErr(null);
    if (v !== pe[field]) write(() => supabase.from("plan_exercises").update({ [field]: v }).eq("id", pe.id));
  }

  /** Optional target RPE: empty clears it, otherwise 5–10 in half steps. */
  function saveRpe(raw: string) {
    const t = raw.trim().replace(",", ".");
    const v = t === "" ? null : Number(t);
    if (v !== null && (!Number.isFinite(v) || v < 5 || v > 10 || v * 2 !== Math.floor(v * 2))) {
      return setErr("Target RPE is 5 to 10 in half steps (e.g. 8 or 8.5), or leave it empty.");
    }
    setErr(null);
    if (v !== (pe.target_rpe === null ? null : Number(pe.target_rpe))) {
      write(() => supabase.from("plan_exercises").update({ target_rpe: v }).eq("id", pe.id));
    }
  }

  async function removeExercise() {
    if (!(await write(() => supabase.from("plan_exercises").delete().eq("id", pe.id)))) return;
    // The joined exercise is not a plan_exercises column.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { exercises, ...row } = pe;
    notify.undo("Exercise removed", async () => { await write(() => supabase.from("plan_exercises").insert(row)); });
  }

  const variant = variantLabel(pe.exercises);
  return (
    <li className={cn("p-3", superset && "border-l-4 border-l-brand pl-2")}>
      {superset && <p className="mb-1 text-label font-semibold uppercase tracking-wide text-brand-dark">Superset</p>}
      <div className="flex items-center gap-1">
        <ExerciseThumb ex={pe.exercises} className="mr-2 size-10" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{pe.exercises.name}</p>
          <p className="truncate text-xs text-muted">{[variant, pe.exercises.is_bodyweight && "bodyweight", timed && "timed"].filter(Boolean).join(" · ")}</p>
        </div>
        <IconBtn label={`Swap ${pe.exercises.name}`} onClick={onSwap}><ArrowLeftRight className="size-4" /></IconBtn>
        <IconBtn label="Move exercise up" disabled={first} onClick={() => onMove(-1)}><ArrowUp className="size-4" /></IconBtn>
        <IconBtn label="Move exercise down" disabled={last} onClick={() => onMove(1)}><ArrowDown className="size-4" /></IconBtn>
        <IconBtn label="Remove exercise" danger onClick={removeExercise}><X className="size-4" /></IconBtn>
      </div>
      {/* Keyed on the exercise, not the values: a save reloads the plan, and remounting here would drop focus mid-Tab. */}
      <div className="mt-2 grid grid-cols-[1fr_2fr_1fr_1fr] gap-2" key={`${pe.id}-${pe.exercise_id}`}>
        <Field label="Sets"><NumInput defaultValue={pe.target_sets} onBlur={(e) => saveNum("target_sets", e.target.value, 1, 20)} /></Field>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink">{timed ? "Time (s)" : "Reps"}</span>
          <div className="flex items-center gap-1">
            <NumInput aria-label={timed ? "Min seconds" : "Min reps"} defaultValue={pe.rep_min} onBlur={(e) => saveNum("rep_min", e.target.value, 1, repMax)} />
            <span className="text-muted" aria-hidden>–</span>
            <NumInput aria-label={timed ? "Max seconds" : "Max reps"} defaultValue={pe.rep_max} onBlur={(e) => saveNum("rep_max", e.target.value, 1, repMax)} />
          </div>
        </div>
        <Field label="Rest (s)"><NumInput defaultValue={pe.rest_seconds} onBlur={(e) => saveNum("rest_seconds", e.target.value, 0, 1800)} /></Field>
        <Field label="RPE"><NumInput decimal placeholder="–" defaultValue={pe.target_rpe ?? ""} onBlur={(e) => saveRpe(e.target.value)} /></Field>
      </div>
      <Input className="mt-2 text-sm" placeholder="Notes for the client (optional)" defaultValue={pe.notes ?? ""} aria-label={`${pe.exercises.name} notes`}
        onBlur={(e) => e.target.value !== (pe.notes ?? "") && write(() => supabase.from("plan_exercises").update({ notes: e.target.value || null }).eq("id", pe.id))} />
      {err && <p className="mt-1 text-xs font-medium text-danger" role="alert">{err}</p>}
      {!last && (
        <button type="button" onClick={onToggleLink} aria-pressed={linkedToNext}
          className={cn("mt-2 flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold",
            linkedToNext ? "bg-brand/10 text-brand-dark" : "text-muted hover:bg-surface-2")}>
          <Link2 className="size-4" aria-hidden />
          {linkedToNext ? "Superset with the next exercise" : "Superset with next"}
        </button>
      )}
    </li>
  );
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 disabled:opacity-30", danger && "hover:bg-danger-bg hover:text-danger")}>
      {children}
    </button>
  );
}

function ExercisePicker({ onPick, onDone, added, dayName, ...bind }: {
  open: boolean; onOpenChange: (open: boolean) => void; onClosed: () => void;
  onPick: (ex: Exercise) => void; onDone: () => void; added: ReadonlyMap<string, number>; dayName: string;
}) {
  const count = [...added.values()].reduce((n, c) => n + c, 0);
  return (
    <Sheet
      {...bind}
      title="Exercise library"
      footer={
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-sm text-muted" role="status">
            {count ? `${count} added to ${dayName}` : "Tap exercises to add them"}
          </p>
          <Button onClick={onDone}>Done</Button>
        </div>
      }
    >
      <PickerBody onPick={onPick} added={added} />
    </Sheet>
  );
}

/** Mounted only while the picker is open, so the library loads fresh each time. */
function PickerBody({ onPick, added }: { onPick: (ex: Exercise) => void; added: ReadonlyMap<string, number> }) {
  const { data, loading, error, reload } = useLibrary();
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox message={error ?? "Couldn't load the library"} onRetry={reload} />;
  return <ExerciseBrowser lib={data} onPick={onPick} canCreate compact nested added={added} onCreated={() => reload({ silent: true })} />;
}

/**
 * Swap one plan exercise for another while keeping its sets, reps, rest, notes and place in the day.
 * Variants of the same movement come first (the usual reason: that machine is taken), then the full library.
 */
function SwapBody({ current, onSwap }: { current: PlanExercise; onSwap: (ex: Exercise) => void }) {
  const { data, loading, error, reload } = useLibrary();
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox message={error ?? "Couldn't load the library"} onRetry={reload} />;
  const self = data.exercises.find((e) => e.id === current.exercise_id);
  const variants = current.exercises.movement_id
    ? data.exercises.filter((e) => e.movement_id === current.exercises.movement_id && e.id !== current.exercise_id)
    : [];
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">Sets, reps, rest and notes stay the same.</p>
      {variants.length > 0 && (
        <section aria-label="Variants">
          <h3 className="mb-1 px-1 text-xs font-semibold tracking-wide text-muted uppercase">Other {self?.movements?.name.toLowerCase() ?? "movement"} variants</h3>
          <ul>
            {variants.map((v) => (
              <li key={v.id}>
                <button onClick={() => onSwap(v)} className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-2">
                  <ExerciseThumb ex={v} className="size-10" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{v.name}</span>
                    <span className="block truncate text-xs text-muted">{variantLabel(v) || "—"}</span>
                  </span>
                  <ArrowLeftRight className="size-4 shrink-0 text-muted" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-label="Any exercise">
        <h3 className="mb-2 px-1 text-xs font-semibold tracking-wide text-muted uppercase">{variants.length ? "Or any exercise" : "Pick a replacement"}</h3>
        <ExerciseBrowser lib={data} onPick={onSwap} compact nested />
      </section>
    </div>
  );
}

/** Copies this template to one of the coach's clients, the same as assigning it from the client's profile. */
function AssignBody({ template }: { template: Plan }) {
  const supabase = createClient();
  const router = useRouter();
  const { profile } = useProfile();
  const [clientId, setClientId] = useState("");
  const [start, setStart] = useState(localDate());
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { data, loading, error, reload } = useAsync(async () => {
    const [clients, active] = await Promise.all([
      supabase.from("coach_clients").select("client_id, profiles!coach_clients_client_id_fkey(full_name)").eq("coach_id", profile.id).eq("status", "active"),
      supabase.from("plans").select("client_id, name").eq("coach_id", profile.id).eq("is_active", true).not("client_id", "is", null),
    ]);
    const rows = must(clients) as unknown as { client_id: string; profiles: { full_name: string } }[];
    const current = new Map((must(active) as { client_id: string; name: string }[]).map((p) => [p.client_id, p.name]));
    return rows.map((r) => ({ id: r.client_id, name: r.profiles.full_name, current: current.get(r.client_id) ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [profile.id]);

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox message={error ?? "Couldn't load clients"} onRetry={reload} />;
  if (data.length === 0) return <Empty title="No active clients">Invite a client first, then assign this template. <Link className="font-semibold text-brand" href="/coach/invite">Invite a client</Link></Empty>;
  const chosen = data.find((c) => c.id === clientId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) return setErr("Choose a client.");
    if (!start) return setErr("Choose a start date.");
    setSaving(true);
    setErr(null);
    const { data: newId, error } = await supabase.rpc("copy_plan", { p_source: template.id, p_name: template.name, p_client: clientId, p_start_date: start });
    if (error) { setSaving(false); return setErr(errMsg(error)); }
    notify.success(`Assigned to ${chosen?.name ?? "client"}`);
    router.push(`/coach/plans/${newId}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm text-muted">The client gets their own copy, so you can tailor it without changing this template.</p>
      <Field label="Client">
        <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">Choose a client</option>
          {data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Start date"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
      {chosen?.current && (
        <p className="rounded-xl border border-warn-line bg-warn-bg p-3 text-sm text-warn">
          This replaces {chosen.name}&apos;s current plan, &quot;{chosen.current}&quot;. Their logged workouts are kept.
        </p>
      )}
      {err && <ErrorBox message={err} />}
      <Button type="submit" className="w-full" loading={saving}>Copy &amp; assign</Button>
    </form>
  );
}
