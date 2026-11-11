"use client";
import { useProfile } from "@/components/AppShell";
import ProgressView from "@/components/ProgressView";
import { PageHeader } from "@/components/ui";

export default function ProgressPage() {
  const { profile } = useProfile();
  return (
    <div>
      <PageHeader title="Progress" subtitle={`Last 4 weeks · weights in ${profile.weight_unit}`} />
      <ProgressView clientId={profile.id} unit={profile.weight_unit} canLogWeight />
    </div>
  );
}
