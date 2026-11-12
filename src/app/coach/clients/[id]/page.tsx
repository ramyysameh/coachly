"use client";
import Link from "next/link";
import { Suspense, use, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive, ArchiveRestore, ChevronDown, ChevronLeft, ClipboardList, MessageCircle, Pencil, StickyNote, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { getActivePlan, SESSION_SELECT, sortSession, type Plan, type Session, type Targets } from "@/lib/data";
import { useProfile } from "@/components/AppShell";
import NutritionDay from "@/components/NutritionDay";
import ProgressView from "@/components/ProgressView";
import SessionDetail from "@/components/SessionDetail";
import { Avatar, Badge, Button, Card, Empty, ErrorBox, Field, Input, LinkButton, NumInput, Select, Spinner, Tabs, Textarea } from "@/components/ui";
import { addDays, errMsg, fmtDate, fmtDateTime, localDate, WEEKDAYS, type Unit } from "@/lib/utils";

type Client = { id: string; full_name: string; goal: string | null; weight_unit: Unit };
type Tab = "plan" | "workouts" | "nutrition" | "progress" | "notes";

function ClientProfileInner({ id }: { id: string }) {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const { profile } = useProfile();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "plan");
  const [from, setFrom] = useState(addDays(localDate(), -27));
  const [to, setTo] = useState(localDate());
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const [client, rel] = await Promise.all([
      supabase.from("profiles").select("id, full_name, goal, weight_unit").eq("id", id).maybeSingle(),
      supabase.from("coach_clients").select("status, created_at").eq("coach_id", profile.id).eq("client_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const c = must(client) as Client | null;
    const r = must(rel) as { status: "active" | "archived"; created_at: string } | null;
    // RLS hides clients that aren't connected to this coach — both come back empty.
    if (!c || !r) return null;
    return { client: c, status: r.status, since: r.created_at };
  }, [id, profile.id]);

  async function setStatus(status: "active" | "archived") {
    if (status === "archived" && !confirm("Archive this client? Their history is kept, but you won't be able to assign plans or message them until restored.")) return;
    setBusy(true);
    const { error } = await supabase.rpc("set_client_status", { p_client: id, p_status: status });
    setBusy(false);
    if (error) return alert(errMsg(error));
    reload({ silent: true });
    router.refresh();
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) {
    return (
      <Empty title="Client not found">
        This client isn&apos;t connected to you, or the link is wrong. <Link href="/coach" className="font-semibold text-brand">Back to dashboard</Link>
      </Empty>
    );
  }
  const { client, status } = data;
  const active = status === "active";

  return (
    <div className="space-y-4">
      <Link href="/coach" className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-muted"><ChevronLeft className="size-4" /> Dashboard</Link>
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={client.full_name} />
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <span className="truncate">{client.full_name}</span>
            {!active && <Badge>Archived</Badge>}
          </h1>
          <p className="text-sm text-muted">{client.goal || "No goal set"} · uses {client.weight_unit} · client since {fmtDate(data.since.slice(0, 10))}</p>
        </div>
        <div className="flex gap-2">
          <LinkButton href={`/coach/messages?client=${client.id}`} variant="secondary"><MessageCircle className="size-4" /> Message</LinkButton>
          {active ? (
            <Button variant="danger" onClick={() => setStatus("archived")} loading={busy}><Archive className="size-4" /> Archive</Button>
          ) : (
            <Button variant="secondary" onClick={() => setStatus("active")} loading={busy}><ArchiveRestore className="size-4" /> Restore</Button>
          )}
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "plan", label: "Plan" },
          { value: "workouts", label: "Workouts" },
          { value: "nutrition", label: "Nutrition" },
          { value: "progress", label: "Progress" },
          { value: "notes", label: "Notes" },
        ]}
      />

      {(tab === "workouts" || tab === "progress") && (
        <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-3">
          <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
          <div className="flex gap-1 pb-0.5">
            {[7, 28, 90].map((n) => (
              <Button key={n} size="sm" variant="ghost" onClick={() => { setFrom(addDays(localDate(), -(n - 1))); setTo(localDate()); }}>{n}d</Button>
            ))}
          </div>
        </div>
      )}

      {tab === "plan" && <PlanTab clientId={client.id} active={active} />}
      {tab === "workouts" && <WorkoutsTab clientId={client.id} unit={client.weight_unit} from={from} to={to} openId={params.get("session")} />}
      {tab === "nutrition" && (
        <div className="space-y-4">
          <TargetsForm clientId={client.id} active={active} />
          <NutritionDay clientId={client.id} editable={false} />
        </div>
      )}
      {tab === "progress" && <ProgressView clientId={client.id} unit={client.weight_unit} canLogWeight={false} from={from} to={to} />}
      {tab === "notes" && <NotesTab clientId={client.id} active={active} />}
    </div>
  );
}

