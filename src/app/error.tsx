"use client";
import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui";

/** Catches unexpected errors in any page so users get a way back instead of a blank screen. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const offline = typeof navigator !== "undefined" && !navigator.onLine;

  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-md flex-col justify-center px-5 py-10" role="alert">
      <div className="rounded-2xl border border-line bg-surface p-5">
        <AlertTriangle className="size-9 text-warn" aria-hidden />
        <h1 className="mt-3 text-xl font-semibold">{offline ? "You're offline" : "Something went wrong"}</h1>
        <p className="mt-1 text-sm text-muted">
          {offline
            ? "This page needs a connection. Anything you already logged is saved on this phone and will sync when you're back online."
            : "This page hit an unexpected error. Your data is safe. Try again, or go back to the start."}
        </p>
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" onClick={() => retry()}>
            <RotateCw className="size-4" /> Try again
          </Button>
          <Link href="/" className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl border border-line font-semibold">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
