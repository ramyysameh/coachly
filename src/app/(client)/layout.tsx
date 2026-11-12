import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import ServiceUnavailable from "@/components/ServiceUnavailable";
import { loadProfile } from "@/lib/supabase/server";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const res = await loadProfile();
  if (res.status === "unavailable") return <ServiceUnavailable />;
  if (res.status === "signed-out") redirect("/login");
  const { profile } = res;
  if (profile.role !== "client") redirect("/coach");
  if (!profile.onboarded) redirect("/onboarding");
  return <AppShell profile={profile}>{children}</AppShell>;
}
