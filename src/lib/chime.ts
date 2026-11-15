// A short two-note chime for the end of a rest. iPhones ignore navigator.vibrate, so this is
// the only cue they get. iOS only lets audio start from a user gesture, so primeChime() must run
// synchronously inside a tap (the ✓ on a set) before playChime() can make a sound later on.

let ctx: AudioContext | null = null;

export function primeChime() {
  if (typeof window === "undefined") return;
  try {
    ctx ??= new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null;
  }
}

export function playChime() {
  if (!ctx || ctx.state !== "running") return;
  const start = ctx.currentTime;
  for (const [i, freq] of [880, 1320].entries()) {
    const t = start + i * 0.16;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.32);
  }
}
