"use client";
import type { SupabaseClient } from "@supabase/supabase-js";

// Browser side of push notifications: subscribe this device, unsubscribe it, and ask the server
// to notify the other person after something happens. The server route is /api/notify.

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export type PushState = "unavailable" | "needs-install" | "denied" | "on" | "off";

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

/** Where this device stands. iPhones only allow web push once the app is on the home screen. */
export async function pushState(): Promise<PushState> {
  if (typeof window === "undefined" || !VAPID_PUBLIC_KEY || !("serviceWorker" in navigator)) return "unavailable";
  if (!("PushManager" in window) || !("Notification" in window)) return isIOS() && !isStandalone() ? "needs-install" : "unavailable";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Asks for permission (must run from a tap) and saves this device's subscription. */
export async function enablePush(supabase: SupabaseClient, userId: string): Promise<PushState> {
  if (!VAPID_PUBLIC_KEY) return "unavailable";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("This browser returned an incomplete subscription.");
  // A device used by someone else before (shared phone) may still be registered to them: clear that first.
  await supabase.rpc("forget_push_endpoints", { p_endpoints: [json.endpoint] });
  const { error } = await supabase.from("push_subscriptions").insert({ user_id: userId, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
  if (error) throw error;
  return "on";
}

/** Stops notifications on this device (also run on sign-out, so a shared phone stops getting them). */
export async function disablePush(supabase: SupabaseClient): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager?.getSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}

/** Fire-and-forget: tell the server something happened. It works out who (if anyone) to notify. */
export function notifyOthers(kind: "message" | "workout", ref: string) {
  if (!VAPID_PUBLIC_KEY) return;
  void fetch("/api/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, ref }),
    keepalive: true, // survives the navigation that follows "Finish workout"
  }).catch(() => { /* a missed notification isn't worth an error message */ });
}
