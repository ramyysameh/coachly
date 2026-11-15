"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, Dumbbell, Medal, Scale, Search, UserPlus, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { useProfile } from "@/components/AppShell";
import { Avatar, Badge, Empty, ErrorBox, Input, LinkButton, PageHeader, Spinner, Tabs } from "@/components/ui";
import { PLAN_SELECT, type Plan } from "@/lib/data";
import type { CalSession } from "@/lib/calendar";
import type { SetRow } from "@/lib/analytics";
import { ago, clientStats, consistencyTone, type ClientStats } from "@/lib/clientStats";
import { goalLabel, levelLabel } from "@/lib/profile";
import { addDays, cn, fmtDate, fromKg, localDate, type Unit } from "@/lib/utils";

type Rel = { client_id: string; status: "active" | "archived"; created_at: string; archived_at: string | null };
type Prof = {
  id: string; full_name: string; avatar_url: string | null; goal: string | null; goal_type: string | null; experience_level: string | null;
  date_of_birth: string | null; weight_unit: Unit; training_days_per_week: number | null; injuries: string | null;
};
type Row = Rel & { profile: Prof; stats: ClientStats };
type Sort = "attention" | "name" | "recent";

const NONE = "00000000-0000-0000-0000-000000000000";

export default function ClientsPage() {
  const supabase = createClient();
  const { profile } = useProfile();
  const today = localDate();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("attention");

  const { data, loading, error, reload } = useAsync(async () => {
    const rels = must(
      await supabase.from("coach_clients").select("client_id, status, created_at, archived_at").eq("coach_id", profile.id).order("created_at", { ascending: false }),
    ) as Rel[];
    // A client can appear twice if they were archived and re-invited: keep the newest relationship.
    const seen = new Set<string>();
    const latest = rels.filter((r) => !seen.has(r.client_id) && !!seen.add(r.client_id));
    const ids = latest.map((r) => r.client_id);
    const idList = ids.length ? ids : [NONE];
    const [profs, plans, sessions, weights, sets] = await Promise.all([
      supabase.from("profiles").select("id, full_name, avatar_url, goal, goal_type, experience_level, date_of_birth, weight_unit, training_days_per_week, injuries").in("id", idList),
      supabase.from("plans").select(PLAN_SELECT).in("client_id", idList).eq("is_active", true),
      supabase.from("workout_sessions").select("id, client_id, scheduled_date, name, status, plan_day_id, started_at, completed_at")
        .in("client_id", idList).gte("scheduled_date", addDays(today, -91)).order("scheduled_date"),
      supabase.from("body_weights").select("client_id, entry_date, weight_kg").in("client_id", idList).gte("entry_date", addDays(today, -120)),
      // Active clients' sets for a year, so PRs are judged against real records (archived clients get none).
      supabase.rpc("coach_completed_sets", { p_from: addDays(today, -365), p_to: today }),
    ]);
    const profById = new Map((must(profs) as Prof[]).map((p) => [p.id, p]));
    const planRows = must(plans) as Plan[];
    const sessionRows = must(sessions) as (CalSession & { client_id: string })[];
    const weightRows = must(weights) as { client_id: string; entry_date: string; weight_kg: number }[];
    const setRows = (sets.error ? [] : sets.data) as (SetRow & { client_id: string })[];
    return latest.flatMap((r): Row[] => {
      const p = profById.get(r.client_id);
      if (!p) return [];
      const stats = clientStats({
        profile: p,
        plan: planRows.find((x) => x.client_id === p.id) ?? null,
        sessions: sessionRows.filter((s) => s.client_id === p.id),
        sets: setRows.filter((s) => s.client_id === p.id),
        weights: weightRows.filter((w) => w.client_id === p.id),
      }, today);
      return [{ ...r, profile: p, stats }];
    });
  }, [profile.id, today]);

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const rows = (data ?? []).filter((r) => !term || r.profile.full_name.toLowerCase().includes(term));
    const by: Record<Sort, (a: Row, b: Row) => number> = {
      name: (a, b) => a.profile.full_name.localeCompare(b.profile.full_name),
      recent: (a, b) => (b.stats.lastWorkout ?? "").localeCompare(a.stats.lastWorkout ?? ""),
      // most flags first, then lowest consistency
      attention: (a, b) => b.stats.flags.length - a.stats.flags.length || (a.stats.consistency ?? 101) - (b.stats.consistency ?? 101),
    };
    rows.sort(by[sort]);
    return { active: rows.filter((r) => r.status === "active"), archived: rows.filter((r) => r.status === "archived") };
  }, [data, q, sort]);

  const active = data?.filter((r) => r.status === "active") ?? [];
  const needAttention = active.filter((r) => r.stats.flags.length > 0).length;
  const withConsistency = active.filter((r) => r.stats.consistency !== null);
  const avgConsistency = withConsistency.length ? Math.round(withConsistency.reduce((t, r) => t + r.stats.consistency!, 0) / withConsistency.length) : null;
  const prs = active.reduce((t, r) => t + r.stats.prs30, 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Clients" action={<LinkButton href="/coach/invite"><UserPlus className="size-4" /> Invite</LinkButton>} />
      {loading ? <Spinner label="Loading clients…" /> : error ? <ErrorBox message={error} onRetry={reload} /> : data!.length === 0 ? (
        <Empty icon={<Users className="size-8" />} title="No clients yet">Send an invite link to connect your first client.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Summary label="Active" value={String(active.length)} />
            <Summary label="Need attention" value={String(needAttention)} tone={needAttention ? "warn" : undefined} />
            <Summary label="Avg consistency" value={avgConsistency !== null ? `${avgConsistency}%` : "—"} />
            <Summary label="PRs (30 days)" value={String(prs)} tone={prs ? "brand" : undefined} />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative flex-1">
              <span className="sr-only">Search clients</span>
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" className="pl-10" />
            </label>
            <Tabs value={sort} onChange={setSort} options={[{ value: "attention", label: "Needs attention" }, { value: "recent", label: "Recent" }, { value: "name", label: "A–Z" }]} />
          </div>

          {(["active", "archived"] as const).map((g) =>
            groups[g].length ? (
              <section key={g}>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{g} ({groups[g].length})</h2>
                <ul className="grid gap-2 lg:grid-cols-2">
                  {groups[g].map((r) => <li key={r.client_id}><ClientCard row={r} today={today} /></li>)}
                </ul>
              </section>
            ) : null,
          )}
          {groups.active.length + groups.archived.length === 0 && <Empty title="No clients match that name" />}
        </>
      )}
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: "warn" | "brand" }) {
  return (
    <div className="panel rounded-2xl border border-line px-3 py-2.5 shadow-card">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={cn("font-display text-2xl font-bold tabular-nums", tone === "warn" && "text-warn", tone === "brand" && "text-brand-dark")}>{value}</p>
    </div>
  );
}

