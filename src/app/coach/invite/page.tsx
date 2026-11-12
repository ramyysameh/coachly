"use client";
import { useState } from "react";
import { Check, Copy, Link2, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { useProfile } from "@/components/AppShell";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { errMsg, fmtDateTime } from "@/lib/utils";

type Invite = { id: string; token: string; note: string | null; expires_at: string; accepted_at: string | null; revoked: boolean; created_at: string; accepted: { full_name: string } | null };

function status(i: Invite) {
  if (i.revoked) return { label: "Revoked", tone: "neutral" as const };
  if (i.accepted_at) return { label: "Accepted", tone: "brand" as const };
  if (new Date(i.expires_at) < new Date()) return { label: "Expired", tone: "neutral" as const };
  return { label: "Pending", tone: "warn" as const };
}

export default function InvitePage() {
  const supabase = createClient();
  const { profile } = useProfile();
  const [note, setNote] = useState("");
  const [days, setDays] = useState("7");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const { data, loading, error: loadError, reload } = useAsync(
    async () =>
      must(
        await supabase
          .from("invitations")
          .select("*, accepted:profiles!invitations_accepted_by_fkey(full_name)")
          .eq("coach_id", profile.id)
          .order("created_at", { ascending: false }),
      ) as unknown as Invite[],
    [profile.id],
  );

  const link = (token: string) => `${window.location.origin}/invite/${token}`;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    const expires = new Date(Date.now() + Number(days) * 86400_000).toISOString();
    const { data: inv, error } = await supabase
      .from("invitations")
      .insert({ coach_id: profile.id, note: note.trim() || null, expires_at: expires })
      .select("token")
      .single();
    setCreating(false);
    if (error) return setError(errMsg(error));
    setNote("");
    await copy(inv.token);
    reload({ silent: true });
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(link(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      prompt("Copy this invite link:", link(token));
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this invite link? It will stop working immediately.")) return;
    const { error } = await supabase.from("invitations").update({ revoked: true }).eq("id", id);
    if (error) return alert(errMsg(error));
    reload({ silent: true });
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Invite a client" subtitle="Each link is private, single-use and expires." />
      <Card>
        <form onSubmit={create} className="space-y-3" noValidate>
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
            <Field label="Who is this for? (only you see this)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Jordan from the 6am class" /></Field>
            <Field label="Expires in">
              <Select value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="1">1 day</option>
                <option value="3">3 days</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
              </Select>
            </Field>
          </div>
          {error && <ErrorBox message={error} />}
          <Button type="submit" loading={creating}><UserPlus className="size-4" /> Create &amp; copy link</Button>
        </form>
      </Card>

      <section>
        <h2 className="mb-3 font-semibold tracking-tight">Your invite links</h2>
        {loading ? <Spinner /> : loadError ? <ErrorBox message={loadError} onRetry={reload} /> : data!.length === 0 ? (
          <Empty icon={<Link2 className="size-8" />} title="No invites yet" />
        ) : (
          <ul className="space-y-2">
            {data!.map((i) => {
              const s = status(i);
              return (
                <li key={i.id} className="rounded-2xl border border-line bg-surface p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="flex-1 font-semibold">{i.note || "Invite link"}</p>
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {i.accepted_at ? `Accepted by ${i.accepted?.full_name ?? "a client"} ${fmtDateTime(i.accepted_at)}` : `Expires ${fmtDateTime(i.expires_at)}`}
                  </p>
                  {s.label === "Pending" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-lg bg-paper px-2 py-2 text-xs" data-testid="invite-link">{link(i.token)}</code>
                      <Button size="sm" variant="secondary" onClick={() => copy(i.token)}>
                        {copied === i.token ? <><Check className="size-4" /> Copied</> : <><Copy className="size-4" /> Copy</>}
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => revoke(i.id)}>Revoke</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
