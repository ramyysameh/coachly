"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, Loader2 } from "lucide-react";
import { Button, CenteredPage, StatusIcon } from "@/components/ui";

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
    <CenteredPage role="alert">
        <StatusIcon><CloudOff /></StatusIcon>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Can&apos;t reach the server</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          You&apos;re still signed in and nothing you logged is lost. We&apos;ll reconnect automatically.
        </p>
        <Button
          className="mt-5 w-full"
          onClick={() => {
            setRetrying(true);
            router.refresh();
            setTimeout(() => setRetrying(false), 1500);
          }}
          disabled={retrying}
        >
          {retrying ? <><Loader2 className="size-4 animate-spin" /> Reconnecting…</> : `Try again (${seconds}s)`}
        </Button>
    </CenteredPage>
  );
}
