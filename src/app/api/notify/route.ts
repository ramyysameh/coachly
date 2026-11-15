import webPush from "web-push";
import { createClient } from "@/lib/supabase/server";

/**
 * POST { kind: "message" | "workout", ref: uuid } after the caller sends a message or finishes a
 * workout. push_targets() (security definer) checks the caller really did that, and returns the other
 * person's devices plus the text to show, at most once per event. Push is off (204) until the VAPID
 * keys are configured.
 */
type Target = { endpoint: string; p256dh: string; auth_key: string; title: string; body: string | null; url: string | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return new Response(null, { status: 204 });

  let input: { kind?: unknown; ref?: unknown };
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  if ((input.kind !== "message" && input.kind !== "workout") || typeof input.ref !== "string" || !UUID.test(input.ref)) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { data, error } = await supabase.rpc("push_targets", { p_kind: input.kind, p_ref: input.ref });
  if (error) return Response.json({ error: "Couldn't look up recipients" }, { status: 500 });
  const targets = (data ?? []) as Target[];
  if (!targets.length) return Response.json({ sent: 0 });

  webPush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:notifications@coachly.invalid", pub, priv);
  const gone: string[] = [];
  const results = await Promise.allSettled(
    targets.map((t) =>
      webPush
        .sendNotification(
          { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth_key } },
          JSON.stringify({ title: t.title, body: t.body ?? "", url: t.url ?? "/", tag: `${input.kind}:${input.ref}` }),
          { TTL: 60 * 60 * 12, timeout: 5000 },
        )
        .catch((e: { statusCode?: number }) => {
          // 404/410: the browser unsubscribed or the subscription expired, so stop sending to it.
          if (e.statusCode === 404 || e.statusCode === 410) gone.push(t.endpoint);
          throw e;
        }),
    ),
  );
  if (gone.length) await supabase.rpc("forget_push_endpoints", { p_endpoints: gone });
  return Response.json({ sent: results.filter((r) => r.status === "fulfilled").length });
}
