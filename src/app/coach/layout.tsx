import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import ServiceUnavailable from "@/components/ServiceUnavailable";
import { loadProfile } from "@/lib/supabase/server";

export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const res = await loadProfile();
  if (res.status === "unavailable") return <ServiceUnavailable />;
  if (res.status === "signed-out") redirect("/login");
  if (res.profile.role !== "coach") redirect("/today");
  return <AppShell profile={res.profile}>{children}</AppShell>;
}
