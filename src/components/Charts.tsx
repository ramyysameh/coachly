"use client";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtDate } from "@/lib/utils";

/*
 * Chart conventions: one y-axis per chart, 2px lines, recessive grid,
 * a legend only when there's more than one series, hover tooltip on every chart.
 */
type Series = { key: string; label: string; color: string; dotsOnly?: boolean };

const tooltipStyle = {
  borderRadius: 12, border: "1px solid var(--color-line)", background: "var(--color-surface)",
  color: "var(--color-ink)", fontSize: 13, boxShadow: "0 8px 24px -12px rgb(15 23 42 / 0.25)",
};
const tick = { fontSize: 11, fill: "var(--color-muted)" };

export function TrendChart({ data, series, height = 220, unit, digits = 1 }: {
  data: Record<string, unknown>[]; series: Series[]; height?: number; unit?: string; digits?: number;
}) {
  const fmt = (v: unknown) => (typeof v === "number" ? `${Number(v.toFixed(digits))}${unit ? ` ${unit}` : ""}` : String(v ?? "-"));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d) => fmtDate(d, { month: "short", day: "numeric" })} tick={tick} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tick={tick} tickLine={false} axisLine={false} domain={["auto", "auto"]} width={48} tickFormatter={(v) => String(Math.round(v))} />
          <Tooltip labelFormatter={(d) => fmtDate(String(d))} formatter={(v, name) => [fmt(v), name]} contentStyle={tooltipStyle} cursor={{ stroke: "var(--color-muted)", strokeDasharray: "3 3" }} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />}
          {series.map((s) => (
            <Line
              key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.dotsOnly ? "none" : s.color}
              strokeWidth={2} dot={{ r: s.dotsOnly ? 3 : 4, fill: s.color, stroke: "var(--color-surface)", strokeWidth: 2 }}
              activeDot={{ r: 5, stroke: "var(--color-surface)", strokeWidth: 2 }} connectNulls isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Vertical bars over time (e.g. weekly adherence %), optional dashed reference line. */
export function BarsChart({ data, valueKey, label, height = 160, max, unit = "", reference, colorFor }: {
  data: { date: string; [k: string]: unknown }[]; valueKey: string; label: string; height?: number; max?: number; unit?: string;
  reference?: number; colorFor?: (row: Record<string, unknown>) => string;
}) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barCategoryGap={6}>
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d) => fmtDate(d, { month: "short", day: "numeric" })} tick={tick} tickLine={false} axisLine={false} minTickGap={12} />
          <YAxis tick={tick} tickLine={false} axisLine={false} width={48} domain={[0, max ?? "auto"]} tickFormatter={(v) => `${v}${unit}`} />
          <Tooltip
            labelFormatter={(d) => `Week of ${fmtDate(String(d), { month: "short", day: "numeric" })}`}
            formatter={(v) => [v === null || v === undefined ? "Nothing planned" : `${v}${unit}`, label]}
            contentStyle={tooltipStyle} cursor={{ fill: "var(--color-surface-2)" }}
          />
          {reference !== undefined && <ReferenceLine y={reference} stroke="var(--color-muted)" strokeDasharray="4 4" />}
          <Bar dataKey={valueKey} name={label} radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={36}>
            {data.map((row) => <Cell key={row.date} fill={colorFor ? colorFor(row) : "var(--color-brand)"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
