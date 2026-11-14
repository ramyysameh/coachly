"use client";
import type { ReactNode } from "react";
import { Command } from "cmdk";

/** A cmdk group with the app's small uppercase heading. Shared by the exercise picker and coach search. */
export function CommandGroup({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted [&_[cmdk-group-heading]]:uppercase"
    >
      {children}
    </Command.Group>
  );
}
