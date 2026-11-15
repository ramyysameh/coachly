// "Dim to focus": while a sheet is open, the screen behind it recedes slightly, the way iOS pushes the
// presenting screen back. vaul's own shouldScaleBackground transforms one page wrapper, which would turn
// it into the containing block for the fixed tab bar and pin that to the bottom of the document. So each
// layer marked [data-recede] (header, tab bar, sidebar, main, floating timers) is scaled on its own,
// around the viewport centre, so together they move as one surface.
//
// It uses the independent `scale` property, so it composes with any `transform` an element animates
// itself (the rest timer's swipe spring). Skipped under reduced motion: the overlay's dim alone remains.

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)"; // vaul's drawer curve, so both move together
const MS = 500;
let openCount = 0;
let clearTimer: ReturnType<typeof setTimeout> | undefined;

const layers = () => Array.from(document.querySelectorAll<HTMLElement>("[data-recede]"));

function apply() {
  clearTimeout(clearTimer);
  // About 28px narrower on a phone; barely perceptible on a wide desktop window.
  const s = Math.max(0.92, 1 - 28 / window.innerWidth);
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  for (const el of layers()) {
    const r = el.getBoundingClientRect();
    el.style.transformOrigin = `${cx - r.left}px ${cy - r.top}px`;
    el.style.transition = `scale ${MS}ms ${EASE}`;
    el.style.scale = String(s);
  }
}

function release() {
  for (const el of layers()) el.style.scale = "1";
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    if (openCount) return;
    for (const el of layers()) {
      el.style.removeProperty("scale");
      el.style.removeProperty("transform-origin");
      el.style.removeProperty("transition");
    }
  }, MS);
}

/** Call with true when a top-level sheet opens and false when it closes. Reference counted. */
export function recede(open: boolean) {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const was = openCount;
  openCount = Math.max(0, openCount + (open ? 1 : -1));
  if (!was && openCount) apply();
  else if (was && !openCount) release();
}
