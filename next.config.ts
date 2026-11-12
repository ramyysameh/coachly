import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pages here are per-user and read auth cookies, so classic dynamic rendering fits better
  // than Cache Components' static shells.
  cacheComponents: false,
  async headers() {
    return [
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
