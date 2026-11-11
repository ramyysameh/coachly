import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getProfile } from "@/lib/supabase/server";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "client") redirect("/coach");
  if (!profile.onboarded) redirect("/onboarding");
  return <AppShell profile={profile}>{children}</AppShell>;
}
