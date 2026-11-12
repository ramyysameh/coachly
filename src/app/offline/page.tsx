import { CloudOff } from "lucide-react";
import { CenteredPage, LinkButton, StatusIcon } from "@/components/ui";

// Served by the service worker when a page that was never opened before is requested offline.
export default function OfflinePage() {
  return (
    <CenteredPage>
      <StatusIcon><CloudOff /></StatusIcon>
      <h1 className="mt-4 text-xl font-semibold tracking-tight">You&apos;re offline</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        This page hasn&apos;t been opened on this device yet, so it isn&apos;t available offline. Pages you&apos;ve visited
        before, like Today and your workout, still work, and anything you log syncs when you reconnect.
      </p>
      <LinkButton href="/today" className="mt-5 w-full">Open Today</LinkButton>
    </CenteredPage>
  );
}
