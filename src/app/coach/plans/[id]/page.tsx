"use client";
import Link from "next/link";
import { use, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, Info, Plus, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { PLAN_SELECT, sortPlan, type Exercise, type Plan, type PlanDay, type PlanExercise } from "@/lib/data";
import { ExerciseBrowser, ExerciseThumb, Sheet, useLibrary } from "@/components/ExerciseLibrary";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, NumInput, Spinner, Textarea } from "@/components/ui";
import { cn, errMsg, fmtDate, WEEKDAYS } from "@/lib/utils";
import { notify } from "@/lib/notify";

export default function PlanBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const supabase = createClient();
  const [pickerFor, setPickerFor] = useState<PlanDay | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(false);

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
          onAddExercise={() => setPickerFor(day)}
        />
      ))}

      <Button
        variant="secondary"
        className="w-full"
        onClick={() => write(() => supabase.from("plan_days").insert({ plan_id: plan.id, name: `Day ${plan.plan_days.length + 1}`, position: plan.plan_days.length, weekdays: [] }))}
      >
        <Plus className="size-4" /> Add workout day
      </Button>

      {pickerFor && (
        <ExercisePicker
          onClose={() => setPickerFor(null)}
          onPick={async (ex) => {
            const day = pickerFor;
            setPickerFor(null);
            await write(() =>
              supabase.from("plan_exercises").insert({
                plan_day_id: day.id,
                exercise_id: ex.id,
                position: day.plan_exercises.length,
                target_sets: 3,
                rep_min: ex.is_bodyweight ? 8 : 8,
                rep_max: ex.is_bodyweight ? 15 : 12,
                rest_seconds: 90,
              }),
            );
          }}
        />
      )}
    </div>
  );
}

type WriteFn = (fn: () => PromiseLike<{ error: { message: string } | null }>[] | PromiseLike<{ error: { message: string } | null }>) => Promise<boolean>;

function DayCard({ day, first, last, write, onMove, onMoveExercise, onAddExercise }: {
  day: PlanDay; first: boolean; last: boolean; write: WriteFn;
  onMove: (dir: -1 | 1) => void; onMoveExercise: (i: number, dir: -1 | 1) => void; onAddExercise: () => void;
}) {
  const supabase = createClient();
  function toggleDay(w: number) {
    const next = day.weekdays.includes(w) ? day.weekdays.filter((x) => x !== w) : [...day.weekdays, w].sort();
    write(() => supabase.from("plan_days").update({ weekdays: next }).eq("id", day.id));
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
        <IconBtn label="Delete day" danger onClick={() => confirm(`Delete "${day.name}" and its exercises? Logged workouts are kept.`) && write(() => supabase.from("plan_days").delete().eq("id", day.id))}>
          <Trash2 className="size-4" />
        </IconBtn>
      </div>
      <div className="border-b border-line px-3 py-2">
        <p className="mb-1 text-xs font-semibold text-muted">Scheduled on</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${day.name} weekdays`}>
          {WEEKDAYS.map((label, i) => {
            const w = i + 1;
            const on = day.weekdays.includes(w);
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

  async function removeExercise() {
    if (!(await write(() => supabase.from("plan_exercises").delete().eq("id", pe.id)))) return;
    // The joined exercise is not a plan_exercises column.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { exercises, ...row } = pe;
    notify.undo("Exercise removed", async () => { await write(() => supabase.from("plan_exercises").insert(row)); });
  }

  const k = `${pe.id}-${pe.target_sets}-${pe.rep_min}-${pe.rep_max}-${pe.rest_seconds}`;
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
      <div className="mt-2 grid grid-cols-4 gap-2" key={k}>
        <Field label="Sets"><NumInput defaultValue={pe.target_sets} onBlur={(e) => saveNum("target_sets", e.target.value, 1, 20)} /></Field>
        <Field label="Min reps"><NumInput defaultValue={pe.rep_min} onBlur={(e) => saveNum("rep_min", e.target.value, 1, 100)} /></Field>
        <Field label="Max reps"><NumInput defaultValue={pe.rep_max} onBlur={(e) => saveNum("rep_max", e.target.value, 1, 100)} /></Field>
        <Field label="Rest (s)"><NumInput defaultValue={pe.rest_seconds} onBlur={(e) => saveNum("rest_seconds", e.target.value, 0, 1800)} /></Field>
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

function ExercisePicker({ onClose, onPick }: { onClose: () => void; onPick: (ex: Exercise) => void }) {
  const { data, loading, error, reload } = useLibrary();
  return (
    <Sheet title="Exercise library" onClose={onClose}>
      {loading ? <Spinner /> : error || !data ? <ErrorBox message={error ?? "Couldn't load the library"} onRetry={reload} /> : (
        <ExerciseBrowser lib={data} onPick={onPick} canCreate compact onCreated={() => reload({ silent: true })} />
      )}
    </Sheet>
  );
}
