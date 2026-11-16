import { readFileSync } from "node:fs";

/**
 * Supabase settings for the tests, read from .env.test.local (the local Supabase stack).
 * The tests create, change and delete data and sign in as the seeded demo accounts, so they
 * refuse to run against anything that isn't on this machine.
 */
export const TEST_ENV_FILE = ".env.test.local";

export function loadTestEnv(): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(TEST_ENV_FILE, "utf8");
  } catch {
    throw new Error(`Missing ${TEST_ENV_FILE}. Start the local stack (npx supabase start) and copy its URL and anon key there; see README → Tests.`);
  }
  const env = Object.fromEntries(
    text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  assertLocal(env.NEXT_PUBLIC_SUPABASE_URL);
  return env;
}

export function assertLocal(url: string | undefined) {
  const host = url ? new URL(url).hostname : "";
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) {
    throw new Error(`Tests only run against a local Supabase; ${TEST_ENV_FILE} points at "${url ?? "(unset)"}".`);
  }
}
