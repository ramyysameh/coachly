"use client";
import Link from "next/link";
import { use, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, Info, Plus, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { PLAN_SELECT, sortPlan, type Exercise, type Plan, type PlanDay, type PlanExercise } from "@/lib/data";
import { ExerciseBrowser, ExerciseThumb, useLibrary } from "@/components/ExerciseLibrary";
import { ConfirmSheet, Sheet, useSheet } from "@/components/Sheet";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, NumInput, Spinner, Textarea } from "@/components/ui";
import { cn, errMsg, fmtDate, WEEKDAYS } from "@/lib/utils";
import { notify } from "@/lib/notify";

export default function PlanBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const supabase = createClient();
  const picker = useSheet<PlanDay>();
  const deleting = useSheet<PlanDay>();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(false);
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

  /** Runs a write, reports errors, then refreshes the plan quietly. */
  async function write(fn: () => PromiseLike<{ error: { message: string } | null }>[] | PromiseLike<{ error: { message: string } | null }>) {
    setSaveError(null);
    const results = await Promise.all([fn()].flat());
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      notify.error(errMsg(failed.error));
      setSavedAt(false);
    } else setSavedAt(true);
    await reload({ silent: true });
    return !failed;
  }

  if (loading) return <Spinner label="Loading plan…" />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Empty title="Plan not found">It may have been deleted, or it isn&apos;t yours. <Link className="font-semibold text-brand" href="/coach/plans">Back to plans</Link></Empty>;

  const { plan, clientName } = data;
  const dayCount: Record<number, number> = {};
  plan.plan_days.forEach((d) => d.weekdays.forEach((w) => (dayCount[w] = (dayCount[w] ?? 0) + 1)));
  const clashes = Object.entries(dayCount).filter(([, n]) => n > 1).map(([w]) => WEEKDAYS[Number(w) - 1]);

  function move<T extends { id: string }>(table: "plan_days" | "plan_exercises", list: T[], index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    const order = [...list];
    [order[index], order[j]] = [order[j], order[index]];
    return write(() => order.map((item, pos) => supabase.from(table).update({ position: pos }).eq("id", item.id)));
  }

  return (
    <div className="space-y-4">
      <Link href={plan.client_id ? `/coach/clients/${plan.client_id}` : "/coach/plans"} className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-muted">
        <ChevronLeft className="size-4" /> {plan.client_id ? `Back to ${clientName ?? "client"}` : "All templates"}
      </Link>

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          {plan.client_id ? <Badge tone="brand">Assigned to {clientName}</Badge> : <Badge>Template</Badge>}
          <span className="ml-auto text-xs text-muted" role="status">{saveError ? "" : savedAt ? "All changes saved" : "Changes save automatically"}</span>
        </div>
        <Field label="Plan name">
          <Input defaultValue={plan.name} key={`n-${plan.name}`} onBlur={(e) => {
            const v = e.target.value.trim();
            if (!v) { e.target.value = plan.name; return setSaveError("Plan name can't be empty."); }
            if (v !== plan.name) write(() => supabase.from("plans").update({ name: v }).eq("id", plan.id));
          }} />
        </Field>
        <Field label="Description (optional)">
          <Textarea rows={2} defaultValue={plan.description ?? ""} onBlur={(e) => e.target.value !== (plan.description ?? "") && write(() => supabase.from("plans").update({ description: e.target.value || null }).eq("id", plan.id))} />
        </Field>
        {plan.client_id && (
          <>
            <Field label="Start date">
              <Input type="date" defaultValue={plan.start_date ?? ""} key={`s-${plan.start_date}`} onBlur={(e) => e.target.value && e.target.value !== plan.start_date && write(() => supabase.from("plans").update({ start_date: e.target.value }).eq("id", plan.id))} />
            </Field>
            <p className="flex gap-2 rounded-xl bg-brand/5 p-3 text-sm text-brand-dark">
              <Info className="mt-0.5 size-4 shrink-0" />
              Edits apply to future workouts. Sessions {clientName ?? "the client"} has already started or completed keep the targets they had at the time.
              {plan.start_date && ` Plan runs from ${fmtDate(plan.start_date)}.`}
            </p>
          </>
        )}
      </Card>

      {saveError && <ErrorBox message={saveError} />}
      {clashes.length > 0 && <p className="rounded-xl border border-warn-line bg-warn-bg p-3 text-sm text-warn">More than one workout is scheduled on {clashes.join(", ")}. Clients will see the first one listed.</p>}

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
          onAddExercise={() => {
            nextPosition.current = day.plan_exercises.length;
            setAdded(new Map());
            picker.show(day);
          }}
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
          setSavedAt(true);
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
          const ok = await write(() =>
            supabase.from("plan_exercises").insert({
              plan_day_id: day.id,
              exercise_id: ex.id,
              position,
              target_sets: 3,
              rep_min: ex.is_bodyweight ? 8 : 8,
              rep_max: ex.is_bodyweight ? 15 : 12,
              rest_seconds: 90,
            }),
          );
          if (ok) setAdded((m) => new Map(m).set(ex.id, (m.get(ex.id) ?? 0) + 1));
        }}
      />
    </div>
  );
}

type WriteFn = (fn: () => PromiseLike<{ error: { message: string } | null }>[] | PromiseLike<{ error: { message: string } | null }>) => Promise<boolean>;

