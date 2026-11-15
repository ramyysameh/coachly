"use client";
import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A 3D bumper plate drawn in CSS: a front and back face with a stack of rim discs between them,
 * so it has real thickness when it turns. Decorative only.
 */
export function Plate({ size = 160, depth = 14, spin = false, label = "20", pose, className }: {
  size?: number; depth?: number; spin?: boolean; label?: string; className?: string;
  /** a resting CSS transform for a plate that doesn't spin */
  pose?: string;
}) {
  const layers = Math.max(4, Math.round(depth / 1.5));
  const step = depth / layers;
  return (
    <div aria-hidden className={cn("plate-stage", className)} style={{ width: size, height: size }}>
      <div className={cn("plate size-full", spin && "plate-spin")} style={!spin && pose ? { transform: pose } : undefined}>
        <span className="plate-face back" style={{ transform: `translateZ(${-depth / 2}px) rotateY(180deg)` }} />
        {Array.from({ length: layers - 1 }, (_, i) => (
          <span key={i} className="plate-rim" style={{ transform: `translateZ(${-depth / 2 + step * (i + 1)}px)` }} />
        ))}
        <span className="plate-face" style={{ transform: `translateZ(${depth / 2}px)` }}>
          <span className="plate-label">
            <span
              className="font-display font-bold italic text-white/90"
              style={{ fontSize: size * 0.13, transform: `translateY(${size * 0.3}px)`, letterSpacing: "0.04em", textShadow: "0 1px 0 rgb(0 0 0 / 0.5)" }}
            >
              {label} KG
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * Leans its content toward a mouse or pen pointer, with a glare that follows. Touch is ignored so
 * it never fights scrolling on a phone; reduced motion turns the lean off in CSS.
 */
export function Tilt({ children, className, max = 6 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  function move(e: PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el || e.pointerType === "touch") return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.dataset.tilting = "";
    el.style.setProperty("--ry", `${(x - 0.5) * max * 2}deg`);
    el.style.setProperty("--rx", `${(0.5 - y) * max}deg`);
    el.style.setProperty("--gx", `${x * 100}%`);
    el.style.setProperty("--gy", `${y * 100}%`);
  }
  function leave() {
    const el = ref.current;
    if (!el) return;
    delete el.dataset.tilting;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  }
  return (
    <div ref={ref} onPointerMove={move} onPointerLeave={leave} className={cn("tilt relative", className)} style={{ "--gy": "0%" } as CSSProperties}>
      {children}
      <div aria-hidden className="tilt-glare pointer-events-none absolute inset-0 rounded-[inherit]" />
    </div>
  );
}
