"use client";
import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/push";
import { notify } from "@/lib/notify";
import { Button, Card } from "@/components/ui";
import { errMsg } from "@/lib/utils";

const COPY: Record<"client" | "coach", string> = {
  client: "Get a notification when your coach messages you.",
  coach: "Get a notification when a client messages you or finishes a workout.",
};

/** Turn notifications on or off for this device. Renders nothing where push isn't possible at all. */
export default function PushToggle({ userId, role }: { userId: string; role: "client" | "coach" }) {
  const supabase = createClient();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    pushState().then((s) => live && setState(s)).catch(() => live && setState("unavailable"));
    return () => { live = false; };
  }, []);

  if (state === null || state === "unavailable") return null;

  async function toggle() {
    setBusy(true);
    try {
      if (state === "on") {
        await disablePush(supabase);
        setState("off");
      } else {
        const next = await enablePush(supabase, userId);
        setState(next);
        if (next === "on") notify.success("Notifications are on for this device");
      }
    } catch (e) {
      notify.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex items-start gap-3">
      <span className="mt-0.5 text-brand" aria-hidden>{state === "on" ? <Bell className="size-5" /> : <BellOff className="size-5" />}</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Notifications</p>
        <p className="text-sm text-muted">
          {state === "needs-install"
            ? "On iPhone, add Coachly to your Home Screen first (Share → Add to Home Screen), then turn notifications on from there."
            : state === "denied"
              ? "Notifications are blocked for this site. Allow them in your browser settings, then come back here."
              : COPY[role]}
        </p>
      </div>
      {(state === "on" || state === "off") && (
        <Button size="sm" variant={state === "on" ? "secondary" : "primary"} onClick={toggle} loading={busy} aria-pressed={state === "on"}>
          {state === "on" ? "Turn off" : "Turn on"}
        </Button>
      )}
    </Card>
  );
}
