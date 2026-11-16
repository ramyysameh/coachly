"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { must, useAsync } from "@/lib/useAsync";
import { Button, Card } from "@/components/ui";
import { errMsg } from "@/lib/utils";
import { notify } from "@/lib/notify";

/** The client's current coach, with a way to end the relationship. History stays with the client. */
export default function CoachLink({ clientId }: { clientId: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data, reload } = useAsync(async () => {
    const rel = must(await supabase.from("coach_clients").select("coach_id").eq("client_id", clientId).eq("status", "active").maybeSingle()) as { coach_id: string } | null;
    if (!rel) return null;
    const coach = must(await supabase.from("profiles").select("full_name").eq("id", rel.coach_id).maybeSingle()) as { full_name: string } | null;
    return { name: coach?.full_name || "Your coach" };
  }, [clientId]);

  if (!data) return null;

  async function leave() {
    setBusy(true);
    const { error } = await supabase.rpc("leave_coach");
    setBusy(false);
    if (error) return notify.error(errMsg(error));
    setConfirming(false);
    notify.success("You've left your coach");
    reload({ silent: true });
    router.refresh();
  }

  return (
    <Card className="space-y-3">
      <div>
        <p className="text-sm font-medium">Your coach</p>
        <p className="text-sm text-muted">{data.name}</p>
      </div>
      {confirming ? (
        <div className="space-y-2">
          <p className="text-sm text-muted">
            {data.name} won&apos;t see anything you log after today, and can&apos;t change your plan. They keep what you logged
            while working together. To reconnect later, accept a new invite from them.
          </p>
          <div className="flex gap-2">
            <Button variant="danger" onClick={leave} loading={busy}>Leave coach</Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setConfirming(true)}>Leave coach</Button>
      )}
    </Card>
  );
}
