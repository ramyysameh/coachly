"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ClipboardList, Copy, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { useProfile } from "@/components/AppShell";
import { Button, Card, Empty, ErrorBox, Field, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { errMsg, WEEKDAYS } from "@/lib/utils";
import { notify } from "@/lib/notify";
import { ConfirmSheet, useSheet } from "@/components/Sheet";

type Row = { id: string; name: string; description: string | null; plan_days: { name: string; weekdays: number[]; plan_exercises: { id: string }[] }[] };

const PRESETS: Record<string, { name: string; days: { name: string; weekdays: number[] }[] }> = {
  blank: { name: "", days: [] },
  ppl: { name: "Push / Pull / Legs", days: [{ name: "Push", weekdays: [1, 4] }, { name: "Pull", weekdays: [2, 5] }, { name: "Legs", weekdays: [3, 6] }] },
  ul: { name: "Upper / Lower", days: [{ name: "Upper", weekdays: [1, 4] }, { name: "Lower", weekdays: [2, 5] }] },
  fb: { name: "Full Body 3x", days: [{ name: "Full Body A", weekdays: [1, 5] }, { name: "Full Body B", weekdays: [3] }] },
};

export default function PlansPage() {
  const supabase = createClient();
  const router = useRouter();
  const { profile } = useProfile();
  const [name, setName] = useState("");
  const [preset, setPreset] = useState("ppl");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const removing = useSheet<Row>();

  const { data, loading, error: loadError, reload } = useAsync(
    async () => must(await supabase.from("plans").select("id, name, description, plan_days(name, weekdays, position, plan_exercises(id))").eq("coach_id", profile.id).is("client_id", null).order("created_at", { ascending: false })) as Row[],
    [profile.id],
  );

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const p = PRESETS[preset];
    const planName = name.trim() || p.name;
    if (!planName) return setError("Give the plan a name.");
    setCreating(true);
    setError(null);
    const { data: plan, error } = await supabase.from("plans").insert({ coach_id: profile.id, name: planName }).select("id").single();
    if (!error && p.days.length) {
      const res = await supabase.from("plan_days").insert(p.days.map((d, i) => ({ plan_id: plan.id, position: i, name: d.name, weekdays: d.weekdays })));
      if (res.error) setError(errMsg(res.error));
    }
    setCreating(false);
    if (error) return setError(errMsg(error));
    router.push(`/coach/plans/${plan.id}`);
  }

  async function duplicate(r: Row) {
    const { data: id, error } = await supabase.rpc("copy_plan", { p_source: r.id, p_name: `${r.name} (copy)` });
    if (error) return notify.error(errMsg(error));
    notify.success("Template duplicated");
    router.push(`/coach/plans/${id}`);
  }

  async function remove(r: Row) {
    const { error } = await supabase.from("plans").delete().eq("id", r.id);
    if (error) throw error;
    reload({ silent: true });
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Plan templates" subtitle="Reusable splits. Assign them to clients from the client's profile." />
      <Card>
        <form onSubmit={create} className="space-y-3" noValidate>
          <h2 className="font-semibold">New template</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start from">
              <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
                <option value="ppl">Push / Pull / Legs</option>
                <option value="ul">Upper / Lower</option>
                <option value="fb">Full Body 3x</option>
                <option value="blank">Blank</option>
              </Select>
            </Field>
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={PRESETS[preset].name || "e.g. Strength block"} /></Field>
          </div>
          {error && <ErrorBox message={error} />}
          <Button type="submit" loading={creating}><Plus className="size-4" /> Create template</Button>
        </form>
      </Card>

      {loading ? <Spinner /> : loadError ? <ErrorBox message={loadError} onRetry={reload} /> : data!.length === 0 ? (
        <Empty icon={<ClipboardList className="size-8" />} title="No templates yet">Create your first split above.</Empty>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {data!.map((r) => (
            <li key={r.id} className="flex flex-col rounded-2xl border border-line bg-surface">
              <Link href={`/coach/plans/${r.id}`} className="flex flex-1 items-start gap-2 p-4 hover:bg-surface-2/60">
                <div className="flex-1">
                  <p className="font-semibold">{r.name}</p>
                  <p className="mt-1 text-sm text-muted">
                    {r.plan_days.length} days · {r.plan_days.reduce((n, d) => n + d.plan_exercises.length, 0)} exercises
                  </p>
                  <p className="mt-1 text-xs text-muted">{r.plan_days.map((d) => `${d.name} (${d.weekdays.map((w) => WEEKDAYS[w - 1]).join("/") || "-"})`).join(" · ")}</p>
                </div>
                <ChevronRight className="size-5 text-muted" />
              </Link>
              <div className="flex gap-1 border-t border-line p-2">
                <Button size="sm" variant="ghost" onClick={() => duplicate(r)}><Copy className="size-4" /> Duplicate</Button>
                <Button size="sm" variant="ghost" className="ml-auto text-danger" aria-label={`Delete ${r.name}`} onClick={() => removing.show(r)}><Trash2 className="size-4" /> Delete</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmSheet
        {...removing.bind}
        title="Delete template?"
        description={removing.item ? `Delete template "${removing.item.name}"? Plans already assigned to clients are not affected.` : undefined}
        confirmLabel="Delete"
        onConfirm={() => remove(removing.item!)}
      />
    </div>
  );
}
