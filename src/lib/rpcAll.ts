import type { SupabaseClient } from "@supabase/supabase-js";

/** Rows per request. Must not exceed the API's max_rows (1000), or pages come back short and the loop stops early. */
const PAGE = 1000;
/** Safety stop: 100 pages = 100k rows. */
const MAX_PAGES = 100;

/**
 * Calls a set-returning RPC and fetches every row, page by page.
 * The API caps each response at 1000 rows and drops the rest without an error, so a plain
 * `.rpc()` call silently loses the newest rows once a history passes that size.
 * The function must have a stable, total ORDER BY so pages don't overlap or skip rows.
 * Returns the same `{ data, error }` shape as `.rpc()`, so it works with `must()`.
 */
export async function rpcAll<T = unknown>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    const { data, error } = await supabase.rpc(fn, args).range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return { data: rows, error: null };
}
