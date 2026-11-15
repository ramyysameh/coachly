"use client";
import { useProfile } from "@/components/AppShell";
import NutritionDay from "@/components/NutritionDay";
import { ClientMealPlan } from "@/components/MealPlan";
import { PageHeader } from "@/components/ui";

export default function NutritionPage() {
  const { profile } = useProfile();
  return (
    <div>
      <PageHeader title="Nutrition" subtitle="Log meals and track against your coach's targets" />
      <NutritionDay clientId={profile.id} editable />
      <div className="mt-4">
        <ClientMealPlan clientId={profile.id} />
      </div>
    </div>
  );
}