const TONE_BAR = { good: "bg-emerald-500", ok: "bg-warn-solid", low: "bg-brand", none: "bg-line" } as const;
const TONE_TEXT = { good: "text-emerald-400", ok: "text-warn", low: "text-brand-dark", none: "text-muted" } as const;

function ClientCard({ row, today }: { row: Row; today: string }) {
  const { profile: p, stats: s } = row;
  const unit = p.weight_unit;
  const tone = consistencyTone(s.consistency);
  const facts = [s.age !== null ? `${s.age} y` : null, goalLabel(p.goal_type), levelLabel(p.experience_level)].filter(Boolean).join(" · ");
  const change = s.weight?.change != null ? fromKg(s.weight.change, unit) ?? 0 : null;
  const archived = row.status === "archived";

  return (
    <Link
      href={`/coach/clients/${row.client_id}`}
      className="panel block rounded-2xl border border-line p-4 shadow-card transition-[border-color,transform] duration-150 hover:border-brand/40 active:scale-[0.99]"
    >
      <div className="flex items-center gap-3">
        <Avatar name={p.full_name} src={p.avatar_url} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate font-semibold">
            <span className="truncate">{p.full_name}</span>
            {archived && <Badge>Archived</Badge>}
          </p>
          <p className="truncate text-xs text-muted">{facts || (archived && row.archived_at ? `Archived ${fmtDate(row.archived_at.slice(0, 10))}` : "Profile not filled in")}</p>
        </div>
        <ChevronRight className="size-5 shrink-0 text-muted" />
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat icon={<Scale className="size-3.5" />} label="Weight" value={s.weight ? `${fromKg(s.weight.latest, unit)} ${unit}` : "—"}
          sub={change !== null ? `${change > 0 ? "+" : change < 0 ? "−" : "±"}${Math.abs(change)} / 30d` : undefined} />
        <Stat icon={<Dumbbell className="size-3.5" />} label="Last workout" value={ago(s.lastWorkout, today) ?? "None"}
          sub={s.week.target ? `${s.week.done}/${s.week.target} this week` : `${s.week.done} this week`} />
        <Stat icon={<Medal className="size-3.5" />} label="PRs 30d" value={String(s.prs30)} highlight={s.prs30 > 0}
          sub={s.streak > 1 ? `${s.streak} in a row` : undefined} />
      </dl>

      <div className="mt-3">
        <div className="mb-1 flex items-baseline justify-between text-xs">
          <span className="text-muted">Consistency (4 weeks)</span>
          <span className={cn("font-mono font-semibold tabular-nums", TONE_TEXT[tone])}>{s.consistency !== null ? `${s.consistency}%` : "No plan or target"}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className={cn("h-full rounded-full", TONE_BAR[tone])} style={{ width: `${s.consistency ?? 0}%` }} />
        </div>
      </div>

      {(s.flags.length > 0 || p.injuries) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {s.flags.slice(0, 2).map((f) => <Badge key={f.kind + f.title} tone="warn">{f.title}</Badge>)}
          {s.flags.length > 2 && <Badge tone="warn">+{s.flags.length - 2} more</Badge>}
          {p.injuries && <Badge tone="danger"><AlertTriangle className="mr-1 size-3" aria-hidden />Injury noted</Badge>}
        </div>
      )}
    </Link>
  );
}

function Stat({ icon, label, value, sub, highlight }: { icon: React.ReactNode; label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 px-2 py-2">
      <dt className="flex items-center justify-center gap-1 text-2xs font-medium text-muted">{icon}{label}</dt>
      <dd className={cn("truncate font-mono text-sm font-semibold tabular-nums", highlight && "text-brand-dark")}>{value}</dd>
      {sub && <dd className="truncate text-2xs text-muted">{sub}</dd>}
    </div>
  );
}