function PlanTab({ clientId, active }: { clientId: string; active: boolean }) {
  const supabase = createClient();
  const router = useRouter();
  const { profile } = useProfile();
  const [templateId, setTemplateId] = useState("");
  const [start, setStart] = useState(localDate());
  const [name, setName] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, loading, error: loadError, reload } = useAsync(async () => {
    const [plan, templates, history] = await Promise.all([
      getActivePlan(supabase, clientId),
      supabase.from("plans").select("id, name").eq("coach_id", profile.id).is("client_id", null).order("created_at"),
      supabase.from("plans").select("id, name, start_date, is_active").eq("client_id", clientId).order("created_at", { ascending: false }),
    ]);
    return { plan, templates: must(templates) as { id: string; name: string }[], history: must(history) as Plan[] };
  }, [clientId]);

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    if (!templateId) return setError("Choose a template.");
    if (!start) return setError("Choose a start date.");
    setAssigning(true);
    setError(null);
    const tpl = data!.templates.find((t) => t.id === templateId)!;
    const { data: newId, error } = await supabase.rpc("copy_plan", { p_source: templateId, p_name: name.trim() || tpl.name, p_client: clientId, p_start_date: start });
    setAssigning(false);
    if (error) return setError(errMsg(error));
    router.push(`/coach/plans/${newId}`);
  }

  if (loading) return <Spinner />;
  if (loadError || !data) return <ErrorBox message={loadError ?? "Couldn't load plan"} onRetry={reload} />;

  return (
    <div className="space-y-4">
      {data.plan ? (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand">Assigned split</p>
              <p className="text-lg font-semibold">{data.plan.name}</p>
              <p className="text-sm text-muted">From {fmtDate(data.plan.start_date!)}</p>
            </div>
            {active && <LinkButton href={`/coach/plans/${data.plan.id}`} variant="secondary"><Pencil className="size-4" /> Edit plan</LinkButton>}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.plan.plan_days.map((d) => (
              <div key={d.id} className="rounded-xl border border-line p-3">
                <p className="font-semibold">{d.name} <span className="text-xs font-normal text-muted">{d.weekdays.map((w) => WEEKDAYS[w - 1]).join("/") || "unscheduled"}</span></p>
                <ul className="mt-1 text-sm text-muted">
                  {d.plan_exercises.map((pe) => <li key={pe.id}>{pe.exercises.name}: {pe.target_sets}×{pe.rep_min}-{pe.rep_max}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Empty icon={<ClipboardList className="size-8" />} title="No plan assigned">Assign one of your templates below.</Empty>
      )}

      {active && (
        <Card>
          <form onSubmit={assign} className="space-y-3" noValidate>
            <h2 className="font-semibold">{data.plan ? "Assign a new plan" : "Assign a plan"}</h2>
            <p className="text-sm text-muted">The template is copied for this client, so you can customise it without changing the template. {data.plan && "The current plan is replaced; logged workouts are kept."}</p>
            {data.templates.length === 0 ? (
              <p className="text-sm">You have no templates yet. <Link href="/coach/plans" className="font-semibold text-brand">Create one</Link>.</p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Template">
                    <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                      <option value="">Choose…</option>
                      {data.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Start date"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
                  <Field label="Plan name (optional)"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Defaults to template name" /></Field>
                </div>
                {error && <ErrorBox message={error} />}
                <Button type="submit" loading={assigning}>Copy &amp; assign</Button>
              </>
            )}
          </form>
        </Card>
      )}

      {data.history.length > 1 && (
        <Card>
          <h2 className="mb-3 font-semibold tracking-tight">Plan history</h2>
          <ul className="text-sm">
            {data.history.map((p) => (
              <li key={p.id} className="flex justify-between border-t border-line py-2 first:border-0">
                <span>{p.name}</span>
                <span className="text-muted">{fmtDate(p.start_date!)} {p.is_active && <Badge tone="brand">Active</Badge>}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

type SessionRow = Session & { session_exercises: { session_sets: { completed: boolean }[] }[] };

function WorkoutsTab({ clientId, unit, from, to, openId }: { clientId: string; unit: Unit; from: string; to: string; openId: string | null }) {
  const supabase = createClient();
  const [open, setOpen] = useState<string | null>(openId);
  const { data, loading, error, reload } = useAsync(async () => {
    return must(
      await supabase
        .from("workout_sessions")
        .select("*, session_exercises(session_sets(completed))")
        .eq("client_id", clientId)
        .gte("scheduled_date", from)
        .lte("scheduled_date", to)
        .order("scheduled_date", { ascending: false }),
    ) as SessionRow[];
  }, [clientId, from, to]);

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox message={error ?? "Couldn't load workouts"} onRetry={reload} />;
  if (data.length === 0) return <Empty title="No workouts in this date range" />;

  return (
    <ul className="space-y-2">
      {data.map((s) => {
        const sets = s.session_exercises.flatMap((e) => e.session_sets);
        const isOpen = open === s.id;
        return (
          <li key={s.id} className="rounded-2xl border border-line bg-surface">
            <button className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}>
              <div className="flex-1">
                <p className="font-semibold">{s.name}</p>
                <p className="text-xs text-muted">{fmtDate(s.scheduled_date)} · {sets.filter((x) => x.completed).length}/{sets.length} sets{s.completed_at ? ` · finished ${fmtDateTime(s.completed_at)}` : ""}</p>
              </div>
              {s.status === "completed" ? <Badge tone="brand">Completed</Badge> : <Badge tone="warn">In progress</Badge>}
              <ChevronDown className={`size-5 text-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>
            {isOpen && <SessionLoader id={s.id} unit={unit} />}
          </li>
        );
      })}
    </ul>
  );
}

function SessionLoader({ id, unit }: { id: string; unit: Unit }) {
  const supabase = createClient();
  const { data, loading, error } = useAsync(async () => sortSession(must(await supabase.from("workout_sessions").select(SESSION_SELECT).eq("id", id).single()) as Session), [id]);
  return (
    <div className="border-t border-line p-3">
      {loading ? <Spinner /> : error || !data ? <ErrorBox message={error ?? "Not found"} /> : <SessionDetail session={data} unit={unit} />}
    </div>
  );
}

function TargetsForm({ clientId, active }: { clientId: string; active: boolean }) {
  const supabase = createClient();
  const { profile } = useProfile();
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { loading, error, reload } = useAsync(async () => {
    const t = must(await supabase.from("nutrition_targets").select("*").eq("client_id", clientId).maybeSingle()) as Targets | null;
    setF({ calories: String(t?.calories ?? ""), protein_g: String(t?.protein_g ?? ""), carbs_g: String(t?.carbs_g ?? ""), fat_g: String(t?.fat_g ?? "") });
    return t;
  }, [clientId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f) return;
    const vals = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number(v)]));
    if (Object.values(f).some((v) => v.trim() === "") || Object.values(vals).some((v) => !Number.isInteger(v) || v < 0)) {
      return setMsg({ ok: false, text: "Enter whole numbers (0 or more) for every target." });
    }
    if (vals.calories > 20000 || vals.protein_g > 2000 || vals.carbs_g > 2000 || vals.fat_g > 2000) return setMsg({ ok: false, text: "One of the targets looks too high." });
    setSaving(true);
    const { error } = await supabase.from("nutrition_targets").upsert({ client_id: clientId, ...vals, updated_by: profile.id, updated_at: new Date().toISOString() });
    setSaving(false);
    setMsg(error ? { ok: false, text: errMsg(error) } : { ok: true, text: "Targets saved." });
  }

  if (loading || !f) return <Spinner />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => { setF({ ...f, [k]: e.target.value.replace(/[^0-9]/g, "") }); setMsg(null); };

  return (
    <Card>
      <form onSubmit={save} className="space-y-3" noValidate>
        <h2 className="font-semibold">Daily targets</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="Calories"><NumInput value={f.calories} onChange={set("calories")} disabled={!active} /></Field>
          <Field label="Protein (g)"><NumInput value={f.protein_g} onChange={set("protein_g")} disabled={!active} /></Field>
          <Field label="Carbs (g)"><NumInput value={f.carbs_g} onChange={set("carbs_g")} disabled={!active} /></Field>
          <Field label="Fat (g)"><NumInput value={f.fat_g} onChange={set("fat_g")} disabled={!active} /></Field>
        </div>
        {msg && <p className={`text-sm ${msg.ok ? "text-brand-dark" : "text-danger"}`} role="status">{msg.text}</p>}
        {active && <Button type="submit" loading={saving}>Save targets</Button>}
      </form>
    </Card>
  );
}

type Note = { id: string; body: string; created_at: string };

function NotesTab({ clientId, active }: { clientId: string; active: boolean }) {
  const supabase = createClient();
  const { profile } = useProfile();
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { data, loading, error, reload } = useAsync(
    async () => must(await supabase.from("coach_notes").select("id, body, created_at").eq("client_id", clientId).eq("coach_id", profile.id).order("created_at", { ascending: false })) as Note[],
    [clientId],
  );

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return setErr("Write a note first.");
    setSaving(true);
    setErr(null);
    const { error } = await supabase.from("coach_notes").insert({ coach_id: profile.id, client_id: clientId, body: body.trim() });
    setSaving(false);
    if (error) return setErr(errMsg(error));
    setBody("");
    reload({ silent: true });
  }

  async function remove(id: string) {
    if (!confirm("Delete this note?")) return;
    const { error } = await supabase.from("coach_notes").delete().eq("id", id);
    if (error) return alert(errMsg(error));
    reload({ silent: true });
  }

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm text-muted"><StickyNote className="size-4" /> Private. Only you can see these notes.</p>
      {active && (
        <form onSubmit={add} className="space-y-2" noValidate>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a private note…" rows={3} />
          {err && <p className="text-sm text-danger">{err}</p>}
          <Button type="submit" loading={saving}>Add note</Button>
        </form>
      )}
      {loading ? <Spinner /> : error ? <ErrorBox message={error} onRetry={reload} /> : data!.length === 0 ? (
        <Empty title="No notes yet" />
      ) : (
        <ul className="space-y-2">
          {data!.map((n) => (
            <li key={n.id} className="flex gap-2 rounded-2xl border border-line bg-surface p-3">
              <div className="flex-1">
                <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                <p className="mt-1 text-xs text-muted">{fmtDateTime(n.created_at)}</p>
              </div>
              <button className="flex size-10 items-center justify-center rounded-xl text-muted hover:bg-danger-bg hover:text-danger" onClick={() => remove(n.id)} aria-label="Delete note"><Trash2 className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<Spinner />}>
      <ClientProfileInner id={id} />
    </Suspense>
  );
}
