import type { SupabaseClient } from "@supabase/supabase-js";
import type { Unit } from "@/lib/utils";

export type ClientName = { id: string; full_name: string; avatar_url: string | null; weight_unit: Unit };

/**
 * Name, photo and weight unit of the signed-in coach's clients, including former ones.
 * A former coach can't read the client's profile row any more, so screens that can show
 * archived clients look names up here. Ids that aren't the coach's clients are left out.
 */
export async function clientNames(supabase: SupabaseClient, ids: (string | null | undefined)[]): Promise<Map<string, ClientName>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (!wanted.length) return new Map();
  const { data, error } = await supabase.rpc("client_names", { p_ids: wanted });
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as ClientName[]).map((r) => [r.id, r]));
}
