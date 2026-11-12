import Link from "next/link";
import { CloudOff, Dumbbell } from "lucide-react";

// Served by the service worker when a page that was never opened before is requested offline.
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 flex items-center gap-2 text-brand">
        <Dumbbell className="size-7" aria-hidden />
        <span className="text-2xl font-semibold tracking-tight text-ink">Coachly</span>
      </div>
      <div className="rounded-2xl border border-line bg-surface p-5">
        <CloudOff className="size-9 text-muted" aria-hidden />
        <h1 className="mt-3 text-xl font-semibold">You&apos;re offline</h1>
        <p className="mt-1 text-sm text-muted">
          This page hasn&apos;t been opened on this device yet, so it isn&apos;t available offline. Pages you&apos;ve visited
          before, like Today and your workout, still work, and anything you log syncs when you reconnect.
        </p>
        <Link href="/today" className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-brand font-semibold text-brand-fg">
          Open Today
        </Link>
      </div>
    </main>
  );
}
