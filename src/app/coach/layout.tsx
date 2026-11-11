import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getProfile } from "@/lib/supabase/server";

export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "coach") redirect("/today");
  return <AppShell profile={profile}>{children}</AppShell>;
}
