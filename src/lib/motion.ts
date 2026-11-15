// Small gesture-motion helpers (Apple's "Designing Fluid Interfaces", translated to the web).
// No animation library: one critically damped spring that starts from the live value and velocity,
// so a grab, a reversal or a new target never jumps.

/** Where a flick would come to rest, using the scroll-deceleration curve. Velocity in px/s. */
export function project(velocity: number, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Progressive resistance past a boundary: the further past it, the less the element follows. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  const sign = Math.sign(overshoot);
  const o = Math.abs(overshoot);
  return (sign * (o * dimension * constant)) / (dimension + constant * o);
}

/** Release velocity (px/s) from recent pointer samples. Ignores samples older than 100ms. */
export function releaseVelocity(samples: { t: number; y: number }[]) {
  const last = samples.at(-1);
  if (!last) return 0;
  const first = samples.find((s) => last.t - s.t <= 100) ?? last;
  const dt = last.t - first.t;
  return dt > 0 ? ((last.y - first.y) / dt) * 1000 : 0;
}

export type SpringState = { value: number; velocity: number };

/**
 * Critically damped spring (damping ratio 1, no overshoot) toward `target`, starting from the
 * state's current value and velocity. `response` is Apple's response in seconds. Mutates `state`
 * every frame and calls `onFrame`. Returns a cancel function; cancelling leaves `state` live, so the
 * next spring (or a drag) picks up exactly where this one stopped.
 */
export function springTo(
  state: SpringState,
  target: number,
  onFrame: (value: number) => void,
  { response = 0.3, onDone }: { response?: number; onDone?: () => void } = {},
) {
  const w = (2 * Math.PI) / response;
  const c1 = state.value - target;
  const c2 = state.velocity + w * c1;
  const start = performance.now();
  let raf = 0;
  const step = (now: number) => {
    const t = (now - start) / 1000;
    const decay = Math.exp(-w * t);
    state.value = target + (c1 + c2 * t) * decay;
    state.velocity = (c2 - w * (c1 + c2 * t)) * decay;
    if (Math.abs(state.value - target) < 0.5 && Math.abs(state.velocity) < 20) {
      state.value = target;
      state.velocity = 0;
      onFrame(target);
      onDone?.();
      return;
    }
    onFrame(state.value);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
