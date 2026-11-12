"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, Dumbbell, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";

/** Shown when the backend can't be reached. Keeps the user signed in and retries on its own. */
export default function ServiceUnavailable() {
  const router = useRouter();
  const [seconds, setSeconds] = useState(5);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const retry = () => {
      setRetrying(true);
      router.refresh();
      setTimeout(() => setRetrying(false), 1500);
    };
    const t = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          retry();
          return 10;
        }
        return s - 1;
      });
    }, 1000);
    window.addEventListener("online", retry);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", retry);
    };
  }, [router]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10" role="alert">
      <div className="mb-8 flex items-center gap-2 text-brand">
        <Dumbbell className="size-7" aria-hidden />
        <span className="text-2xl font-semibold tracking-tight text-ink">Coachly</span>
      </div>
      <div className="rounded-2xl border border-line bg-surface p-5">
        <CloudOff className="size-9 text-muted" aria-hidden />
        <h1 className="mt-3 text-xl font-semibold">Can&apos;t reach the server</h1>
        <p className="mt-1 text-sm text-muted">
          You&apos;re still signed in and nothing you logged is lost. We&apos;ll reconnect automatically.
        </p>
        <Button
          className="mt-4 w-full"
          onClick={() => {
            setRetrying(true);
            router.refresh();
            setTimeout(() => setRetrying(false), 1500);
          }}
          disabled={retrying}
        >
          {retrying ? <><Loader2 className="size-4 animate-spin" /> Reconnecting…</> : `Try again (${seconds}s)`}
        </Button>
      </div>
    </main>
  );
}
