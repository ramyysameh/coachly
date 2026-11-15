// Draws a 1080×1350 (4:5, the Instagram feed shape) summary card and shares or downloads it.
// Fixed colours, not the app theme, so the image looks the same wherever it's posted.

export type ShareCard = {
  title: string; date: string; workoutNumber: number | null; streak: number;
  stats: { label: string; value: string }[]; comparison: string | null; prs: string[];
};

const C = { bg: "#060607", panel: "#121214", line: "#2a2a2f", ink: "#f3f3f4", muted: "#9a9aa3", brand: "#ff535b" };
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

export function drawShareCard(card: ShareCard): HTMLCanvasElement {
  const W = 1080, H = 1350, P = 80;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  // soft brand glow at the top
  const g = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, 700);
  g.addColorStop(0, "rgba(45,212,191,0.22)");
  g.addColorStop(1, "rgba(45,212,191,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, 700);

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.brand;
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText("COACHLY", P, P + 30);

  ctx.fillStyle = C.muted;
  ctx.font = `500 34px ${FONT}`;
  const meta = [card.date, card.workoutNumber ? `Workout #${card.workoutNumber}` : null].filter(Boolean).join("  ·  ");
  ctx.fillText(meta, P, P + 130);
  ctx.fillStyle = C.ink;
  ctx.font = `700 96px ${FONT}`;
  ctx.fillText(fit(ctx, card.title, W - 2 * P), P, P + 240);

  // 2×2 stat tiles
  const top = P + 310, gap = 28, tw = (W - 2 * P - gap) / 2, th = 210;
  card.stats.slice(0, 4).forEach((s, i) => {
    const x = P + (i % 2) * (tw + gap), y = top + Math.floor(i / 2) * (th + gap);
    ctx.fillStyle = C.panel;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, tw, th, 28);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.muted;
    ctx.font = `600 30px ${FONT}`;
    ctx.fillText(s.label.toUpperCase(), x + 36, y + 62);
    ctx.fillStyle = C.ink;
    ctx.font = `700 76px ${FONT}`;
    ctx.fillText(fit(ctx, s.value, tw - 72), x + 36, y + 160);
  });

  let y = top + 2 * (th + gap) + 40;
  if (card.comparison) {
    ctx.fillStyle = C.ink;
    ctx.font = `500 38px ${FONT}`;
    ctx.fillText(fit(ctx, `You lifted ${card.comparison}.`, W - 2 * P), P, y + 20);
    y += 80;
  }
  if (card.prs.length) {
    ctx.fillStyle = C.brand;
    ctx.font = `700 38px ${FONT}`;
    ctx.fillText(`${card.prs.length} new personal record${card.prs.length > 1 ? "s" : ""}`, P, y + 20);
    ctx.fillStyle = C.ink;
    ctx.font = `500 34px ${FONT}`;
    card.prs.slice(0, 3).forEach((p, i) => ctx.fillText(fit(ctx, `•  ${p}`, W - 2 * P), P, y + 80 + i * 52));
  }

  if (card.streak > 1) {
    ctx.fillStyle = C.muted;
    ctx.font = `600 34px ${FONT}`;
    ctx.fillText(`${card.streak} planned workouts in a row`, P, H - P);
  }
  return cv;
}

/** Shares the card through the phone's share sheet when it supports files; otherwise downloads it. */
export async function shareCard(card: ShareCard): Promise<"shared" | "downloaded" | "cancelled"> {
  const cv = drawShareCard(card);
  const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, "image/png"));
  if (!blob) throw new Error("Couldn't create the image");
  const file = new File([blob], `${card.title.replace(/[^\w-]+/g, "-").toLowerCase() || "workout"}.png`, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: card.title });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
      // Some browsers advertise file sharing but refuse it; fall back to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: file.name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
