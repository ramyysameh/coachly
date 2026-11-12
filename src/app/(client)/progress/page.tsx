"use client";
import { useAsync, must } from "@/lib/useAsync";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/components/AppShell";
import ProfileHeader from "@/components/ProfileHeader";
import ProgressView from "@/components/ProgressView";
import TrainingCalendar from "@/components/TrainingCalendar";

export default function ProgressPage() {
  const { profile } = useProfile();
  const supabase = createClient();
  const { data: since } = useAsync(async () => {
    const r = must(await supabase.from("coach_clients").select("created_at").eq("client_id", profile.id).eq("status", "active")
      .order("created_at").limit(1).maybeSingle()) as { created_at: string } | null;
    return r?.created_at ?? null;
  }, [profile.id]);
  return (
    <div className="space-y-4">
      <ProfileHeader clientId={profile.id} viewer="client" since={since} />
      <TrainingCalendar clientId={profile.id} unit={profile.weight_unit} />
      <div>
        <h2 className="mb-1 text-lg font-semibold tracking-tight">Stats</h2>
        <p className="mb-3 text-sm text-muted">Last 90 days · weights in {profile.weight_unit}</p>
        <ProgressView clientId={profile.id} unit={profile.weight_unit} canLogWeight />
      </div>
    </div>
  );
}
