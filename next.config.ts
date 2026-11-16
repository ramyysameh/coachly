import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Playwright tests build into their own folder (pointed at the local Supabase), so they
  // never overwrite or reuse the normal .next build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Pages here are per-user and read auth cookies, so classic dynamic rendering fits better
  // than Cache Components' static shells.
  cacheComponents: false,
  async headers() {
    return [
      {
        // Every response. The CSP holds only frame-ancestors, so it doesn't limit what pages or the
        // service worker can fetch; it stops other sites framing the app (clickjacking).
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // Always fetch the newest service worker so fixes reach installed apps.
        // (No CSP here: a worker's CSP also governs its fetches, which would block Supabase.)
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
