"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { CheckCircle2, Flame, Medal, Trophy } from "lucide-react";
import { Medal3D } from "@/components/Depth";

export type AchievementKind = "pr" | "workout" | "streak";
export type Achievement = {
  kind: AchievementKind;
  /** the big line, e.g. "New PR!" */
  title: string;
  /** the exercise or session name */
  subtitle?: string;
  /** detail lines, e.g. "Heaviest weight · 100 kg × 5" */
  lines?: string[];
};

// A tiny module store so any screen can call celebrate() without prop drilling or context.
type Listener = (a: Achievement) => void;
const listeners = new Set<Listener>();

/** Show the 3D achievement pop-up. Several in a row queue up and play one after another. */
export function celebrate(a: Achievement) {
  listeners.forEach((l) => l(a));
}

const SHOW_MS = 3600;
const LEAVE_MS = 220;
const CONFETTI = ["#e11d2a", "#ff535b", "#ffd25c", "#f3f3f4", "#c98d12"];

/** Random paths for the confetti burst, made once per achievement (outside render). */
function confetti(): CSSProperties[] {
  return Array.from({ length: 28 }, (_, i) => {
    const angle = (i / 28) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 110 + Math.random() * 120;
    return {
      "--dx": `${Math.cos(angle) * dist}px`,
      "--dy": `${Math.sin(angle) * dist - 40}px`,
      "--rot": `${(Math.random() - 0.5) * 900}deg`,
      "--delay": `${150 + Math.random() * 200}ms`,
      background: CONFETTI[i % CONFETTI.length],
    } as CSSProperties;
  });
}

const ICON: Record<AchievementKind, React.ReactNode> = {
  pr: <Trophy className="size-[1em]" strokeWidth={2.4} />,
  workout: <CheckCircle2 className="size-[1em]" strokeWidth={2.4} />,
  streak: <Flame className="size-[1em]" strokeWidth={2.4} />,
};

/** Mounted once in the root layout. Renders nothing until celebrate() is called. */
export default function AchievementHost() {
  const [queue, setQueue] = useState<(Achievement & { id: number; pieces: CSSProperties[] })[]>([]);
  const [leaving, setLeaving] = useState(false);
  const nextId = useRef(0);
  const current = queue[0];

  useEffect(() => {
    const l: Listener = (a) => {
      const item = { ...a, id: nextId.current++, pieces: confetti() };
      setQueue((q) => [...q, item]);
    };
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  const dismiss = useCallback(() => {
    setLeaving(true);
    window.setTimeout(() => {
      setLeaving(false);
      setQueue((q) => q.slice(1));
    }, LEAVE_MS);
  }, []);

  // Auto-dismiss each achievement; Escape closes it early.
  useEffect(() => {
    if (!current) return;
    const t = window.setTimeout(dismiss, SHOW_MS);
    const key = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    window.addEventListener("keydown", key);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", key);
    };
  }, [current, dismiss]);

  const pieces = current?.pieces ?? [];

  if (!current) return null;
  return (
    <div
      key={current.id}
      className="ach-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
      data-leaving={leaving || undefined}
      onClick={dismiss}
      role="alertdialog"
      aria-live="assertive"
      aria-label={`${current.title}${current.subtitle ? `: ${current.subtitle}` : ""}`}
    >
      <div className="ach-card relative w-full max-w-xs overflow-hidden rounded-3xl border border-brand/30 bg-surface px-6 pt-8 pb-6 text-center shadow-float">
        <div aria-hidden className="ach-rays pointer-events-none absolute top-[-30%] left-1/2 size-[420px] -translate-x-1/2" />
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {pieces.map((style, i) => <span key={i} className="ach-confetti" style={style} />)}
        </div>
        <div className="ach-medal relative mx-auto mb-4 flex justify-center">
          <Medal3D size={124}>{ICON[current.kind]}</Medal3D>
        </div>
        <p className="relative flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-brand-dark">
          <Medal className="size-3.5" aria-hidden /> Achievement
        </p>
        <h2 className="relative mt-1 font-display text-4xl font-bold italic tracking-tight">{current.title}</h2>
        {current.subtitle && <p className="relative mt-1 text-base font-semibold">{current.subtitle}</p>}
        {current.lines?.length ? (
          <ul className="relative mt-3 space-y-1 text-sm text-muted">
            {current.lines.map((l) => <li key={l} className="font-mono tabular-nums">{l}</li>)}
          </ul>
        ) : null}
        <p className="relative mt-4 text-xs text-muted">Tap to continue{queue.length > 1 ? ` · ${queue.length - 1} more` : ""}</p>
        <span aria-hidden className="ach-progress absolute inset-x-0 bottom-0 h-1 bg-brand" style={{ "--ach-ms": `${SHOW_MS}ms` } as CSSProperties} />
      </div>
    </div>
  );
}
