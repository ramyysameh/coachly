"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { useProfile } from "@/components/AppShell";
import ChatThread from "@/components/ChatThread";
import { Avatar, Badge, Empty, ErrorBox, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

type Conv = { id: string; client_id: string; client: { full_name: string }; coach_clients: { status: "active" | "archived" } };

function MessagesInner() {
  const supabase = createClient();
  const router = useRouter();
  const selected = useSearchParams().get("client");
  const { profile, unread } = useProfile();

  const { data, loading, error, reload } = useAsync(async () => {
    const [convs, counts] = await Promise.all([
      supabase.from("conversations").select("id, client_id, client:profiles!conversations_client_id_fkey(full_name), coach_clients(status)").eq("coach_id", profile.id),
      supabase.rpc("unread_counts"),
    ]);
    const byConv = Object.fromEntries((must(counts) as { conversation_id: string; unread: number }[]).map((c) => [c.conversation_id, Number(c.unread)]));
    return (must(convs) as unknown as Conv[])
      .map((c) => ({ ...c, unread: byConv[c.id] ?? 0 }))
      .sort((a, b) => (a.coach_clients.status === b.coach_clients.status ? a.client.full_name.localeCompare(b.client.full_name) : a.coach_clients.status === "active" ? -1 : 1));
    // refetch when total unread changes so per-thread badges stay current
  }, [profile.id, unread]);

  const current = data?.find((c) => c.client_id === selected);

  return (
    <div className="-mx-4 -mt-4 flex overflow-hidden bg-white md:mx-0 md:mt-0 md:rounded-2xl md:border md:border-line"
      style={{ height: "calc(100dvh - 3.5rem - 4rem - env(safe-area-inset-bottom))" }}>
      <aside className={cn("w-full shrink-0 overflow-y-auto border-r border-line md:block md:w-72", current && "hidden")}>
        <h1 className="border-b border-line px-4 py-3 text-lg font-bold">Messages</h1>
        {loading && !data ? <Spinner /> : error ? <div className="p-3"><ErrorBox message={error} onRetry={reload} /></div> : data!.length === 0 ? (
          <div className="p-3"><Empty icon={<MessageCircle className="size-8" />} title="No conversations">Conversations start when a client accepts your invite.</Empty></div>
        ) : (
          <ul>
            {data!.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => router.replace(`/coach/messages?client=${c.client_id}`)}
                  className={cn("flex min-h-16 w-full items-center gap-3 border-b border-line px-4 py-2 text-left hover:bg-paper", c.client_id === selected && "bg-brand/5")}
                >
                  <Avatar name={c.client.full_name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{c.client.full_name}</span>
                    {c.coach_clients.status === "archived" && <span className="text-xs text-muted">Archived</span>}
                  </span>
                  {c.unread > 0 && <Badge tone="brand">{c.unread}</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className={cn("min-w-0 flex-1 flex-col bg-paper", current ? "flex" : "hidden md:flex")}>
        {current ? (
          <>
            <button onClick={() => router.replace("/coach/messages")} className="flex min-h-10 items-center gap-1 border-b border-line bg-white px-3 text-sm font-semibold text-muted md:hidden">
              <ChevronLeft className="size-4" /> All conversations
            </button>
            <div className="min-h-0 flex-1">
              <ChatThread key={current.id} conversationId={current.id} otherName={current.client.full_name} canSend={current.coach_clients.status === "active"} />
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-muted">Select a conversation</div>
        )}
      </section>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <MessagesInner />
    </Suspense>
  );
}
