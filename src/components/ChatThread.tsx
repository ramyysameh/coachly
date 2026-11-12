"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, RotateCw, Send } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/components/AppShell";
import { ErrorBox, Spinner } from "@/components/ui";
import { cn, errMsg, fmtDateTime } from "@/lib/utils";

type Msg = { id: string; conversation_id: string; sender_id: string; body: string; created_at: string; state?: "sending" | "failed" };

/** One private coach–client conversation with live updates. */
export default function ChatThread({ conversationId, otherName, canSend }: { conversationId: string; otherName: string; canSend: boolean }) {
  const supabase = createClient();
  const { profile, refreshUnread } = useProfile();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [live, setLive] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  function merge(incoming: Msg[]) {
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, { ...byId.get(m.id), ...m, state: undefined });
      return [...byId.values()].sort((a, b) => {
        // unsent messages stay at the bottom
        if (!!a.state !== !!b.state) return a.state ? 1 : -1;
        return a.created_at.localeCompare(b.created_at);
      });
    });
  }

  async function markRead() {
    await supabase.rpc("mark_conversation_read", { p_conversation: conversationId });
    refreshUnread();
  }

  async function load() {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) setError(errMsg(error));
    else {
      setError(null);
      merge((data as Msg[]).reverse());
    }
    setLoading(false);
  }

  useEffect(() => {
    // reset when switching conversations
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages([]);
    setLoading(true);
    load().then(markRead);
    const channel = supabase
      .channel(`chat-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload: { new: unknown }) => {
          const m = payload.new as Msg;
          merge([m]);
          if (m.sender_id !== profile.id && document.visibilityState === "visible") markRead();
        },
      )
      .subscribe((status: string) => {
        setLive(status === "SUBSCRIBED");
        // catch anything sent while we were disconnected
        if (status === "SUBSCRIBED") load();
      });
    const onVisible = () => {
      if (document.visibilityState === "visible") load().then(markRead);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function deliver(msg: Msg) {
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, state: "sending" } : m)));
    // Same id on every attempt + ignoreDuplicates → a retry can never create a second copy.
    const { error } = await supabase
      .from("messages")
      .upsert({ id: msg.id, conversation_id: conversationId, sender_id: profile.id, body: msg.body }, { onConflict: "id", ignoreDuplicates: true });
    if (error) {
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, state: "failed" } : m)));
      return;
    }
    // Fetch the stored row for its server timestamp.
    const { data } = await supabase.from("messages").select("*").eq("id", msg.id).maybeSingle();
    if (data) merge([data as Msg]);
    else setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, state: undefined } : m)));
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    if (body.length > 4000) return setError("Messages can be up to 4000 characters.");
    const msg: Msg = { id: crypto.randomUUID(), conversation_id: conversationId, sender_id: profile.id, body, created_at: new Date().toISOString(), state: "sending" };
    setMessages((prev) => [...prev, msg]);
    setText("");
    deliver(msg);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <p className="font-semibold">{otherName}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <span className={cn("size-2 rounded-full", live ? "bg-brand" : "bg-line")} aria-hidden />
            {live ? "Live" : "Connecting…"}
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-4" aria-live="polite">
        {loading ? (
          <Spinner label="Loading messages…" />
        ) : error && messages.length === 0 ? (
          <ErrorBox message={error} onRetry={load} />
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No messages yet. Say hello 👋</p>
        ) : (
          messages.map((m, i) => {
            const mine = m.sender_id === profile.id;
            const showTime = i === 0 || new Date(m.created_at).getTime() - new Date(messages[i - 1].created_at).getTime() > 15 * 60_000;
            return (
              <div key={m.id}>
                {showTime && <p className="my-2 text-center text-[11px] font-medium text-muted">{fmtDateTime(m.created_at)}</p>}
                <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2 text-[15px] leading-snug whitespace-pre-wrap break-words",
                    mine ? "rounded-br-md bg-brand text-brand-fg" : "rounded-bl-md border border-line bg-surface text-ink",
                    m.state === "failed" && "bg-danger-bg text-danger border border-danger-line")}>
                    {m.body}
                  </div>
                </div>
                <div className={cn("mt-0.5 flex items-center gap-1 text-[11px] text-muted", mine ? "justify-end" : "justify-start")}>
                  {m.state === "sending" && <><Loader2 className="size-3 animate-spin" /> Sending…</>}
                  {m.state === "failed" && (
                    <button onClick={() => deliver(m)} className="flex min-h-8 items-center gap-1 font-semibold text-danger">
                      <AlertCircle className="size-3.5" /> Not sent · <RotateCw className="size-3" /> Retry
                    </button>
                  )}
                  {!m.state && <span>{fmtDateTime(m.created_at)}</span>}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {canSend ? (
        <form onSubmit={send} className="flex items-end gap-2 border-t border-line bg-surface p-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(min-width: 768px)").matches) send(e);
            }}
            rows={1}
            placeholder="Message"
            aria-label="Message"
            className="max-h-32 min-h-12 flex-1 resize-none rounded-2xl border border-line px-4 py-3 text-base focus:border-brand focus:outline-none"
          />
          <button type="submit" disabled={!text.trim()} className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg disabled:opacity-40" aria-label="Send">
            <Send className="size-5" />
          </button>
        </form>
      ) : (
        <p className="border-t border-line p-3 text-center text-sm text-muted">This coaching relationship is archived. History is read-only.</p>
      )}
    </div>
  );
}
