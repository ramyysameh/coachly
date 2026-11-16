import { defineConfig } from "@playwright/test";
import { loadTestEnv } from "./tests/testEnv";

// The tests run against the local Supabase stack only (settings in .env.test.local).
// Playwright builds the app into .next-test with those settings and serves it on port 3100,
// so it never uses .env.local (which may point at production), never touches .next, and
// doesn't clash with `npm run dev` on 3000. A production build uses far less memory than
// `next dev`, which compiles each page on demand while the browsers run.
const env = loadTestEnv();
const PORT = 3100;

export default defineConfig({
  testDir: "./tests",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    // Values set here win over .env.local, which Next only uses for variables not already set.
    env: {
      NEXT_DIST_DIR: ".next-test",
      NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      NEXT_PUBLIC_SHOW_DEMO_LOGINS: "true",
    },
    reuseExistingServer: false,
    timeout: 600_000, // includes the build
  },
});
