import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";

export default async function Home() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role === "coach") redirect("/coach");
  if (!profile.onboarded) redirect("/onboarding");
  redirect("/today");
}
