"use client";
import Link from "next/link";
import { AlertTriangle, ChevronRight, Dumbbell, MessageCircle, UserPlus, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { useProfile } from "@/components/AppShell";
import { Avatar, Badge, Card, Empty, ErrorBox, LinkButton, PageHeader, Skeleton } from "@/components/ui";
import { addDays, fmtDate, fmtDateTime, localDate } from "@/lib/utils";

type ClientRow = { client_id: string; status: string; profiles: { id: string; full_name: string; goal: string | null } };
type Recent = { id: string; name: string; scheduled_date: string; completed_at: string; client_id: string; profiles: { full_name: string } };
type Missed = { client_id: string; scheduled_date: string; day_name: string };

export default function CoachDashboard() {
  const supabase = createClient();
  const { profile, unread } = useProfile();
  const today = localDate();

  const { data, loading, error, reload } = useAsync(async () => {
    const clients = must(
      await supabase.from("coach_clients").select("client_id, status, profiles!coach_clients_client_id_fkey(id, full_name, goal)").eq("coach_id", profile.id).eq("status", "active"),
    ) as unknown as ClientRow[];
    const ids = clients.map((c) => c.client_id);
    const [recent, convs, unreadRows, lastByClient, ...missed] = await Promise.all([
      supabase.from("workout_sessions").select("id, name, scheduled_date, completed_at, client_id, profiles(full_name)").in("client_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).eq("status", "completed").order("completed_at", { ascending: false }).limit(8),
      supabase.from("conversations").select("id, client_id").eq("coach_id", profile.id),
      supabase.rpc("unread_counts"),
      supabase.from("workout_sessions").select("client_id, completed_at").in("client_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).eq("status", "completed").order("completed_at", { ascending: false }).limit(500),
      ...ids.map((id) => supabase.rpc("missed_sessions", { p_client: id, p_from: addDays(today, -14), p_to: addDays(today, -1) })),
    ]);
    const convByClient = Object.fromEntries((must(convs) as { id: string; client_id: string }[]).map((c) => [c.client_id, c.id]));
    const unreadByConv = Object.fromEntries((must(unreadRows) as { conversation_id: string; unread: number }[]).map((u) => [u.conversation_id, Number(u.unread)]));
    const last: Record<string, string> = {};
    for (const r of must(lastByClient) as { client_id: string; completed_at: string }[]) last[r.client_id] ??= r.completed_at;
    const missedAll: Missed[] = missed.flatMap((m, i) => (must(m) as Omit<Missed, "client_id">[]).map((x) => ({ ...x, client_id: ids[i] })));
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

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <section>
              <h2 className="mb-2 font-bold">Active clients</h2>
              {data.clients.length === 0 ? (
                <Empty icon={<Users className="size-8" />} title="No clients yet">
                  <LinkButton href="/coach/invite" className="mt-3">Invite your first client</LinkButton>
                </Empty>
              ) : (
                <ul className="space-y-2">
                  {data.clients.map((c) => (
                    <li key={c.id}>
                      <Link href={`/coach/clients/${c.id}`} className="flex min-h-16 items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 hover:border-brand/40">
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
                <h2 className="mb-2 font-bold">Recent workouts</h2>
                <Card className="p-0">
                  {data.recent.length === 0 ? (
                    <p className="p-4 text-sm text-muted">No completed workouts yet.</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {data.recent.map((r) => (
                        <li key={r.id}>
                          <Link href={`/coach/clients/${r.client_id}?tab=workouts&session=${r.id}`} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-paper">
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
                <h2 className="mb-2 font-bold">Missed sessions</h2>
                <Card className="p-0">
                  {data.missed.length === 0 ? (
                    <p className="p-4 text-sm text-muted">Nothing missed in the last 14 days. 🎉</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {data.missed.slice(0, 8).map((m) => (
                        <li key={m.client_id + m.scheduled_date + m.day_name}>
                          <Link href={`/coach/clients/${m.client_id}`} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-paper">
                            <span className="flex-1"><span className="font-semibold">{data.names[m.client_id]}</span> · {m.day_name}</span>
                            <span className="text-xs text-amber-700">{fmtDate(m.scheduled_date)}</span>
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

function StatCard({ icon, label, value, tone, href }: { icon: React.ReactNode; label: string; value: number; tone?: "warn" | "brand"; href?: string }) {
  const body = (
    <Card className={tone === "warn" ? "border-amber-200 bg-amber-50/50" : tone === "brand" ? "border-brand/30 bg-brand/5" : ""}>
      <div className="flex items-center gap-2 text-muted">{icon}<span className="text-xs font-semibold">{label}</span></div>
      <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
