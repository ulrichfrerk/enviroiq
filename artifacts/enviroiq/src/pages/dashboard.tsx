import React, { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useGetOrganisationSummary, useListFleetEvents } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { CloudRain, Car, Zap, Target, ArrowUpRight, ArrowDownRight, Loader2, TrendingDown, Beaker, ChevronRight, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RechartsTooltip,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { format, parseISO } from "date-fns";

// Period selector options — period sent to API, groupBy derived server-side
const PERIODS = [
  { label: "7D",  value: "7d",  groupBy: "day",   xFmt: (d: string) => format(parseISO(d), "d MMM"),   ttFmt: (d: string) => format(parseISO(d), "d MMM yyyy") },
  { label: "30D", value: "30d", groupBy: "day",   xFmt: (d: string) => format(parseISO(d), "d MMM"),   ttFmt: (d: string) => format(parseISO(d), "d MMM yyyy") },
  { label: "3M",  value: "3m",  groupBy: "week",  xFmt: (d: string) => format(parseISO(d), "d MMM"),   ttFmt: (d: string) => `Week of ${format(parseISO(d), "d MMM yyyy")}` },
  { label: "12M", value: "12m", groupBy: "month", xFmt: (d: string) => format(parseISO(d), "MMM"),     ttFmt: (d: string) => format(parseISO(d), "MMMM yyyy") },
] as const;

type PeriodValue = (typeof PERIODS)[number]["value"];

interface TimeSeriesPoint { date: string; co2eKg: number; }

interface EmissionTotals {
  period: string;
  groupBy: string;
  totalCo2eKg: number;
  timeSeries: TimeSeriesPoint[];
  breakdowns: { label: string; co2eKg: number; percentage: number }[];
}

function useEmissionTotals(orgId: string | undefined, period: PeriodValue) {
  return useQuery<EmissionTotals>({
    queryKey: ["emissionTotals", orgId, period],
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const params = new URLSearchParams({ period });
      const res = await fetch(`/api/organisations/${orgId}/emissions/totals?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch emission totals");
      return res.json() as Promise<EmissionTotals>;
    },
  });
}

interface MaturityResult {
  total: number;
  grade: string;
  dimensions: { id: string; label: string; score: number; max: number; tips: string[] }[];
}

interface EmissionTarget {
  id: string;
  baselineYear: number;
  baselineCo2eKg: number;
  targetYear: number;
  targetPctReduction: number;
  label?: string;
  framework?: string;
}

export default function Dashboard() {
  const { session } = useAuth();
  const orgId = session?.organisationId;

  const [trendPeriod, setTrendPeriod] = useState<PeriodValue>("12m");
  const activePeriod = PERIODS.find(p => p.value === trendPeriod)!;

  const { data: summary, isLoading: loadingSummary } = useGetOrganisationSummary(orgId!, undefined, { query: { enabled: !!orgId } });
  const { data: emissions, isLoading: loadingEmissions } = useEmissionTotals(orgId, trendPeriod);
  const { data: fleetEvents } = useListFleetEvents(orgId!, { limit: 5 }, { query: { enabled: !!orgId } });

  const { data: maturity } = useQuery<MaturityResult>({
    queryKey: ["maturity", orgId],
    enabled: !!orgId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/organisations/${orgId}/maturity`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch maturity");
      return res.json();
    },
  });

  const { data: targetsData } = useQuery<{ items: EmissionTarget[] }>({
    queryKey: ["targets-dash", orgId],
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/organisations/${orgId}/targets`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch targets");
      return res.json();
    },
  });

  if (loadingSummary) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (!summary) return <div>No data available</div>;

  const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))'];

  const pieData = [
    { name: 'Fleet', value: summary.fleetCo2eKg },
    { name: 'Energy', value: summary.energyCo2eKg },
    { name: 'Other', value: Math.max(0, summary.totalCo2eKg - summary.fleetCo2eKg - summary.energyCo2eKg) }
  ].filter(d => d.value > 0);

  const StatCard = ({ title, value, icon: Icon, trend, trendGood }: {
    title: string;
    value: string;
    icon: React.ComponentType<{ className?: string }>;
    trend?: number | null;
    trendGood?: boolean;
  }) => (
    <Card className="p-6 bg-card border-border/50 shadow-lg shadow-black/5 hover:border-border transition-all">
      <div className="flex justify-between items-start mb-4">
        <div className="p-3 bg-secondary/50 rounded-xl">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        {trend != null && (
          <div className={`flex items-center text-sm font-medium ${trendGood ? 'text-emerald-400' : 'text-destructive'}`}>
            {trend > 0 ? <ArrowUpRight className="w-4 h-4 mr-1" /> : <ArrowDownRight className="w-4 h-4 mr-1" />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <h3 className="text-muted-foreground text-sm font-medium">{title}</h3>
      <p className="text-3xl font-display font-bold text-foreground mt-1 tracking-tight">{value}</p>
    </Card>
  );

  // Decide how many x-axis ticks to show based on data density
  const ticks = (() => {
    if (!emissions?.timeSeries?.length) return undefined;
    const n = emissions.timeSeries.length;
    if (n <= 14) return undefined; // show all
    // For dense series (30d/day = ~30 points), tick every 5–7 days
    const step = Math.ceil(n / 8);
    return emissions.timeSeries.filter((_, i) => i % step === 0).map(d => d.date);
  })();

  const hasData = emissions?.timeSeries?.some(d => d.co2eKg > 0);

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{session?.organisationName} Dashboard</h1>
          <p className="text-muted-foreground mt-1">Your ESG metrics at a glance.</p>
        </div>
        <div className="flex items-center gap-3 bg-secondary/30 border border-border/50 px-4 py-2 rounded-full">
          <span className="text-sm text-muted-foreground">Sustainability Score</span>
          <span className="text-2xl font-bold gradient-text">{summary.sustainabilityScore}/100</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Total CO₂e (kg)"
          value={summary.totalCo2eKg.toLocaleString()}
          icon={CloudRain}
          trend={summary.periodOverPeriodChange}
          trendGood={summary.periodOverPeriodChange! < 0}
        />
        <StatCard title="Fleet Emissions (kg)" value={summary.fleetCo2eKg.toLocaleString()} icon={Car} />
        <StatCard title="Energy Usage (kWh)" value={summary.totalEnergyKwh.toLocaleString()} icon={Zap} />
        <StatCard title="Goals On Track" value={`${summary.goalsOnTrack || 0}`} icon={Target} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-6 col-span-1 border-border/50">
          <h3 className="font-semibold text-lg mb-6">Emissions Breakdown</h3>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {pieData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <RechartsTooltip
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                  itemStyle={{ color: 'hsl(var(--foreground))' }}
                  formatter={(val: number) => [`${val.toLocaleString()} kg`, '']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-4 mt-4">
            {pieData.map((entry, index) => (
              <div key={entry.name} className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                <span className="text-muted-foreground">{entry.name}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-6 col-span-1 lg:col-span-2 border-border/50">
          {/* Header row with period toggle */}
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold text-lg">Emissions Trend</h3>
            <div className="flex rounded-lg border border-border/60 overflow-hidden text-xs font-medium">
              {PERIODS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setTrendPeriod(p.value)}
                  className={`px-3 py-1.5 transition-colors ${
                    trendPeriod === p.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary/60"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="h-[280px]">
            {loadingEmissions ? (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : !hasData ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                No emissions data for this period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={emissions!.timeSeries} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <defs>
                    <linearGradient id="co2Gradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="date"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    ticks={ticks}
                    tickFormatter={(val: string) => {
                      try { return activePeriod.xFmt(val); } catch { return val; }
                    }}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    tickFormatter={(val: number) =>
                      val >= 1000 ? `${(val / 1000).toFixed(1)}k` : String(Math.round(val))
                    }
                  />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                    labelFormatter={(val: string) => { try { return activePeriod.ttFmt(val); } catch { return val; } }}
                    formatter={(val: number) => [`${val.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg CO₂e`, "Emissions"]}
                    cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="co2eKg"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2.5}
                    fill="url(#co2Gradient)"
                    dot={false}
                    activeDot={{ r: 5, fill: 'hsl(var(--primary))', strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Summary row below chart */}
          {emissions && hasData && (
            <div className="mt-4 pt-4 border-t border-border/40 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <span>
                <span className="font-semibold text-foreground">
                  {emissions.totalCo2eKg.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg
                </span>{" "}total CO₂e
              </span>
              {emissions.breakdowns.map(b => b.co2eKg > 0 && (
                <span key={b.label}>
                  {b.label}: <span className="font-medium text-foreground/80">{b.co2eKg.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg</span>
                  <span className="ml-1">({b.percentage.toFixed(0)}%)</span>
                </span>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Maturity + Targets row ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Maturity score card */}
        <Card className="p-6 border-border/50">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-semibold text-lg">Maturity Score</h3>
            {maturity && (
              <span className={`text-xs font-semibold px-3 py-1 rounded-full ${
                maturity.grade === "Leader"    ? "bg-emerald-900/40 text-emerald-300" :
                maturity.grade === "Advanced"  ? "bg-blue-900/40 text-blue-300" :
                maturity.grade === "Developing"? "bg-amber-900/40 text-amber-300" :
                                                  "bg-secondary text-muted-foreground"
              }`}>{maturity.grade}</span>
            )}
          </div>
          {maturity ? (
            <div className="space-y-4">
              {/* Total score ring + number */}
              <div className="flex items-center gap-5 mb-2">
                <div className="relative shrink-0">
                  <svg width={72} height={72} className="-rotate-90">
                    <circle cx={36} cy={36} r={28} fill="none" stroke="hsl(var(--border))" strokeWidth={6} />
                    <circle
                      cx={36} cy={36} r={28} fill="none"
                      stroke={maturity.total >= 80 ? "#34d399" : maturity.total >= 55 ? "#60a5fa" : maturity.total >= 30 ? "#f59e0b" : "#f87171"}
                      strokeWidth={6}
                      strokeDasharray={`${2 * Math.PI * 28}`}
                      strokeDashoffset={`${2 * Math.PI * 28 * (1 - maturity.total / 100)}`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xl font-bold tabular-nums">{maturity.total}</span>
                  </div>
                </div>
                <div className="space-y-1.5 flex-1">
                  {maturity.dimensions.map(d => (
                    <div key={d.id} className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground w-28 shrink-0">{d.label}</span>
                      <div className="flex-1 h-1.5 bg-secondary/40 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/70 transition-all"
                          style={{ width: `${(d.score / d.max) * 100}%` }}
                        />
                      </div>
                      <span className="tabular-nums text-muted-foreground w-8 text-right">{d.score}/{d.max}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Top tip */}
              {maturity.dimensions.flatMap(d => d.tips).slice(0, 1).map((tip, i) => (
                <p key={i} className="text-xs text-muted-foreground/80 bg-secondary/20 rounded-lg px-3 py-2 italic">
                  💡 {tip}
                </p>
              ))}
            </div>
          ) : (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          )}
        </Card>

        {/* Targets card */}
        <Card className="p-6 border-border/50">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-semibold text-lg">Emission Targets</h3>
            <Link href="/targets" className="flex items-center gap-1 text-xs text-primary hover:underline">
              Manage <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          {!targetsData ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : targetsData.items.length === 0 ? (
            <div className="text-center py-6">
              <TrendingDown className="w-8 h-8 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground mb-3">No targets set yet.</p>
              <Link href="/targets">
                <button className="text-xs text-primary hover:underline">Set your first target →</button>
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {targetsData.items.slice(0, 3).map(t => {
                const targetKg = t.baselineCo2eKg * (1 - t.targetPctReduction / 100);
                const currentKg = summary?.totalCo2eKg;
                const reductionNeeded = t.baselineCo2eKg - targetKg;
                const reductionAchieved = currentKg != null ? Math.max(0, t.baselineCo2eKg - currentKg) : null;
                const progressPct = reductionAchieved != null && reductionNeeded > 0
                  ? Math.min((reductionAchieved / reductionNeeded) * 100, 100)
                  : 0;
                const yearsLeft = t.targetYear - new Date().getFullYear();
                const onTrack = progressPct >= ((new Date().getFullYear() - t.baselineYear) / (t.targetYear - t.baselineYear)) * 100 * 0.8;

                return (
                  <div key={t.id} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground flex-1 truncate">
                        {t.label || `↓${t.targetPctReduction}% by ${t.targetYear}`}
                      </span>
                      {reductionAchieved != null && (
                        <span className={`flex items-center gap-1 text-xs ${onTrack ? "text-emerald-400" : "text-amber-400"}`}>
                          {onTrack ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                          {onTrack ? "On track" : "Needs attention"}
                        </span>
                      )}
                    </div>
                    <div className="h-2.5 bg-secondary/40 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-400 transition-all"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{Math.round(progressPct)}% reduction achieved</span>
                      <span>{yearsLeft > 0 ? `${yearsLeft}yr${yearsLeft !== 1 ? "s" : ""} to go` : "Due now"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <Card className="border-border/50 overflow-hidden">
        <div className="p-6 border-b border-border/50 bg-secondary/20">
          <h3 className="font-semibold text-lg">Recent Fleet Activity</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary/30 text-muted-foreground uppercase text-xs font-semibold">
              <tr>
                <th className="px-6 py-4">Time</th>
                <th className="px-6 py-4">Vehicle</th>
                <th className="px-6 py-4">Event</th>
                <th className="px-6 py-4">Impact (CO₂e)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {fleetEvents?.items?.map((event) => (
                <tr key={event.id} className="hover:bg-secondary/20 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">{format(new Date(event.recordedAt), "MMM d, HH:mm")}</td>
                  <td className="px-6 py-4 font-medium text-foreground">{event.vehicleName || event.vehicleId}</td>
                  <td className="px-6 py-4 capitalize">
                    <span className="px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground text-xs">
                      {event.eventType.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-emerald-400 font-medium">+{event.co2eKg?.toFixed(2)} kg</td>
                </tr>
              ))}
              {(!fleetEvents?.items || fleetEvents.items.length === 0) && (
                <tr><td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">No recent events.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
