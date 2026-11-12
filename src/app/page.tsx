import { redirect } from "next/navigation";
import ServiceUnavailable from "@/components/ServiceUnavailable";
import { loadProfile } from "@/lib/supabase/server";

export default async function Home() {
  const res = await loadProfile();
  if (res.status === "unavailable") return <ServiceUnavailable />;
  if (res.status === "signed-out") redirect("/login");
  const { profile } = res;
  if (profile.role === "coach") redirect("/coach");
  if (!profile.onboarded) redirect("/onboarding");
  redirect("/today");
}
