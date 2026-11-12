"use client";
import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button, CenteredPage, LinkButton, StatusIcon } from "@/components/ui";

/** Catches unexpected errors in any page so users get a way back instead of a blank screen. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const offline = typeof navigator !== "undefined" && !navigator.onLine;

  return (
    <CenteredPage role="alert">
        <StatusIcon tone="warn"><AlertTriangle /></StatusIcon>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">{offline ? "You're offline" : "Something went wrong"}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          {offline
            ? "This page needs a connection. Anything you already logged is saved on this phone and will sync when you're back online."
            : "This page hit an unexpected error. Your data is safe. Try again, or go back to the start."}
        </p>
        <div className="mt-5 flex gap-2">
          <Button className="flex-1" onClick={() => retry()}>
            <RotateCw className="size-4" /> Try again
          </Button>
          <LinkButton href="/" variant="secondary" className="flex-1">
            Home
          </LinkButton>
        </div>
    </CenteredPage>
  );
}
