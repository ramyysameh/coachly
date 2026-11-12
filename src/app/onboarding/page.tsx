import { redirect } from "next/navigation";
import ServiceUnavailable from "@/components/ServiceUnavailable";
import { loadProfile } from "@/lib/supabase/server";
import OnboardingForm from "./OnboardingForm";

export default async function OnboardingPage() {
  const res = await loadProfile();
  if (res.status === "unavailable") return <ServiceUnavailable />;
  if (res.status === "signed-out") redirect("/login");
  if (res.profile.role === "coach") redirect("/coach");
  return <OnboardingForm profile={res.profile} />;
}