function DayCard({ day, first, last, write, onMove, onMoveExercise, onAddExercise, onDelete }: {
  day: PlanDay; first: boolean; last: boolean; write: WriteFn;
  onMove: (dir: -1 | 1) => void; onMoveExercise: (i: number, dir: -1 | 1) => void; onAddExercise: () => void; onDelete: () => void;
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
  return (
    <section className="rounded-2xl border border-line bg-surface" aria-label={day.name}>
      <div className="flex items-center gap-2 border-b border-line p-3">
        <Input
          aria-label="Day name"
          className="flex-1 font-semibold"
          defaultValue={day.name}
          key={`d-${day.name}`}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (!v) { e.target.value = day.name; return; }
            if (v !== day.name) write(() => supabase.from("plan_days").update({ name: v }).eq("id", day.id));
          }}
        />
        <IconBtn label="Move day up" disabled={first} onClick={() => onMove(-1)}><ArrowUp className="size-4" /></IconBtn>
        <IconBtn label="Move day down" disabled={last} onClick={() => onMove(1)}><ArrowDown className="size-4" /></IconBtn>
        <IconBtn label="Delete day" danger onClick={onDelete}>
          <Trash2 className="size-4" />
        </IconBtn>
      </div>
      <div className="border-b border-line px-3 py-2">
        <p className="mb-1 text-xs font-semibold text-muted">Scheduled on</p>
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
      </div>
      <ul className="divide-y divide-line">
        {day.plan_exercises.map((pe, i) => (
          <ExerciseRow key={pe.id} pe={pe} first={i === 0} last={i === day.plan_exercises.length - 1} write={write} onMove={(dir) => onMoveExercise(i, dir)} />
        ))}
        {day.plan_exercises.length === 0 && <li className="p-3 text-sm text-muted">No exercises yet.</li>}
      </ul>
      <button onClick={onAddExercise} className="flex min-h-12 w-full items-center justify-center gap-2 border-t border-line text-sm font-semibold text-brand hover:bg-surface-2">
        <Plus className="size-4" /> Add exercise
      </button>
    </section>
  );
}

function ExerciseRow({ pe, first, last, write, onMove }: { pe: PlanExercise; first: boolean; last: boolean; write: WriteFn; onMove: (dir: -1 | 1) => void }) {
  const supabase = createClient();
  const [err, setErr] = useState<string | null>(null);

  function saveNum(field: "target_sets" | "rep_min" | "rep_max" | "rest_seconds", raw: string, min: number, max: number) {
    const v = Number(raw);
    if (raw.trim() === "" || !Number.isInteger(v) || v < min || v > max) return setErr(`Enter a whole number from ${min} to ${max}.`);
    const next = { rep_min: pe.rep_min, rep_max: pe.rep_max, [field]: v };
    if (next.rep_max < next.rep_min) return setErr("Max reps must be at least min reps.");
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

  const k = `${pe.id}-${pe.target_sets}-${pe.rep_min}-${pe.rep_max}-${pe.rest_seconds}-${pe.target_rpe}`;
  return (
    <li className="p-3">
      <div className="flex items-center gap-1">
        <ExerciseThumb ex={pe.exercises} className="mr-2 size-10" />
        <p className="flex-1 font-semibold">
          {pe.exercises.name}
          {pe.exercises.is_bodyweight && <span className="ml-1 text-xs font-normal text-muted">bodyweight</span>}
        </p>
        <IconBtn label="Move exercise up" disabled={first} onClick={() => onMove(-1)}><ArrowUp className="size-4" /></IconBtn>
        <IconBtn label="Move exercise down" disabled={last} onClick={() => onMove(1)}><ArrowDown className="size-4" /></IconBtn>
        <IconBtn label="Remove exercise" danger onClick={removeExercise}><X className="size-4" /></IconBtn>
      </div>
      <div className="mt-2 grid grid-cols-5 gap-2" key={k}>
        <Field label="Sets"><NumInput defaultValue={pe.target_sets} onBlur={(e) => saveNum("target_sets", e.target.value, 1, 20)} /></Field>
        <Field label="Min reps"><NumInput defaultValue={pe.rep_min} onBlur={(e) => saveNum("rep_min", e.target.value, 1, 100)} /></Field>
        <Field label="Max reps"><NumInput defaultValue={pe.rep_max} onBlur={(e) => saveNum("rep_max", e.target.value, 1, 100)} /></Field>
        <Field label="Rest (s)"><NumInput defaultValue={pe.rest_seconds} onBlur={(e) => saveNum("rest_seconds", e.target.value, 0, 1800)} /></Field>
        <Field label="RPE"><NumInput decimal placeholder="–" defaultValue={pe.target_rpe ?? ""} onBlur={(e) => saveRpe(e.target.value)} /></Field>
      </div>
      <Input className="mt-2 text-sm" placeholder="Notes for the client (optional)" defaultValue={pe.notes ?? ""} aria-label={`${pe.exercises.name} notes`}
        onBlur={(e) => e.target.value !== (pe.notes ?? "") && write(() => supabase.from("plan_exercises").update({ notes: e.target.value || null }).eq("id", pe.id))} />
      {err && <p className="mt-1 text-xs font-medium text-danger" role="alert">{err}</p>}
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
