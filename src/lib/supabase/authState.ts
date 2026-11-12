import { isAuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";

export type AuthState =
  | { kind: "signed-in"; uid: string }
  | { kind: "signed-out" }
  /** We couldn't reach the auth server — the user may well still be signed in. */
  | { kind: "unavailable" };

/** True when an error means "couldn't reach the server", not "not allowed". */
export function isUnreachable(error: unknown): boolean {
  if (!error) return false;
  if (isAuthRetryableFetchError(error)) return true;
  const e = error as { status?: number; code?: string; message?: string; name?: string };
  if (typeof e.status === "number" && (e.status === 0 || e.status >= 500)) return true;
  // PostgREST / fetch-level failures carry no Postgres error code
  return !e.code && /fetch|network|ECONNREFUSED|ETIMEDOUT|socket|Load failed|timed? ?out|abort/i.test(`${e.name ?? ""} ${e.message ?? ""}`);
}

export async function getAuthState(supabase: SupabaseClient): Promise<AuthState> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    const uid = data?.claims?.sub;
    if (uid) return { kind: "signed-in", uid };
    if (error && isUnreachable(error)) return { kind: "unavailable" };
    return { kind: "signed-out" };
  } catch (e) {
    return isUnreachable(e) ? { kind: "unavailable" } : { kind: "signed-out" };
  }
}
