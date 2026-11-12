"use client";

/** Registers the service worker (production builds only — it would cache stale dev bundles). */
export function registerServiceWorker() {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => console.warn("Service worker registration failed", e));
}

/** Removes this user's cached pages and data from the device (call on sign-out). */
export async function clearOfflineData() {
  navigator.serviceWorker?.controller?.postMessage({ type: "clear-data" });
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("coachly-pages") || k.startsWith("coachly-data")).map((k) => caches.delete(k)));
  }
  try {
    localStorage.removeItem("coachly:pending-sets");
    localStorage.removeItem("coachly:pending-meals");
  } catch {
    /* ignore */
  }
}
