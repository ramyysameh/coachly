"use client";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeftRight, ImagePlus, Plus, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { EXERCISE_SELECT, type Exercise, type Movement, type Pattern } from "@/lib/data";
import { ANGLES, cap, EQUIPMENT, GRIPS, MUSCLES, muscleLabel, PATTERNS, type Muscle } from "@/lib/muscles";
import { useProfile } from "@/components/AppShell";
import MuscleMap, { bestView, exerciseTones } from "@/components/MuscleMap";
import { ExerciseCommand } from "@/components/ExerciseCommand";
import { Sheet, useSheet } from "@/components/Sheet";
import { Badge, Button, ErrorBox, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { cn, errMsg } from "@/lib/utils";

export type Library = { exercises: Exercise[]; movements: Movement[] };

export function useLibrary() {
  const supabase = createClient();
  return useAsync(async (): Promise<Library> => {
    const [ex, mv] = await Promise.all([
      supabase.from("exercises").select(EXERCISE_SELECT).order("name"),
      supabase.from("movements").select("*").order("name"),
    ]);
    return { exercises: must(ex) as Exercise[], movements: must(mv) as Movement[] };
  }, []);
}

type Filters = { q: string; muscle: string; equipment: string; pattern: string };
const NO_FILTERS: Filters = { q: "", muscle: "", equipment: "", pattern: "" };

function matches(e: Exercise, f: Filters) {
  if (f.muscle && !e.primary_muscles.includes(f.muscle) && !e.secondary_muscles.includes(f.muscle)) return false;
  if (f.equipment && e.equipment !== f.equipment) return false;
  if (f.pattern && e.movements?.pattern !== f.pattern) return false;
  if (f.q) {
    const hay = [e.name, e.movements?.name, e.equipment, ...e.primary_muscles.map(muscleLabel)].join(" ").toLowerCase();
    if (!hay.includes(f.q.toLowerCase())) return false;
  }
  return true;
}

/** Groups exercises under their base movement (custom ones without a movement go last). */
function group(list: Exercise[]) {
  const map = new Map<string, Exercise[]>();
  list.forEach((e) => {
    const key = e.movements?.name ?? "Other";
    map.set(key, [...(map.get(key) ?? []), e]);
  });
  return [...map.entries()].sort(([a], [b]) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)));
}

function FilterBar({ f, setF, hideSearch }: { f: Filters; setF: (f: Filters) => void; hideSearch?: boolean }) {
  return (
    <div className="space-y-2">
      {!hideSearch && <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input className="pl-9" placeholder="Search exercises" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Search exercises" />
      </div>}
      <div className="grid grid-cols-3 gap-2">
        <Select aria-label="Muscle" value={f.muscle} onChange={(e) => setF({ ...f, muscle: e.target.value })}>
          <option value="">All muscles</option>
          {MUSCLES.map((m) => <option key={m} value={m}>{muscleLabel(m)}</option>)}
        </Select>
        <Select aria-label="Equipment" value={f.equipment} onChange={(e) => setF({ ...f, equipment: e.target.value })}>
          <option value="">All equipment</option>
          {EQUIPMENT.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
        <Select aria-label="Movement pattern" value={f.pattern} onChange={(e) => setF({ ...f, pattern: e.target.value })}>
          <option value="">All patterns</option>
          {PATTERNS.map((m) => <option key={m} value={m}>{cap(m)}</option>)}
        </Select>
      </div>
    </div>
  );
}

export function ExerciseThumb({ ex, className }: { ex: Exercise; className?: string }) {
  return (
    <span className={cn("flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-2 ring-1 ring-line", className)}>
      {ex.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ex.image_url} alt="" className="size-full object-cover" />
      ) : (
        <MuscleMap tones={exerciseTones(ex.primary_muscles, ex.secondary_muscles)} size="xs" view={bestView(ex.primary_muscles)} />
      )}
    </span>
  );
}

export function variantLabel(e: Exercise) {
  return [e.equipment, e.angle && cap(e.angle), e.grip && `${e.grip} grip`, e.unilateral && "single-arm/leg"].filter(Boolean).join(" · ");
}

