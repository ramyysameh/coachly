"use client";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtDate } from "@/lib/utils";

type Series = { key: string; label: string; color: string; axis?: "left" | "right" };

export function TrendChart({ data, series, height = 220 }: { data: Record<string, unknown>[]; series: Series[]; height?: number }) {
  const hasRight = series.some((s) => s.axis === "right");
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: hasRight ? 0 : 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d) => fmtDate(d, { month: "short", day: "numeric" })} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={48} />
          {hasRight && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={36} />}
          <Tooltip labelFormatter={(d) => fmtDate(String(d))} contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s) => (
            <Line key={s.key} yAxisId={s.axis ?? "left"} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2.5} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
