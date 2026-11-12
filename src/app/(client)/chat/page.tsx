"use client";
import { MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { useProfile } from "@/components/AppShell";
import ChatThread from "@/components/ChatThread";
import { Empty, ErrorBox, Spinner } from "@/components/ui";

type Conv = { id: string; coach: { full_name: string }; coach_clients: { status: "active" | "archived" } };

export default function ChatPage() {
  const supabase = createClient();
  const { profile } = useProfile();
  const { data, loading, error, reload } = useAsync(async () => {
    const rows = must(
      await supabase
        .from("conversations")
        .select("id, created_at, coach:profiles!conversations_coach_id_fkey(full_name), coach_clients(status)")
        .eq("client_id", profile.id)
        .order("created_at", { ascending: false }),
    ) as unknown as Conv[];
    return rows.find((r) => r.coach_clients.status === "active") ?? rows[0] ?? null;
  }, [profile.id]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Empty icon={<MessageCircle className="size-8" />} title="No coach yet">Once you accept a coach&apos;s invite you can chat here.</Empty>;

  return (
    <div className="-mx-4 -mt-4 flex flex-col bg-paper md:mx-0 md:mt-0 md:rounded-2xl md:border md:border-line md:bg-surface"
      style={{ height: "calc(100dvh - 3.5rem - 4rem - env(safe-area-inset-bottom))" }}>
      <ChatThread conversationId={data.id} otherName={data.coach.full_name} canSend={data.coach_clients.status === "active"} />
    </div>
  );
}