function ExerciseList({ list, onOpen }: { list: Exercise[]; onOpen: (e: Exercise) => void }) {
  if (list.length === 0) return <p className="p-6 text-center text-sm text-muted">No exercises match these filters.</p>;
  return (
    <div className="space-y-4">
      {group(list).map(([movement, items]) => (
        <section key={movement} aria-label={movement}>
          <h3 className="px-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">{movement}</h3>
          <ul>
            {items.map((e) => (
              <li key={e.id} className="flex items-center gap-1">
                <button
                  onClick={() => onOpen(e)}
                  className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-surface-2"
                >
                  <ExerciseThumb ex={e} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-medium">
                      <span className="truncate">{e.name}</span>
                      {e.created_by && <Badge tone="brand">Custom</Badge>}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {e.primary_muscles.map(muscleLabel).join(", ") || "No muscles tagged"}
                      {variantLabel(e) && ` · ${variantLabel(e)}`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function ExerciseDetail({ ex, all, onOpen, onPick }: { ex: Exercise; all: Exercise[]; onOpen: (e: Exercise) => void; onPick?: (e: Exercise) => void }) {
  const variants = ex.movement_id ? all.filter((o) => o.movement_id === ex.movement_id && o.id !== ex.id) : [];
  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-line">
        {ex.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ex.image_url} alt={ex.name} className="aspect-video w-full object-cover" />
        ) : (
          <div className="flex aspect-video flex-col items-center justify-center gap-1 text-sm text-muted">
            <ImagePlus className="size-6" aria-hidden />
            Demo image coming soon
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ex.movements && <Badge tone="brand">{cap(ex.movements.pattern)}</Badge>}
        {ex.equipment && <Badge>{ex.equipment}</Badge>}
        {ex.angle && <Badge>{cap(ex.angle)}</Badge>}
        {ex.grip && <Badge>{cap(ex.grip)} grip</Badge>}
        {ex.unilateral && <Badge>Unilateral</Badge>}
        {ex.created_by && <Badge tone="brand">Custom</Badge>}
      </div>
      <div className="grid items-center gap-4 sm:grid-cols-[auto_1fr]">
        <MuscleMap tones={exerciseTones(ex.primary_muscles, ex.secondary_muscles)} />
        <div className="space-y-3 text-sm">
          <MuscleList label="Primary" swatch="bg-brand" muscles={ex.primary_muscles} />
          <MuscleList label="Secondary" swatch="bg-brand/40" muscles={ex.secondary_muscles} />
        </div>
      </div>
      {ex.cues.length > 0 && <Bullets title="Coaching cues" items={ex.cues} />}
      {ex.mistakes.length > 0 && <Bullets title="Common mistakes" items={ex.mistakes} tone="warn" />}
      {variants.length > 0 && (
        <section>
          <h3 className="mb-1 flex items-center gap-1.5 font-semibold"><ArrowLeftRight className="size-4" aria-hidden /> Other {ex.movements?.name.toLowerCase()} variants</h3>
          <p className="mb-2 text-xs text-muted">Swap in one of these when the equipment is busy.</p>
          <ul className="space-y-1">
            {variants.map((v) => (
              <li key={v.id} className="flex items-center gap-1">
                <button onClick={() => onOpen(v)} className="flex min-h-12 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-surface-2">
                  <ExerciseThumb ex={v} className="size-10" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{v.name}</span>
                    <span className="block truncate text-xs text-muted">{variantLabel(v)}</span>
                  </span>
                </button>
                {onPick && <Button size="sm" variant="secondary" onClick={() => onPick(v)}>Use</Button>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function MuscleList({ label, swatch, muscles }: { label: string; swatch: string; muscles: string[] }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase"><span className={cn("size-2.5 rounded-full", swatch)} />{label}</p>
      <p className="mt-0.5">{muscles.length ? muscles.map(muscleLabel).join(", ") : "—"}</p>
    </div>
  );
}

function Bullets({ title, items, tone }: { title: string; items: string[]; tone?: "warn" }) {
  return (
    <section>
      <h3 className="mb-1.5 font-semibold">{title}</h3>
      <ul className="space-y-1 text-sm">
        {items.map((c) => (
          <li key={c} className="flex gap-2">
            <span className={cn("mt-2 size-1.5 shrink-0 rounded-full", tone === "warn" ? "bg-warn-solid" : "bg-brand")} aria-hidden />
            {c}
          </li>
        ))}
      </ul>
    </section>
  );
}

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

/** Coach form for a custom exercise: movement, variant dimensions, muscle tags, cues and an optional photo. */
export function CustomExerciseForm({ lib, initialName = "", onCancel, onCreated }: { lib: Library; initialName?: string; onCancel: () => void; onCreated: (e: Exercise) => void }) {
  const supabase = createClient();
  const { profile } = useProfile();
  const [f, setF] = useState({
    name: initialName, movement_id: "", new_movement: "", pattern: "push" as Pattern, equipment: "", angle: "", grip: "",
    unilateral: false, is_bodyweight: false, cues: "", mistakes: "",
  });
  const [primary, setPrimary] = useState<string[]>([]);
  const [secondary, setSecondary] = useState<string[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggle(m: Muscle) {
    // Tap cycles: none → primary → secondary → none
    if (primary.includes(m)) { setPrimary(primary.filter((x) => x !== m)); setSecondary([...secondary, m]); }
    else if (secondary.includes(m)) setSecondary(secondary.filter((x) => x !== m));
    else setPrimary([...primary, m]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = f.name.trim();
    if (!name) return setErr("Enter an exercise name.");
    if (lib.exercises.some((x) => x.name.toLowerCase() === name.toLowerCase())) return setErr("An exercise with this name already exists. Search for it instead.");
    if (f.movement_id === "new" && !f.new_movement.trim()) return setErr("Name the new base movement.");
    if (primary.length === 0) return setErr("Tag at least one primary muscle. These drive weekly volume and the heat map.");
    setSaving(true);
    setErr(null);
    try {
      let movementId: string | null = f.movement_id && f.movement_id !== "new" ? f.movement_id : null;
      if (f.movement_id === "new") {
        const mv = must(await supabase.from("movements").insert({ name: f.new_movement.trim(), pattern: f.pattern, created_by: profile.id }).select().single()) as Movement;
        movementId = mv.id;
      }
      let image_url: string | null = null;
      if (photo) {
        const path = `${profile.id}/${crypto.randomUUID()}.${photo.name.split(".").pop() || "jpg"}`;
        const up = await supabase.storage.from("exercise-media").upload(path, photo, { contentType: photo.type });
        if (up.error) throw up.error;
        image_url = supabase.storage.from("exercise-media").getPublicUrl(path).data.publicUrl;
      }
      const ex = must(await supabase.from("exercises").insert({
        name, equipment: f.equipment || null, is_bodyweight: f.is_bodyweight || f.equipment === "Bodyweight",
        movement_id: movementId, angle: f.angle || null, grip: f.grip || null, unilateral: f.unilateral,
        primary_muscles: primary, secondary_muscles: secondary, cues: lines(f.cues), mistakes: lines(f.mistakes),
        image_url, created_by: profile.id,
      }).select(EXERCISE_SELECT).single()) as Exercise;
      onCreated(ex);
    } catch (e) {
      setErr(errMsg(e));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Name"><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Landmine Press" /></Field>
      <Field label="Base movement" hint="Variants of one movement share history and show up as swap options.">
        <Select value={f.movement_id} onChange={(e) => setF({ ...f, movement_id: e.target.value })}>
          <option value="">None</option>
          {lib.movements.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          <option value="new">+ New movement…</option>
        </Select>
      </Field>
      {f.movement_id === "new" && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Movement name"><Input value={f.new_movement} onChange={(e) => setF({ ...f, new_movement: e.target.value })} placeholder="e.g. Landmine press" /></Field>
          <Field label="Pattern">
            <Select value={f.pattern} onChange={(e) => setF({ ...f, pattern: e.target.value as Pattern })}>
              {PATTERNS.map((p) => <option key={p} value={p}>{cap(p)}</option>)}
            </Select>
          </Field>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Field label="Equipment">
          <Select value={f.equipment} onChange={(e) => setF({ ...f, equipment: e.target.value })}>
            <option value="">—</option>
            {EQUIPMENT.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Angle">
          <Select value={f.angle} onChange={(e) => setF({ ...f, angle: e.target.value })}>
            <option value="">—</option>
            {ANGLES.map((m) => <option key={m} value={m}>{cap(m)}</option>)}
          </Select>
        </Field>
        <Field label="Grip">
          <Select value={f.grip} onChange={(e) => setF({ ...f, grip: e.target.value })}>
            <option value="">—</option>
            {GRIPS.map((m) => <option key={m} value={m}>{cap(m)}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Check checked={f.unilateral} onChange={(v) => setF({ ...f, unilateral: v })}>Unilateral</Check>
        <Check checked={f.is_bodyweight} onChange={(v) => setF({ ...f, is_bodyweight: v })}>Bodyweight</Check>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Muscles</legend>
        <p className="mb-2 text-xs text-muted">Tap once for primary, twice for secondary, three times to clear.</p>
        <div className="flex flex-wrap gap-1.5">
          {MUSCLES.map((m) => {
            const state = primary.includes(m) ? "primary" : secondary.includes(m) ? "secondary" : null;
            return (
              <button type="button" key={m} onClick={() => toggle(m)} aria-pressed={!!state}
                className={cn("min-h-9 rounded-full border px-3 text-sm font-medium",
                  state === "primary" ? "border-brand bg-brand text-brand-fg" : state === "secondary" ? "border-brand/40 bg-brand/15 text-brand-dark" : "border-line text-muted")}>
                {muscleLabel(m)}
              </button>
            );
          })}
        </div>
        <MuscleMap tones={exerciseTones(primary, secondary)} size="sm" className="mt-3" />
      </fieldset>
      <Field label="Coaching cues" hint="One per line"><Textarea value={f.cues} onChange={(e) => setF({ ...f, cues: e.target.value })} rows={3} /></Field>
      <Field label="Common mistakes" hint="One per line"><Textarea value={f.mistakes} onChange={(e) => setF({ ...f, mistakes: e.target.value })} rows={2} /></Field>
      <Field label="Photo (optional)" hint="JPG, PNG, WebP or GIF up to 5 MB">
        <Input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      </Field>
      {err && <ErrorBox message={err} />}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Back</Button>
        <Button type="submit" loading={saving} className="flex-1">Create exercise</Button>
      </div>
    </form>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex min-h-12 items-center gap-3 rounded-xl border border-line px-3 text-sm">
      <input type="checkbox" className="size-5 accent-brand" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

/**
 * Browse the library. Without onPick it's a reference screen; with onPick (plan editor)
 * tapping a row adds it, and the info button opens the exercise card.
 * `nested` is set when the browser itself sits inside a sheet, so its sheets stack on top.
 */
export function ExerciseBrowser({ lib, onPick, canCreate, onCreated, compact, nested }: {
  lib: Library; onPick?: (e: Exercise) => void; canCreate?: boolean; onCreated?: () => void; compact?: boolean; nested?: boolean;
}) {
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const detail = useSheet<Exercise>();
  const [history, setHistory] = useState<Exercise[]>([]);
  const create = useSheet<string>();
  const list = useMemo(() => lib.exercises.filter((e) => matches(e, onPick ? { ...f, q: "" } : f)), [lib.exercises, f, onPick]);

  const openEx = (e: Exercise) => { setHistory(detail.open && detail.item ? [...history, detail.item] : []); detail.show(e); };
  const back = () => { detail.show(history[history.length - 1]); setHistory(history.slice(0, -1)); };
  const shown = detail.item;

  return (
    <div className="space-y-3">
      <FilterBar f={f} setF={setF} hideSearch={!!onPick} />
      {onPick ? (
        <div className={cn(compact && "-mx-2")}><ExerciseCommand exercises={list} search={f.q} onSearchChange={(q) => setF({ ...f, q })} onPick={onPick} onInfo={openEx} /></div>
      ) : (
        <>
          <p className="px-1 text-xs text-muted">{list.length} of {lib.exercises.length} exercises</p>
          <div className={cn(compact && "-mx-2")}><ExerciseList list={list} onOpen={openEx} /></div>
        </>
      )}
      {canCreate && (
        <Button variant="secondary" className="w-full" onClick={() => create.show(f.q)}><Plus className="size-4" /> Create custom exercise</Button>
      )}
      <Sheet
        {...detail.bind}
        nested={nested}
        title={shown?.name ?? ""}
        onBack={history.length ? back : undefined}
        footer={onPick && shown ? <Button className="w-full" onClick={() => { onPick(shown); detail.close(); }}>Add {shown.name}</Button> : undefined}
      >
        {shown && <ExerciseDetail ex={shown} all={lib.exercises} onOpen={openEx} onPick={onPick ? (v) => { onPick(v); detail.close(); } : undefined} />}
      </Sheet>
      <Sheet {...create.bind} nested={nested} title="Custom exercise">
        {create.item !== null && (
          <CustomExerciseForm key={create.key} lib={lib} initialName={create.item} onCancel={create.close}
            onCreated={(e) => { create.close(); onCreated?.(); if (onPick) onPick(e); else openEx(e); }} />
        )}
      </Sheet>
    </div>
  );
}

/** Full-page library used by /coach/library and /library. */
export default function ExerciseLibraryPage({ canCreate }: { canCreate?: boolean }) {
  const { data, loading, error, reload } = useLibrary();
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox message={error ?? "Couldn't load the library"} onRetry={reload} />;
  return <ExerciseBrowser lib={data} canCreate={canCreate} onCreated={() => reload({ silent: true })} />;
}
