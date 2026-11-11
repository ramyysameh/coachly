"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/supabase/server";
import { Button, ErrorBox, Field, Input, Textarea } from "@/components/ui";
import { cn, errMsg } from "@/lib/utils";

export default function OnboardingForm({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [name, setName] = useState(profile.full_name);
  const [goal, setGoal] = useState(profile.goal ?? "");
  const [unit, setUnit] = useState<"kg" | "lb">(profile.weight_unit);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Enter your name.";
    if (!goal.trim()) errs.goal = "Tell your coach what you're working towards.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    setError(null);
    const { error } = await createClient()
      .from("profiles")
      .update({ full_name: name.trim(), goal: goal.trim(), weight_unit: unit, onboarded: true })
      .eq("id", profile.id);
    if (error) {
      setSaving(false);
      return setError(errMsg(error));
    }
    router.replace("/today");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-md px-5 py-10">
      <h1 className="text-2xl font-bold">Welcome! Let&apos;s set you up</h1>
      <p className="mt-1 text-muted">This helps your coach plan your training.</p>
      <form onSubmit={save} className="mt-6 space-y-5" noValidate>
        {error && <ErrorBox message={error} />}
        <Field label="Your name" error={errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
        <Field label="Fitness goal" error={errors.goal} hint="e.g. Build muscle, run a 10k, lose 5 kg">
          <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} />
        </Field>
        <div>
          <span className="mb-1 block text-sm font-medium">Preferred weight unit</span>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Weight unit">
            {(["kg", "lb"] as const).map((u) => (
              <button
                type="button"
                key={u}
                role="radio"
                aria-checked={unit === u}
                onClick={() => setUnit(u)}
                className={cn("min-h-14 rounded-xl border-2 text-lg font-bold", unit === u ? "border-brand bg-brand/5 text-brand-dark" : "border-line bg-white text-muted")}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
        <Button type="submit" loading={saving} size="lg" className="w-full">Continue</Button>
      </form>
    </main>
  );
}
