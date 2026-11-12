import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { getAuthState, isUnreachable } from "./authState";

/** Server Supabase client for Server Components and Route Handlers. Create one per request. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Fail fast if the backend hangs, so pages show "reconnecting" instead of spinning forever.
      global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(4000) }) },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component — the proxy refreshes sessions instead.
          }
        },
      },
    },
  );
}

export type Profile = {
  id: string;
  role: "coach" | "client";
  full_name: string;
  goal: string | null;
  weight_unit: "kg" | "lb";
  onboarded: boolean;
  avatar_url: string | null;
  date_of_birth: string | null;
  height_cm: number | null;
  height_unit: "cm" | "ft";
  goal_type: GoalType | null;
  experience_level: Level | null;
  injuries: string | null;
  training_days_per_week: number | null;
  created_at: string;
};
export type GoalType = "fat_loss" | "muscle_gain" | "strength" | "general";
export type Level = "beginner" | "intermediate" | "advanced";

export type ProfileResult =
  | { status: "ok"; profile: Profile }
  | { status: "signed-out" }
  /** Auth server or database unreachable — don't treat this as a sign-out. */
  | { status: "unavailable" };

/** Current user's profile, distinguishing "signed out" from "backend unreachable". */
export async function loadProfile(): Promise<ProfileResult> {
  // The proxy already found the backend unreachable for this request: don't wait on it again.
  // (A client faking this header only gets the "reconnecting" screen itself.)
  if ((await headers()).get("x-coachly-auth") === "unavailable") return { status: "unavailable" };
  const supabase = await createClient();
  const auth = await getAuthState(supabase);
  if (auth.kind !== "signed-in") return { status: auth.kind };
  const { data, error } = await supabase.from("profiles").select("*").eq("id", auth.uid).maybeSingle();
  if (error) return isUnreachable(error) ? { status: "unavailable" } : { status: "signed-out" };
  return data ? { status: "ok", profile: data as Profile } : { status: "signed-out" };
}
