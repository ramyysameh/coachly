"use client";
import Link from "next/link";
import NumberFlow from "@number-flow/react";
import { AlertTriangle, CalendarX, ChevronRight, Dumbbell, Flag as FlagIcon, MessageCircle, Scale, TrendingUp, UserPlus, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { useProfile } from "@/components/AppShell";
import { Avatar, Badge, Card, Empty, ErrorBox, LinkButton, PageHeader, Skeleton } from "@/components/ui";
import { addDays, fmtDate, fmtDateTime, localDate, type Unit } from "@/lib/utils";
import { PLAN_SELECT, type Plan } from "@/lib/data";
import type { CalSession } from "@/lib/calendar";
import type { SetRow } from "@/lib/analytics";
import { clientFlags, type Flag, type FlagKind } from "@/lib/flags";

type ClientRow = { client_id: string; status: string; profiles: { id: string; full_name: string; goal: string | null; goal_type: string | null; weight_unit: Unit } };
type Recent = { id: string; name: string; scheduled_date: string; completed_at: string; client_id: string; profiles: { full_name: string } };
type Missed = { client_id: string; scheduled_date: string; day_name: string };

export default function CoachDashboard() {
  const supabase = createClient();
  const { profile, unread } = useProfile();
  const today = localDate();

  const { data, loading, error, reload } = useAsync(async () => {
    const clients = must(
      await supabase.from("coach_clients").select("client_id, status, profiles!coach_clients_client_id_fkey(id, full_name, goal, goal_type, weight_unit)").eq("coach_id", profile.id).eq("status", "active"),
    ) as unknown as ClientRow[];
    const ids = clients.map((c) => c.client_id);
    const idList = ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];
    const [recent, convs, unreadRows, lastByClient, missed, allSets, plans, sessions, weights] = await Promise.all([
      supabase.from("workout_sessions").select("id, name, scheduled_date, completed_at, client_id, profiles(full_name)").in("client_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).eq("status", "completed").order("completed_at", { ascending: false }).limit(8),
      supabase.from("conversations").select("id, client_id").eq("coach_id", profile.id),
      supabase.rpc("unread_counts"),
      supabase.from("workout_sessions").select("client_id, completed_at").in("client_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).eq("status", "completed").order("completed_at", { ascending: false }).limit(500),
      supabase.rpc("coach_missed_sessions", { p_from: addDays(today, -14), p_to: addDays(today, -1) }),
      // for the flag list: sets, plans, sessions and weigh-ins of every active client
      supabase.rpc("coach_completed_sets", { p_from: addDays(today, -120), p_to: today }),
      supabase.from("plans").select(PLAN_SELECT).in("client_id", idList).eq("is_active", true),
      supabase.from("workout_sessions").select("id, client_id, scheduled_date, name, status, plan_day_id, started_at, completed_at")
        .in("client_id", idList).gte("scheduled_date", addDays(today, -91)).order("scheduled_date"),
      supabase.from("body_weights").select("client_id, entry_date, weight_kg").in("client_id", idList).gte("entry_date", addDays(today, -27)),
    ]);
    const setRows = must(allSets) as (SetRow & { client_id: string })[];
    const planRows = must(plans) as Plan[];
    const sessionRows = must(sessions) as (CalSession & { client_id: string })[];
    const weightRows = must(weights) as { client_id: string; entry_date: string; weight_kg: number }[];
    const flags: Flag[] = clients.flatMap((c) => clientFlags({
      clientId: c.client_id,
      goalType: c.profiles.goal_type,
      unit: c.profiles.weight_unit,
      plan: planRows.find((p) => p.client_id === c.client_id) ?? null,
      sessions: sessionRows.filter((s) => s.client_id === c.client_id),
      sets: setRows.filter((s) => s.client_id === c.client_id),
      weights: weightRows.filter((w) => w.client_id === c.client_id),
    }, today));
    const convByClient = Object.fromEntries((must(convs) as { id: string; client_id: string }[]).map((c) => [c.client_id, c.id]));
    const unreadByConv = Object.fromEntries((must(unreadRows) as { conversation_id: string; unread: number }[]).map((u) => [u.conversation_id, Number(u.unread)]));
    const last: Record<string, string> = {};
    for (const r of must(lastByClient) as { client_id: string; completed_at: string }[]) last[r.client_id] ??= r.completed_at;
    const missedAll = must(missed) as Missed[];
    return {
      clients: clients.map((c) => ({
        ...c.profiles,
        lastWorkout: last[c.client_id] ?? null,
        missed: missedAll.filter((m) => m.client_id === c.client_id).length,
        unread: unreadByConv[convByClient[c.client_id]] ?? 0,
      })),
      recent: must(recent) as unknown as Recent[],
      missed: missedAll.sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date)),
      names: Object.fromEntries(clients.map((c) => [c.client_id, c.profiles.full_name])),
      flags,
    };
  }, [profile.id, today]);

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle={`Welcome back, ${profile.full_name.split(" ")[0] || "coach"}`} action={<LinkButton href="/coach/invite" className="hidden sm:inline-flex"><UserPlus className="size-4" /> Invite client</LinkButton>} />

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : error || !data ? (
        <ErrorBox message={error ?? "Couldn't load dashboard"} onRetry={reload} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icon={<Users className="size-5" />} label="Active clients" value={data.clients.length} />
            <StatCard icon={<Dumbbell className="size-5" />} label="Workouts (7 days)" value={data.recent.filter((r) => r.scheduled_date >= addDays(today, -6)).length} />
            <StatCard icon={<AlertTriangle className="size-5" />} label="Missed (14 days)" value={data.missed.length} tone={data.missed.length ? "warn" : undefined} />
            <StatCard icon={<MessageCircle className="size-5" />} label="Unread messages" value={unread} tone={unread ? "brand" : undefined} href="/coach/messages" />
          </div>

          <FlagList flags={data.flags} names={data.names} />

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <section>
              <h2 className="mb-3 font-semibold tracking-tight">Active clients</h2>
              {data.clients.length === 0 ? (
                <Empty icon={<Users className="size-8" />} title="No clients yet">
                  <LinkButton href="/coach/invite" className="mt-3">Invite your first client</LinkButton>
                </Empty>
              ) : (
                <ul className="space-y-2">
                  {data.clients.map((c) => (
                    <li key={c.id}>
                      <Link href={`/coach/clients/${c.id}`} className="flex min-h-16 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-card transition-[border-color,transform] duration-150 hover:border-brand/40 active:scale-[0.99]">
                        <Avatar name={c.full_name} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{c.full_name}</p>
                          <p className="truncate text-xs text-muted">
                            {c.lastWorkout ? `Last workout ${fmtDateTime(c.lastWorkout)}` : "No workouts yet"}
                            {c.goal ? ` · ${c.goal}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          {c.unread > 0 && <Badge tone="brand">{c.unread} unread</Badge>}
                          {c.missed > 0 && <Badge tone="warn">{c.missed} missed</Badge>}
                        </div>
                        <ChevronRight className="size-5 text-muted" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="space-y-6">
              <section>
                <h2 className="mb-3 font-semibold tracking-tight">Recent workouts</h2>
                <Card className="p-0">
                  {data.recent.length === 0 ? (
                    <p className="p-4 text-sm text-muted">No completed workouts yet.</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {data.recent.map((r) => (
                        <li key={r.id}>
                          <Link href={`/coach/clients/${r.client_id}?tab=workouts&session=${r.id}`} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-surface-2">
                            <span className="flex-1">
                              <span className="font-semibold">{r.profiles.full_name}</span> · {r.name}
                            </span>
                            <span className="text-xs text-muted">{fmtDate(r.scheduled_date)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </section>
              <section>
                <h2 className="mb-3 font-semibold tracking-tight">Missed sessions</h2>
                <Card className="p-0">
                  {data.missed.length === 0 ? (
                    <p className="p-4 text-sm text-muted">Nothing missed in the last 14 days.</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {data.missed.slice(0, 8).map((m) => (
                        <li key={m.client_id + m.scheduled_date + m.day_name}>
                          <Link href={`/coach/clients/${m.client_id}`} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-surface-2">
                            <span className="flex-1"><span className="font-semibold">{data.names[m.client_id]}</span> · {m.day_name}</span>
                            <span className="text-xs text-warn">{fmtDate(m.scheduled_date)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const FLAG_ICON: Record<FlagKind, React.ReactNode> = {
  missed: <CalendarX className="size-4" />,
  stalled: <Dumbbell className="size-4" />,
  volume: <TrendingUp className="size-4" />,
  bodyweight: <Scale className="size-4" />,
};
const FLAG_KIND: Record<FlagKind, string> = { missed: "Missed sessions", stalled: "Strength stalled", volume: "Volume jump", bodyweight: "Bodyweight vs goal" };

/** Coach-only: one list of automatic flags across all active clients. */
function FlagList({ flags, names }: { flags: Flag[]; names: Record<string, string> }) {
  return (
    <section aria-labelledby="flags-heading">
      <h2 id="flags-heading" className="mb-3 flex items-center gap-2 font-semibold tracking-tight">
        <FlagIcon className="size-4 text-warn" aria-hidden /> Needs attention
        {flags.length > 0 && <Badge tone="warn">{flags.length}</Badge>}
      </h2>
      <Card className="p-0">
        {flags.length === 0 ? (
          <p className="p-4 text-sm text-muted">No flags. Every active client is training as planned, progressing, and moving towards their goal.</p>
        ) : (
          <ul className="divide-y divide-line">
            {flags.map((f, i) => (
              <li key={`${f.clientId}-${f.kind}-${i}`}>
                <Link href={`/coach/clients/${f.clientId}?tab=${f.tab}`} className="flex items-start gap-3 px-4 py-3 text-sm hover:bg-surface-2">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-warn-bg text-warn" aria-hidden>{FLAG_ICON[f.kind]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block"><span className="font-semibold">{names[f.clientId]}</span> · {f.title}</span>
                    <span className="block text-xs text-muted"><span className="sr-only">{FLAG_KIND[f.kind]}: </span>{f.detail}</span>
                  </span>
                  <ChevronRight className="mt-1 size-4 shrink-0 text-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function StatCard({ icon, label, value, tone, href }: { icon: React.ReactNode; label: string; value: number; tone?: "warn" | "brand"; href?: string }) {
  const body = (
    <Card className={tone === "warn" ? "border-warn-line bg-warn-bg/50" : tone === "brand" ? "border-brand/30 bg-brand/5" : ""}>
      <div className="flex items-center gap-2 text-muted [&_svg]:size-4">{icon}<span className="text-xs font-medium">{label}</span></div>
      <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums"><NumberFlow value={value} /></p>
    </Card>
  );
  return href ? <Link href={href} className="block rounded-2xl transition-transform duration-150 active:scale-[0.98]">{body}</Link> : body;
}
