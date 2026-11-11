import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pages here are per-user and read auth cookies, so classic dynamic rendering fits better
  // than Cache Components' static shells.
  cacheComponents: false,
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
