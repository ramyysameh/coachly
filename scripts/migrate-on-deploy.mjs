// Applies pending Supabase migrations before a production build, so new code never
// goes live ahead of the database it needs. Runs as the first step of `npm run build`.
//
// - Vercel production builds: runs `supabase db push` against SUPABASE_DB_URL.
//   If a migration fails, the build fails and the current deployment stays live.
// - Preview builds and local builds: does nothing.
//
// SUPABASE_DB_URL must be set in Vercel → Settings → Environment Variables, for the
// Production environment only. Use the Session pooler connection string from
// Supabase → Connect (port 5432, IPv4-compatible); Vercel builds can't reach the
// IPv6-only direct connection.
import { spawnSync } from "node:child_process";

const env = process.env.VERCEL_ENV;
if (env !== "production") {
  console.log(`[migrate] Skipping database migrations (${env ? `Vercel ${env} build` : "not a Vercel build"}).`);
  process.exit(0);
}

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error(
    "[migrate] SUPABASE_DB_URL is not set, so migrations can't be applied.\n" +
      "[migrate] Add it in Vercel → Settings → Environment Variables (Production only),\n" +
      "[migrate] using the Session pooler connection string from Supabase → Connect.\n" +
      "[migrate] Stopping the build so new code doesn't go live without its migrations.",
  );
  process.exit(1);
}

console.log("[migrate] Applying pending migrations to the production database…");
const res = spawnSync("npx", ["supabase", "db", "push", `--remote=${url}`, "--yes"], {
  stdio: ["ignore", "pipe", "pipe"],
  encoding: "utf8",
  shell: process.platform === "win32",
});
// Never echo the connection string (it contains the database password).
const scrub = (s) => (s ?? "").split(url).join("<SUPABASE_DB_URL>").replace(/postgres(ql)?:\/\/[^\s"']+/g, "<db-url>");
process.stdout.write(scrub(res.stdout));
process.stderr.write(scrub(res.stderr));
if (res.status !== 0) {
  console.error("[migrate] Migration failed. The build stops here and the live deployment is unchanged.");
  process.exit(res.status ?? 1);
}
console.log("[migrate] Database is up to date.");
