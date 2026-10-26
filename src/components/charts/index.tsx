"use client";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const NAVY = "#14213d";
const GREEN = "#2f7d4f";
const GRID = "#e6e3dc";
const TICK = { fontSize: 11, fill: "#5f6268", fontFamily: "var(--font-plex-mono)" };
const inr = (v: number) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`);
const full = (v: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
const tip = { borderRadius: 3, border: "1px solid #c9c5bb", fontSize: 12, boxShadow: "none" };

/** Daily invoiced revenue, stacked by source. Bars read better than lines for sparse daily sales. */
export function RevenueChart({ data }: { data: { date: string; sales: number; service: number }[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 0, right: 8, top: 6 }} barCategoryGap={2}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d: string) => `${d.slice(8)}/${d.slice(5, 7)}`} tick={TICK} axisLine={{ stroke: "#c9c5bb" }} tickLine={false} minTickGap={18} />
          <YAxis tickFormatter={inr} tick={TICK} axisLine={false} tickLine={false} width={44} />
          <Tooltip formatter={(v: number) => full(v)} labelFormatter={(d: string) => d} contentStyle={tip} cursor={{ fill: "#f4f3ef" }} />
          <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="sales" name="Vehicle sales" stackId="r" fill={NAVY} maxBarSize={22} />
          <Bar dataKey="service" name="Service" stackId="r" fill={GREEN} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BranchChart({ data }: { data: { name: string; salesRevenue: number; serviceRevenue: number }[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={data.map((d) => ({ ...d, short: d.name.replace(/^.*—\s*/, "") }))} layout="vertical" margin={{ left: 8, right: 16, top: 6 }} barGap={1}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" tickFormatter={inr} tick={TICK} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="short" tick={{ fontSize: 12, fill: "#1b1d21" }} axisLine={false} tickLine={false} width={96} />
          <Tooltip formatter={(v: number) => full(v)} contentStyle={tip} cursor={{ fill: "#f4f3ef" }} />
          <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="salesRevenue" name="Vehicle sales" stackId="b" fill={NAVY} maxBarSize={14} />
          <Bar dataKey="serviceRevenue" name="Service" stackId="b" fill={GREEN} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
