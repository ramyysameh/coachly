"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { prefersReducedMotion, project, releaseVelocity, rubberband, springTo, type SpringState } from "@/lib/motion";

/**
 * Full-swipe-left to delete, as in iOS lists. The row follows the finger 1:1 after ~10px of horizontal
 * movement (a vertical start is left to page scrolling), resists a rightward pull, and on release
 * projects the flick: past half the row's width it deletes, otherwise it springs back, carrying the
 * finger's velocity either way. A tick marks the moment the delete threshold is crossed.
 *
 * Drags that start on an input, button or select are ignored, so typing and tapping work as before;
 * the swipe starts from the row's non-interactive parts (set label, previous values).
 * Deletion is meant to be undoable (the caller shows an undo toast), so there is no confirm step.
 */
export function SwipeToDelete({ enabled, onDelete, children }: {
  enabled: boolean;
  /** Resolves true when deleted; false (or a throw) springs the row back. */
  onDelete: () => Promise<boolean>;
  children: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const fg = useRef<HTMLDivElement>(null);
  const motion = useRef<SpringState>({ value: 0, velocity: 0 });
  const cancel = useRef<(() => void) | null>(null);
  const armed = useRef(false);
  const drag = useRef<{ id: number; x0: number; y0: number; from: number; active: boolean; samples: { t: number; y: number }[] } | null>(null);
  useEffect(() => () => cancel.current?.(), []);

  const width = () => row.current?.offsetWidth ?? 320;
  const paint = (x: number) => {
    if (fg.current) fg.current.style.transform = x ? `translate3d(${x}px, 0, 0)` : "";
    if (row.current) row.current.style.setProperty("--reveal", String(Math.min(1, -x / 72)));
  };
  const animate = (target: number, onDone?: () => void) => {
    cancel.current?.();
    if (prefersReducedMotion()) {
      motion.current = { value: target, velocity: 0 };
      paint(target);
      onDone?.();
      return;
    }
    cancel.current = springTo(motion.current, target, paint, { response: 0.3, onDone });
  };
  const setArmed = (on: boolean) => {
    if (on === armed.current) return;
    armed.current = on;
    if (on) navigator.vibrate?.(10);
    row.current?.toggleAttribute("data-armed", on);
  };

  async function commit() {
    animate(-width() - 16);
    let ok = false;
    try {
      ok = await onDelete();
    } catch {
      ok = false;
    }
    if (!ok) {
      setArmed(false);
      animate(0);
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!enabled || (e.target as Element).closest("input, button, select, textarea, a")) return;
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, from: motion.current.value, active: false, samples: [{ t: e.timeStamp, y: e.clientX }] };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    if (!d.active) {
      if (Math.abs(e.clientY - d.y0) > 10 && Math.abs(e.clientY - d.y0) > Math.abs(dx)) return void (drag.current = null);
      if (Math.abs(dx) < 10) return;
      d.active = true;
      fg.current?.setPointerCapture(e.pointerId);
      cancel.current?.();
      d.x0 = e.clientX;
      d.from = motion.current.value;
    }
    d.samples.push({ t: e.timeStamp, y: e.clientX });
    if (d.samples.length > 8) d.samples.shift();
    const raw = d.from + (e.clientX - d.x0);
    const x = raw <= 0 ? raw : rubberband(raw, width());
    motion.current = { value: x, velocity: 0 };
    paint(x);
    setArmed(x < -width() * 0.5);
  }
  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d?.active || d.id !== e.pointerId) return;
    const v = e.type === "pointercancel" ? 0 : releaseVelocity(d.samples);
    motion.current.velocity = v;
    if (motion.current.value + project(v) < -width() * 0.5) void commit();
    else {
      setArmed(false);
      animate(0);
    }
  }

  return (
    <div ref={row} className="group/swipe relative overflow-hidden rounded-xl">
      {/* Revealed behind the row as it slides left; brightens once a release would delete. */}
      <div
        aria-hidden
        className="absolute inset-0 flex items-center justify-end gap-1.5 rounded-xl bg-danger-bg pr-4 text-sm font-semibold text-danger opacity-[var(--reveal,0)] transition-colors duration-150 group-data-[armed]/swipe:bg-danger group-data-[armed]/swipe:text-surface"
      >
        <Trash2 className="size-4" /> Delete
      </div>
      <div
        ref={fg}
        className={cn("relative bg-surface", enabled && "touch-pan-y")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {children}
      </div>
    </div>
  );
}
