"use client";
import Link from "next/link";
import { ChevronRight, UserPlus, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { useProfile } from "@/components/AppShell";
import { Avatar, Badge, Empty, ErrorBox, LinkButton, PageHeader, Spinner } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

type Row = { client_id: string; status: "active" | "archived"; created_at: string; archived_at: string | null; profiles: { full_name: string; goal: string | null } };

export default function ClientsPage() {
  const supabase = createClient();
  const { profile } = useProfile();
  const { data, loading, error, reload } = useAsync(
    async () =>
      must(
        await supabase
          .from("coach_clients")
          .select("client_id, status, created_at, archived_at, profiles!coach_clients_client_id_fkey(full_name, goal)")
          .eq("coach_id", profile.id)
          .order("created_at", { ascending: false }),
      ) as unknown as Row[],
    [profile.id],
  );

  const groups = { active: data?.filter((r) => r.status === "active") ?? [], archived: data?.filter((r) => r.status === "archived") ?? [] };

  return (
    <div className="space-y-5">
      <PageHeader title="Clients" action={<LinkButton href="/coach/invite"><UserPlus className="size-4" /> Invite</LinkButton>} />
      {loading ? <Spinner /> : error ? <ErrorBox message={error} onRetry={reload} /> : data!.length === 0 ? (
        <Empty icon={<Users className="size-8" />} title="No clients yet">Send an invite link to connect your first client.</Empty>
      ) : (
        (["active", "archived"] as const).map((g) =>
          groups[g].length ? (
            <section key={g}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{g} ({groups[g].length})</h2>
              <ul className="space-y-2">
                {groups[g].map((r) => (
                  <li key={r.client_id}>
                    <Link href={`/coach/clients/${r.client_id}`} className="flex min-h-16 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 hover:border-brand/40">
                      <Avatar name={r.profiles.full_name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{r.profiles.full_name}</p>
                        <p className="truncate text-xs text-muted">
                          {r.status === "archived" && r.archived_at ? `Archived ${fmtDate(r.archived_at.slice(0, 10))}` : `Since ${fmtDate(r.created_at.slice(0, 10))}`}
                          {r.profiles.goal ? ` · ${r.profiles.goal}` : ""}
                        </p>
                      </div>
                      {r.status === "archived" && <Badge>Archived</Badge>}
                      <ChevronRight className="size-5 text-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null,
        )
      )}
    </div>
  );
}
