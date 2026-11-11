"use client";
import { useState } from "react";
import { BarChart3, Scale } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { TrendChart } from "@/components/Charts";
import { Button, Card, Empty, ErrorBox, NumInput, Select, Spinner } from "@/components/ui";
import { addDays, errMsg, fmtDate, fromKg, localDate, toKg, type Unit } from "@/lib/utils";

type Logged = { exercise_id: string; name: string; is_bodyweight: boolean; sessions: number };
type Hist = { performed_on: string; top_weight_kg: number | null; top_reps: number | null; total_reps: number; volume_kg: number };
type BW = { id: string; entry_date: string; weight_kg: number };

export default function ProgressView({ clientId, unit, canLogWeight, from, to }: { clientId: string; unit: Unit; canLogWeight: boolean; from?: string; to?: string }) {
  const supabase = createClient();
  const today = localDate();
  const rangeFrom = from ?? addDays(today, -27);
  const rangeTo = to ?? today;

  const { data, loading, error, reload } = useAsync(async () => {
    const [logged, bw, completed, missed] = await Promise.all([
      supabase.rpc("logged_exercises", { p_client: clientId }),
      supabase.from("body_weights").select("*").eq("client_id", clientId).order("entry_date"),
      supabase.from("workout_sessions").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("status", "completed").gte("scheduled_date", rangeFrom).lte("scheduled_date", rangeTo),
      supabase.rpc("missed_sessions", { p_client: clientId, p_from: rangeFrom, p_to: rangeTo < today ? rangeTo : addDays(today, -1) }),
    ]);
    if (completed.error) throw completed.error;
    return {
      logged: must(logged) as Logged[],
      bw: must(bw) as BW[],
      completed: completed.count ?? 0,
      missed: (must(missed) as unknown[]).length,
    };
  }, [clientId, rangeFrom, rangeTo]);

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox message={error ?? "Couldn't load progress"} onRetry={reload} />;

  const scheduled = data.completed + data.missed;
  const rate = scheduled ? Math.round((data.completed / scheduled) * 100) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Completed" value={String(data.completed)} />
        <Stat label="Missed" value={String(data.missed)} />
        <Stat label="Completion" value={rate === null ? "—" : `${rate}%`} />
      </div>
      <p className="-mt-2 text-xs text-muted">{fmtDate(rangeFrom)} – {fmtDate(rangeTo)}</p>

      <ExerciseProgress clientId={clientId} unit={unit} logged={data.logged} from={from} to={to} />
      <BodyWeight clientId={clientId} unit={unit} entries={data.bw} canLog={canLogWeight} onSaved={() => reload({ silent: true })} from={from} to={to} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-3 text-center">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs font-medium text-muted">{label}</p>
    </div>
  );
}

function ExerciseProgress({ clientId, unit, logged, from, to }: { clientId: string; unit: Unit; logged: Logged[]; from?: string; to?: string }) {
  const supabase = createClient();
  const [exId, setExId] = useState(logged[0]?.exercise_id ?? "");
  const ex = logged.find((l) => l.exercise_id === exId);
  const { data, loading, error } = useAsync(async () => {
    if (!exId) return [] as Hist[];
    return must(await supabase.rpc("exercise_history", { p_client: clientId, p_exercise: exId })) as Hist[];
  }, [clientId, exId]);

  const rows = (data ?? [])
    .filter((h) => (!from || h.performed_on >= from) && (!to || h.performed_on <= to))
    .map((h) => ({ date: h.performed_on, weight: fromKg(h.top_weight_kg, unit), reps: h.top_reps }));

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <BarChart3 className="size-5 text-brand" />
        <h2 className="font-bold">Exercise progress</h2>
      </div>
      {logged.length === 0 ? (
        <Empty title="No exercises logged yet">Complete a workout to see weight and reps over time.</Empty>
      ) : (
        <>
          <Select value={exId} onChange={(e) => setExId(e.target.value)} aria-label="Exercise">
            {logged.map((l) => <option key={l.exercise_id} value={l.exercise_id}>{l.name} ({l.sessions})</option>)}
          </Select>
          {loading ? <Spinner /> : error ? <ErrorBox message={error} /> : rows.length === 0 ? (
            <p className="text-sm text-muted">No sessions in this date range.</p>
          ) : (
            <TrendChart
              data={rows}
              series={
                ex?.is_bodyweight && rows.every((r) => r.weight == null)
                  ? [{ key: "reps", label: "Best reps", color: "#0f766e" }]
                  : [
                      { key: "weight", label: `Top weight (${unit})`, color: "#0f766e" },
                      { key: "reps", label: "Best reps", color: "#f59e0b", axis: "right" },
                    ]
              }
            />
          )}
        </>
      )}
    </Card>
  );
}

function BodyWeight({ clientId, unit, entries, canLog, onSaved, from, to }: { clientId: string; unit: Unit; entries: BW[]; canLog: boolean; onSaved: () => void; from?: string; to?: string }) {
  const supabase = createClient();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const rows = entries
    .filter((e) => (!from || e.entry_date >= from) && (!to || e.entry_date <= to))
    .map((e) => ({ date: e.entry_date, weight: fromKg(e.weight_kg, unit) }));
  const latest = entries.at(-1);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const v = parseFloat(value.replace(",", "."));
    const kg = toKg(v, unit);
    if (!kg || kg < 20 || kg > 500) return setError(`Enter a weight between ${unit === "kg" ? "20 and 500 kg" : "44 and 1100 lb"}.`);
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("body_weights").upsert({ client_id: clientId, entry_date: localDate(), weight_kg: Number(kg.toFixed(2)) }, { onConflict: "client_id,entry_date" });
    setSaving(false);
    if (error) return setError(errMsg(error));
    setValue("");
    onSaved();
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <Scale className="size-5 text-brand" />
        <h2 className="flex-1 font-bold">Body weight</h2>
        {latest && <span className="text-sm font-semibold tabular-nums">{fromKg(latest.weight_kg, unit)} {unit}</span>}
      </div>
      {rows.length > 1 ? (
        <TrendChart data={rows} series={[{ key: "weight", label: `Body weight (${unit})`, color: "#0f766e" }]} height={180} />
      ) : (
        <p className="text-sm text-muted">{rows.length === 1 ? "Log one more entry to see a trend." : "No body-weight entries yet (optional)."}</p>
      )}
      {canLog && (
        <form onSubmit={save} className="flex gap-2" noValidate>
          <NumInput decimal placeholder={`Today's weight (${unit})`} value={value} onChange={(e) => setValue(e.target.value)} aria-label={`Body weight in ${unit}`} className="flex-1" />
          <Button type="submit" loading={saving}>Log</Button>
        </form>
      )}
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
    </Card>
  );
}
