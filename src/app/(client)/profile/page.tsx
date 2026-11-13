"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Camera, ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/components/AppShell";
import { Avatar, Button, Card, ErrorBox, Field, Input, NumInput, PageHeader, Select, Textarea } from "@/components/ui";
import { cmToFtIn, ftInToCm, GOALS, LEVELS } from "@/lib/profile";
import { cn, errMsg, localDate } from "@/lib/utils";
import { notify } from "@/lib/notify";

export default function EditProfilePage() {
  const { profile } = useProfile();
  const router = useRouter();
  const supabase = createClient();
  const ftIn = profile.height_cm ? cmToFtIn(Number(profile.height_cm)) : null;
  const [f, setF] = useState({
    name: profile.full_name,
    dob: profile.date_of_birth ?? "",
    heightUnit: profile.height_unit,
    cm: profile.height_cm ? String(Math.round(Number(profile.height_cm))) : "",
    ft: ftIn ? String(ftIn.ft) : "",
    inch: ftIn ? String(ftIn.inch) : "",
    goalType: profile.goal_type ?? "",
    goal: profile.goal ?? "",
    level: profile.experience_level ?? "",
    days: profile.training_days_per_week ? String(profile.training_days_per_week) : "",
    injuries: profile.injuries ?? "",
    unit: profile.weight_unit,
  });
  const [avatar, setAvatar] = useState(profile.avatar_url);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function upload(file: File) {
    if (file.size > 2 * 1024 * 1024) return setErr("Photos must be under 2 MB.");
    setUploading(true);
    setErr(null);
    const path = `${profile.id}/avatar-${Date.now()}.${file.name.split(".").pop() || "jpg"}`;
    const up = await supabase.storage.from("avatars").upload(path, file, { contentType: file.type });
    if (up.error) { setUploading(false); return setErr(errMsg(up.error)); }
    const url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", profile.id);
    setUploading(false);
    if (error) return setErr(errMsg(error));
    setAvatar(url);
    router.refresh();
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return setErr("Enter your name.");
    let height_cm: number | null = null;
    if (f.heightUnit === "cm" && f.cm) height_cm = Number(f.cm);
    if (f.heightUnit === "ft" && (f.ft || f.inch)) height_cm = ftInToCm(Number(f.ft || 0), Number(f.inch || 0));
    if (height_cm !== null && (Number.isNaN(height_cm) || height_cm < 50 || height_cm > 260)) return setErr("Height looks wrong. Check the number and unit.");
    const days = f.days ? Number(f.days) : null;
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 7)) return setErr("Training days must be between 1 and 7.");
    setSaving(true);
    setErr(null);
    const { error } = await supabase.from("profiles").update({
      full_name: f.name.trim(), date_of_birth: f.dob || null, height_cm, height_unit: f.heightUnit,
      goal_type: f.goalType || null, goal: f.goal.trim() || null, experience_level: f.level || null,
      training_days_per_week: days, injuries: f.injuries.trim() || null, weight_unit: f.unit,
    }).eq("id", profile.id);
    setSaving(false);
    if (error) return setErr(errMsg(error));
    notify.success("Profile updated");
    router.refresh();
    router.push("/progress");
  }

  return (
    <div className="mx-auto max-w-xl">
      <Link href="/progress" className="mb-2 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-muted"><ChevronLeft className="size-4" /> Progress</Link>
      <PageHeader title="Your profile" subtitle="Your coach sees this at the top of your profile." />
      <form onSubmit={save} className="space-y-4" noValidate>
        <Card className="flex items-center gap-4">
          <Avatar name={f.name} src={avatar} size="lg" />
          <label className={cn("inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold hover:bg-surface-2", uploading && "opacity-60")}>
            <Camera className="size-4" /> {uploading ? "Uploading…" : avatar ? "Change photo" : "Add photo"}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={uploading}
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        </Card>

        <Card className="space-y-4">
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></Field>
          <Field label="Date of birth" hint="Only your age is shown"><Input type="date" value={f.dob} max={localDate()} onChange={(e) => setF({ ...f, dob: e.target.value })} /></Field>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium">Height</span>
              <Toggle value={f.heightUnit} options={["cm", "ft"]} onChange={(v) => setF({ ...f, heightUnit: v as "cm" | "ft" })} label="Height unit" />
            </div>
            {f.heightUnit === "cm" ? (
              <NumInput aria-label="Height in cm" value={f.cm} onChange={(e) => setF({ ...f, cm: e.target.value })} placeholder="cm" />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <NumInput aria-label="Feet" value={f.ft} onChange={(e) => setF({ ...f, ft: e.target.value })} placeholder="ft" />
                <NumInput aria-label="Inches" value={f.inch} onChange={(e) => setF({ ...f, inch: e.target.value })} placeholder="in" />
              </div>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Weight unit</span>
            <Toggle value={f.unit} options={["kg", "lb"]} onChange={(v) => setF({ ...f, unit: v as "kg" | "lb" })} label="Weight unit" />
          </div>
        </Card>

        <Card className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Main goal">
              <Select value={f.goalType} onChange={(e) => setF({ ...f, goalType: e.target.value })}>
                <option value="">Choose…</option>
                {GOALS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </Select>
            </Field>
            <Field label="Experience">
              <Select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>
                <option value="">Choose…</option>
                {LEVELS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Goal details" hint="e.g. Lose 5 kg before summer"><Textarea value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} rows={2} /></Field>
          <Field label="Training days per week"><NumInput value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} placeholder="e.g. 4" /></Field>
          <Field label="Injuries or limitations" hint="Anything your coach should plan around"><Textarea value={f.injuries} onChange={(e) => setF({ ...f, injuries: e.target.value })} rows={2} /></Field>
        </Card>

        {err && <ErrorBox message={err} />}
        <Button type="submit" size="lg" loading={saving} className="w-full">Save profile</Button>
      </form>
    </div>
  );
}

function Toggle({ value, options, onChange, label }: { value: string; options: string[]; onChange: (v: string) => void; label: string }) {
  return (
    <div className="flex rounded-lg bg-surface-2 p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={o} role="radio" aria-checked={value === o} onClick={() => onChange(o)}
          className={cn("min-h-8 rounded-md px-3 text-sm font-semibold", value === o ? "bg-surface text-ink shadow-card" : "text-muted")}>
          {o}
        </button>
      ))}
    </div>
  );
}
