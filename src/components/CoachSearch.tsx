"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Command, useCommandState } from "cmdk";
import { BookOpen, ClipboardList, Dumbbell, LayoutDashboard, MessageCircle, Plus, Search, User, UserPlus, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { must, useAsync } from "@/lib/useAsync";
import { wordFilter } from "@/lib/commandFilter";
// Not useLibrary(): ExerciseLibrary imports AppShell, and AppShell renders this, so that would be an import cycle.
import { Sheet } from "@/components/Sheet";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";

type ClientRow = { client_id: string; status: string; profiles: { full_name: string } | null };
type PlanRow = { id: string; name: string };
type ExerciseRow = { id: string; name: string; equipment: string | null; movements: { name: string } | null };

const GO_TO = [
  { href: "/coach", label: "Dashboard", icon: LayoutDashboard },
  { href: "/coach/clients", label: "Clients", icon: Users },
  { href: "/coach/plans", label: "Plans", icon: ClipboardList },
  { href: "/coach/library", label: "Library", icon: BookOpen },
  { href: "/coach/messages", label: "Messages", icon: MessageCircle },
  { href: "/coach/invite", label: "Invite", icon: UserPlus },
];

/**
 * Coach search palette: a 44px Search button plus Ctrl/⌘K, opening a bottom sheet with a cmdk list of
 * clients, plans, exercises, pages and actions. No motion of its own; the drawer slide is the only animation.
 * AppShell renders one per layout (phone header, desktop sidebar); only the visible one answers ⌘K.
 */
export default function CoachSearch({ coachId, className }: { coachId: string; className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k" || e.altKey || e.shiftKey) return;
      // Both AppShell instances listen; only the one whose button is on screen acts.
      if (!trigger.current?.offsetParent) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        aria-keyshortcuts="Control+K Meta+K"
        className={cn("flex min-h-11 min-w-11 items-center gap-2 rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-ink active:bg-surface-2", className)}
      >
        <Search className="size-[18px]" strokeWidth={1.75} aria-hidden />
        <span className="hidden flex-1 text-left text-sm md:inline">Search</span>
        <kbd className="hidden rounded-md border border-line px-1.5 font-mono text-[11px] text-muted md:inline">⌘K</kbd>
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="Search" initialFocus="[cmdk-input]">
        {/* Mounted only while the sheet is open, so data loads on open, not with the app. */}
        <SearchList coachId={coachId} go={go} />
      </Sheet>
    </>
  );
}

function SearchList({ coachId, go }: { coachId: string; go: (href: string) => void }) {
  const supabase = createClient();
  const { data, loading, error } = useAsync(async () => {
    const [clients, plans, exercises] = await Promise.all([
      supabase.from("coach_clients").select("client_id, status, profiles!coach_clients_client_id_fkey(full_name)").eq("coach_id", coachId),
      supabase.from("plans").select("id, name").eq("coach_id", coachId).is("client_id", null).order("created_at", { ascending: false }),
      supabase.from("exercises").select("id, name, equipment, movements(name)").order("name"),
    ]);
    const rows = (must(clients) as unknown as ClientRow[]).sort((a, b) => (a.profiles?.full_name ?? "").localeCompare(b.profiles?.full_name ?? ""));
    return { clients: rows, plans: must(plans) as PlanRow[], exercises: must(exercises) as unknown as ExerciseRow[] };
  }, [coachId]);

  return (
    <Command loop label="Search clients, plans and pages" filter={wordFilter} className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Command.Input
          placeholder="Clients, plans, exercises, pages…"
          className="min-h-12 w-full rounded-xl border border-line bg-surface pr-3 pl-9 text-base outline-none focus:border-brand"
        />
      </div>
      <Command.List className="pb-2">
        {loading && <Command.Loading><p className="p-4 text-center text-sm text-muted">Loading…</p></Command.Loading>}
        {error && <p className="p-4 text-center text-sm text-danger" role="alert">{error}</p>}
        <Command.Empty className="p-6 text-center text-sm text-muted">No results</Command.Empty>

        <Group heading="Actions">
          <Row value="action:invite" keywords={["Invite client", "add"]} onSelect={() => go("/coach/invite")} icon={<UserPlus />}>Invite client</Row>
          <Row value="action:new-plan" keywords={["New plan", "create template"]} onSelect={() => go("/coach/plans")} icon={<Plus />}>New plan</Row>
        </Group>

        {data && data.clients.length > 0 && (
          <Group heading="Clients">
            {data.clients.map((c) => {
              const name = c.profiles?.full_name || "Unnamed client";
              return (
                <Row key={c.client_id} value={`client:${c.client_id}`} keywords={[name]} onSelect={() => go(`/coach/clients/${c.client_id}`)} icon={<User />}>
                  <span className="truncate">{name}</span>
                  {c.status !== "active" && <Badge>{c.status === "archived" ? "Archived" : c.status}</Badge>}
                </Row>
              );
            })}
          </Group>
        )}

        {data && data.clients.length > 0 && (
          <WhenSearching>
            <Group heading="Message">
              {data.clients.map((c) => {
                const name = c.profiles?.full_name || "Unnamed client";
                return (
                  <Row key={c.client_id} value={`message:${c.client_id}`} keywords={[`Message ${name}`, "chat"]} onSelect={() => go(`/coach/messages?client=${c.client_id}`)} icon={<MessageCircle />}>
                    <span className="truncate">Message {name}</span>
                  </Row>
                );
              })}
            </Group>
          </WhenSearching>
        )}

        {data && data.plans.length > 0 && (
          <Group heading="Plans">
            {data.plans.map((p) => (
              <Row key={p.id} value={`plan:${p.id}`} keywords={[p.name, "template"]} onSelect={() => go(`/coach/plans/${p.id}`)} icon={<ClipboardList />}>
                <span className="truncate">{p.name}</span>
              </Row>
            ))}
          </Group>
        )}

        {data && data.exercises.length > 0 && (
          <WhenSearching>
            <Group heading="Exercises">
              {data.exercises.map((e) => (
                <Row key={e.id} value={`exercise:${e.id}`} keywords={[e.name, e.movements?.name, e.equipment].filter((k): k is string => !!k)} onSelect={() => go("/coach/library")} icon={<Dumbbell />}>
                  <span className="truncate">{e.name}</span>
                </Row>
              ))}
            </Group>
          </WhenSearching>
        )}

        <Group heading="Go to">
          {GO_TO.map((n) => (
            <Row key={n.href} value={`go:${n.href}`} keywords={[n.label, "page"]} onSelect={() => go(n.href)} icon={<n.icon />}>{n.label}</Row>
          ))}
        </Group>
      </Command.List>
    </Command>
  );
}

/** Long groups (messages, exercises) only appear once the coach starts typing. */
function WhenSearching({ children }: { children: ReactNode }) {
  const search = useCommandState((s) => s.search);
  return search.trim() ? <>{children}</> : null;
}

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted [&_[cmdk-group-heading]]:uppercase"
    >
      {children}
    </Command.Group>
  );
}

function Row({ value, keywords, onSelect, icon, children }: { value: string; keywords: string[]; onSelect: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      onSelect={onSelect}
      className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 text-[15px] data-[selected=true]:bg-surface-2 [&>svg]:size-[18px] [&>svg]:shrink-0 [&>svg]:text-muted"
    >
      {icon}
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
    </Command.Item>
  );
}
