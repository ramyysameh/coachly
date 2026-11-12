"use client";
import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import type { Profile } from "@/lib/supabase/server";
import { ageFrom, fmtHeight, GOALS, goalLabel, LEVELS, levelLabel, weightTrend } from "@/lib/profile";
import { Avatar, Badge, Button, Card, ErrorBox, Field, NumInput, Select, Skeleton, Textarea } from "@/components/ui";
import { addDays, cn, errMsg, fmtDate, fromKg, localDate } from "@/lib/utils";

type Props = {
  clientId: string;
  viewer: "coach" | "client";
  /** When the coaching relationship started (shown as "client since"). */
  since?: string | null;
  /** Coach-only actions (message, archive) rendered beside the name. */
  actions?: React.ReactNode;
  archived?: boolean;
};

/** Always-visible profile header: identity, key body stats and coaching chips. */
export default function ProfileHeader({ clientId, viewer, since, actions, archived }: Props) {
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const { data, loading, error, reload } = useAsync(async () => {
    const [p, bw] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", clientId).single(),
      supabase.from("body_weights").select("entry_date, weight_kg").eq("client_id", clientId)
        .gte("entry_date", addDays(localDate(), -120)).order("entry_date", { ascending: false }).limit(60),
    ]);
    return { profile: must(p) as Profile, weights: must(bw) as { entry_date: string; weight_kg: number }[] };
  }, [clientId]);

  if (loading) return <Skeleton className="h-40" />;
  if (error || !data) return <ErrorBox message={error ?? "Couldn't load profile"} onRetry={reload} />;
  const p = data.profile;
  const unit = p.weight_unit;
  const age = ageFrom(p.date_of_birth);
  const trend = weightTrend(data.weights);
  const height = fmtHeight(p.height_cm, p.height_unit);
  const incomplete = viewer === "client" && (!p.date_of_birth || !p.height_cm || !p.goal_type);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={p.full_name} src={p.avatar_url} size="lg" />
        <div className="min-w-[14rem] flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <span className="truncate">{p.full_name || "Unnamed"}</span>
            {archived && <Badge>Archived</Badge>}
          </h1>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {goalLabel(p.goal_type) && <Badge tone="brand">{goalLabel(p.goal_type)}</Badge>}
            {levelLabel(p.experience_level) && <Badge>{levelLabel(p.experience_level)}</Badge>}
            {p.training_days_per_week && <Badge>{p.training_days_per_week}× / week target</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions}
          {viewer === "client" ? (
            <Link href="/profile" className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-semibold shadow-card hover:bg-surface-2">
              <Pencil className="size-4" /> Edit profile
            </Link>
          ) : (
            !archived && <Button variant="secondary" onClick={() => setEditing((v) => !v)}><Pencil className="size-4" /> Coaching details</Button>
          )}
        </div>
      </div>

      {p.injuries && (
        <div className="flex items-start gap-2 rounded-xl border border-warn-line bg-warn-bg px-3 py-2 text-sm text-warn" role="note">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span><span className="font-semibold">Injuries / limitations:</span> {p.injuries}</span>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Fact label="Age" value={age !== null ? `${age}` : null} />
        <Fact label="Height" value={height} />
        <Fact
          label="Weight"
          value={trend ? `${fromKg(trend.latest, unit)} ${unit}` : null}
          sub={trend?.change != null ? `${trend.change > 0 ? "+" : trend.change < 0 ? "−" : "±"}${Math.abs(fromKg(trend.change, unit) ?? 0)} ${unit} in 30 days` : trend ? `on ${fmtDate(trend.date, { month: "short", day: "numeric" })}` : undefined}
        />
        <Fact label={viewer === "coach" ? "Client since" : "Coached since"} value={since ? fmtDate(since.slice(0, 10), { month: "short", day: "numeric", year: "numeric" }) : null} />
      </dl>

      {p.goal && <p className="text-sm text-muted"><span className="font-medium text-ink">Goal: </span>{p.goal}</p>}

      {incomplete && (
        <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">
          Add your date of birth, height and goal so your coach can plan around you. <Link href="/profile" className="font-semibold text-brand">Complete profile</Link>
        </p>
      )}

      {editing && <CoachDetailsForm profile={p} onDone={() => { setEditing(false); reload({ silent: true }); }} />}
    </Card>
  );
}

function Fact({ label, value, sub }: { label: string; value: string | null; sub?: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className={cn("font-mono text-lg font-semibold tabular-nums", !value && "text-muted")}>{value ?? "—"}</dd>
      {sub && <dd className="text-xs text-muted">{sub}</dd>}
    </div>
  );
}

/** Coach edits goal type, level, injuries and weekly target for their client. */
function CoachDetailsForm({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const supabase = createClient();
  const [f, setF] = useState({
    goal: profile.goal_type ?? "", level: profile.experience_level ?? "",
    injuries: profile.injuries ?? "", days: profile.training_days_per_week ? String(profile.training_days_per_week) : "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const days = f.days ? Number(f.days) : null;
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 7)) return setErr("Training days must be 1–7.");
    setSaving(true);
    const { error } = await supabase.rpc("coach_update_client", {
      p_client: profile.id, p_goal_type: f.goal || null, p_experience_level: f.level || null, p_injuries: f.injuries, p_training_days: days,
    });
    setSaving(false);
    if (error) return setErr(errMsg(error));
    onDone();
  }

  return (
    <form onSubmit={save} className="space-y-3 border-t border-line pt-4" noValidate>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Field label="Goal">
          <Select value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })}>
            <option value="">Not set</option>
            {GOALS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </Select>
        </Field>
        <Field label="Experience">
          <Select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>
            <option value="">Not set</option>
            {LEVELS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </Select>
        </Field>
        <Field label="Training days / week"><NumInput value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} placeholder="e.g. 4" /></Field>
      </div>
      <Field label="Injuries and limitations" hint="Shown as a warning on the profile"><Textarea value={f.injuries} onChange={(e) => setF({ ...f, injuries: e.target.value })} rows={2} /></Field>
      {err && <ErrorBox message={err} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={saving}>Save</Button>
      </div>
    </form>
  );
}
