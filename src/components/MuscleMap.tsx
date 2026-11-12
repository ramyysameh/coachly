"use client";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { muscleLabel, type Muscle } from "@/lib/muscles";

/**
 * Front/back body outline with each muscle region filled by a tone.
 * Exercise cards use primary/secondary; the heat map (phase 3) will use low/mid/high.
 */
export type Tone = "primary" | "secondary" | "low" | "mid" | "high";
type Props = { tones: Partial<Record<Muscle, Tone>>; size?: "xs" | "sm" | "md"; view?: "front" | "back" | "both"; className?: string; onSelect?: (m: Muscle) => void };
const HEIGHT = { xs: "h-11", sm: "h-24", md: "h-56" };

const TONE_CLASS: Record<Tone, string> = {
  primary: "fill-brand",
  secondary: "fill-brand/40",
  low: "fill-brand/30",
  mid: "fill-brand",
  high: "fill-danger",
};

// Left half of each view; every shape is mirrored to the right side.
const FRONT: [Muscle, ReactElement][] = [
  ["traps", <path key="t" d="M45 29 L37 34.5 L45 36 Z" />],
  ["front_delts", <ellipse key="fd" cx="32" cy="40" rx="5.5" ry="6" />],
  ["side_delts", <ellipse key="sd" cx="26" cy="43" rx="3.2" ry="6" />],
  ["chest", <path key="c" d="M49 38 C41 37 35 40 35 46 C35 53 42 56.5 49 55 Z" />],
  ["biceps", <ellipse key="b" cx="26" cy="58" rx="4.2" ry="9.5" />],
  ["forearms", <ellipse key="f" cx="21.5" cy="84" rx="3.8" ry="12" />],
  ["abs", <rect key="a" x="43.5" y="58.5" width="5.8" height="36" rx="2" />],
  ["obliques", <path key="o" d="M41.5 60 L36.5 62 L37.5 91 L42 95 Z" />],
  ["quads", <ellipse key="q" cx="40" cy="136" rx="6.8" ry="22" />],
  ["adductors", <path key="ad" d="M48.5 116 L45 118 L46 146 L49.3 141 Z" />],
  ["calves", <ellipse key="ca" cx="39" cy="181" rx="3.8" ry="13" />],
];
const BACK: [Muscle, ReactElement][] = [
  ["traps", <path key="t" d="M49.6 27 L38 36 L49.6 51 Z" />],
  ["rear_delts", <ellipse key="rd" cx="32" cy="41" rx="5.5" ry="5.5" />],
  ["side_delts", <ellipse key="sd" cx="26" cy="43" rx="3.2" ry="6" />],
  ["triceps", <ellipse key="tr" cx="26" cy="58" rx="4.2" ry="9.5" />],
  ["forearms", <ellipse key="f" cx="21.5" cy="84" rx="3.8" ry="12" />],
  ["lats", <path key="l" d="M48.5 52 L36.5 46 L38 70 L47 84 Z" />],
  ["lower_back", <rect key="lb" x="44" y="85" width="5.5" height="14" rx="2" />],
  ["glutes", <ellipse key="g" cx="42" cy="112" rx="7.8" ry="9" />],
  ["hamstrings", <ellipse key="h" cx="40" cy="141" rx="6.8" ry="18" />],
  ["adductors", <path key="ad" d="M48.5 123 L45.5 125 L46.5 146 L49.3 143 Z" />],
  ["calves", <ellipse key="ca" cx="39" cy="178" rx="4.8" ry="13" />],
];

const BODY = "M50 26 L45 27 L44.5 31 C38 32 30 33 26 36 C21 39 20 46 20.5 52 L18.5 70 L16 96 L14 118 L19 120 L22.5 98 L27 74 L31 61 L33 76 L34 100 L32 115 L33 150 L35 168 L34 198 L37 204 L42 203 L42 170 L45 150 L48 121 L50 119 Z";

function View({ label, shapes, tones, onSelect }: { label: string; shapes: [Muscle, ReactElement][]; tones: Props["tones"]; onSelect?: Props["onSelect"] }) {
  return (
    <svg viewBox="0 0 100 210" role="img" aria-label={label} className="h-full w-auto">
      <title>{label}</title>
      <circle cx="50" cy="15" r="10" className="fill-surface-2 stroke-line" strokeWidth="0.8" />
      {[false, true].map((mirror) => (
        <g key={String(mirror)} transform={mirror ? "translate(100 0) scale(-1 1)" : undefined}>
          <path d={BODY} className="fill-surface-2 stroke-line" strokeWidth="0.8" strokeLinejoin="round" />
          {shapes.map(([m, el]) => {
            const tone = tones[m];
            return (
              <g
                key={m}
                className={cn(tone ? TONE_CLASS[tone] : "fill-line", onSelect && "cursor-pointer hover:opacity-80")}
                onClick={onSelect ? () => onSelect(m) : undefined}
              >
                <title>{muscleLabel(m)}</title>
                {el}
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}

export default function MuscleMap({ tones, size = "md", view = "both", className, onSelect }: Props) {
  return (
    <div className={cn("flex items-center justify-center gap-1", HEIGHT[size], className)}>
      {view !== "back" && <View label="Front" shapes={FRONT} tones={tones} onSelect={onSelect} />}
      {view !== "front" && <View label="Back" shapes={BACK} tones={tones} onSelect={onSelect} />}
    </div>
  );
}

/** Tones for one exercise: primary muscles strong, secondary lighter. */
export function exerciseTones(primary: string[], secondary: string[]): Partial<Record<Muscle, Tone>> {
  const t: Partial<Record<Muscle, Tone>> = {};
  secondary.forEach((m) => (t[m as Muscle] = "secondary"));
  primary.forEach((m) => (t[m as Muscle] = "primary"));
  return t;
}

const BACK_ONLY = new Set(["rear_delts", "triceps", "lats", "lower_back", "glutes", "hamstrings", "traps"]);
/** Which single view shows an exercise best (for small thumbnails). */
export function bestView(primary: string[]): "front" | "back" {
  const back = primary.filter((m) => BACK_ONLY.has(m)).length;
  return back > primary.length - back ? "back" : "front";
}
