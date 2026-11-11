import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";
import OnboardingForm from "./OnboardingForm";

export default async function OnboardingPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role === "coach") redirect("/coach");
  return <OnboardingForm profile={profile} />;
}
