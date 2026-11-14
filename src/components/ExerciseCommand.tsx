"use client";
import { Command } from "cmdk";
import { Info, Search } from "lucide-react";
import type { Exercise } from "@/lib/data";
import { wordFilter } from "@/lib/commandFilter";
import { muscleLabel } from "@/lib/muscles";
import { ExerciseThumb, variantLabel } from "@/components/ExerciseLibrary";
import { Badge } from "@/components/ui";
import { CommandGroup } from "@/components/CommandGroup";

/**
 * Searchable exercise list for the plan picker. cmdk does the fuzzy filtering and keyboard
 * navigation (type, ↓/↑, Enter adds). The info button sits outside the item so it never selects.
 */
export function ExerciseCommand({ exercises, search, onSearchChange, onPick, onInfo }: {
  exercises: Exercise[];
  /** Controlled, so the browser can prefill "Create custom exercise" with what was typed. */
  search: string;
  onSearchChange: (search: string) => void;
  onPick: (e: Exercise) => void;
  onInfo: (e: Exercise) => void;
}) {
  const groups = new Map<string, Exercise[]>();
  exercises.forEach((e) => {
    const key = e.movements?.name ?? "Other";
    groups.set(key, [...(groups.get(key) ?? []), e]);
  });
  const ordered = [...groups.entries()].sort(([a], [b]) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)));

  return (
    // cmdk names the input via aria-labelledby → its hidden <label>, so `label` is the input's accessible name.
    <Command loop label="Search exercises" filter={wordFilter} className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Command.Input
          value={search}
          onValueChange={onSearchChange}
          placeholder="Search exercises"
          className="min-h-12 w-full rounded-xl border border-line bg-surface pr-3 pl-9 text-base outline-none focus:border-brand"
        />
      </div>
      <Command.List>
        <Command.Empty className="p-6 text-center text-sm text-muted">No exercises match</Command.Empty>
        {ordered.map(([movement, items]) => (
          <CommandGroup key={movement} heading={movement}>
            {items.map((e) => (
              <div key={e.id} className="flex items-center gap-1">
                <Command.Item
                  value={e.id}
                  keywords={[e.name, e.movements?.name, e.equipment, ...e.primary_muscles.map(muscleLabel)].filter((k): k is string => !!k)}
                  onSelect={() => onPick(e)}
                  className="flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left data-[selected=true]:bg-surface-2"
                >
                  <ExerciseThumb ex={e} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-medium">
                      <span className="truncate">{e.name}</span>
                      {e.created_by && <Badge tone="brand">Custom</Badge>}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {e.primary_muscles.map(muscleLabel).join(", ") || "No muscles tagged"}
                      {variantLabel(e) && ` · ${variantLabel(e)}`}
                    </span>
                  </span>
                </Command.Item>
                <button
                  type="button"
                  onClick={(ev) => { ev.stopPropagation(); onInfo(e); }}
                  aria-label={`About ${e.name}`}
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2"
                >
                  <Info className="size-4" />
                </button>
              </div>
            ))}
          </CommandGroup>
        ))}
      </Command.List>
    </Command>
  );
}
