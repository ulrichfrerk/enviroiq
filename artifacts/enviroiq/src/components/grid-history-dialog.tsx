import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, BatteryCharging, TrendingDown, TrendingUp, Wind } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

type Range = "24h" | "7d" | "30d" | "90d";

interface HistoryPoint {
  t: string;
  g: number;
  r: number;
}

interface HistoryResponse {
  range: Range;
  hours: number;
  since: string;
  count: number;
  summary: {
    avg: number;
    min: { t: string; g: number } | null;
    max: { t: string; g: number } | null;
    lowPct: number;
    medPct: number;
    highPct: number;
  };
  hourlyAverage: Array<{ hour: number; g: number | null; samples: number }>;
  hourlyTimezone?: string;
  points: HistoryPoint[];
  source: string;
}

const RANGE_OPTIONS: Array<{ value: Range; label: string }> = [
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 d" },
  { value: "30d", label: "30 d" },
  { value: "90d", label: "90 d" },
];

function intensityColor(g: number | null | undefined): string {
  if (g == null) return "#52525b";
  if (g < 60) return "#10b981";
  if (g < 100) return "#f59e0b";
  return "#ef4444";
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GridHistoryDialog({ open, onOpenChange }: Props) {
  const [range, setRange] = useState<Range>("7d");

  const { data, isLoading, error } = useQuery<HistoryResponse>({
    queryKey: ["nz-grid-intensity-history", range],
    queryFn: async () => {
      const res = await fetch(`/api/grid/nz/history?range=${range}`);
      if (!res.ok) throw new Error("Failed to fetch grid history");
      return res.json() as Promise<HistoryResponse>;
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const chartData = useMemo(
    () =>
      (data?.points ?? []).map((p) => ({
        t: new Date(p.t).getTime(),
        g: p.g,
        r: p.r,
      })),
    [data],
  );

  const tickFormatter = (value: number) => {
    const d = new Date(value);
    if (range === "24h") return format(d, "HH:mm");
    if (range === "7d") return format(d, "EEE HH:mm");
    return format(d, "d MMM");
  };

  const greenestHour = useMemo(() => {
    if (!data?.hourlyAverage) return null;
    const valid = data.hourlyAverage.filter((h) => h.g != null && h.samples > 0) as Array<{
      hour: number;
      g: number;
      samples: number;
    }>;
    if (!valid.length) return null;
    return valid.reduce((min, cur) => (cur.g < min.g ? cur : min), valid[0]);
  }, [data]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl max-h-[90vh] overflow-y-auto"
        data-testid="grid-history-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BatteryCharging className="w-5 h-5 text-emerald-400" />
            NZ Grid Carbon Intensity — history
          </DialogTitle>
          <DialogDescription>
            How clean the NZ grid has been over time. Use the lowest-intensity
            windows below to plan EV charging, heat-pump runs, or any flexible
            load — the same kWh emits ~10× less CO₂ on a low-carbon hour than a
            high-carbon one.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-4 mt-2">
          <div className="flex gap-1 bg-muted/40 rounded-md p-1">
            {RANGE_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                size="sm"
                variant={range === opt.value ? "default" : "ghost"}
                className={cn(
                  "h-7 px-3 text-xs",
                  range === opt.value && "shadow",
                )}
                onClick={() => setRange(opt.value)}
                data-testid={`grid-history-range-${opt.value}`}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          {data && (
            <span className="text-xs text-muted-foreground">
              {data.count} samples · since{" "}
              {format(new Date(data.since), "d MMM yyyy")}
            </span>
          )}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center h-72">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="text-sm text-red-500 py-8 text-center">
            Could not load grid history. Please try again.
          </div>
        )}

        {data && !isLoading && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              <SummaryStat
                label="Window average"
                value={`${data.summary.avg.toFixed(1)} g`}
                accent={intensityColor(data.summary.avg)}
              />
              <SummaryStat
                label="Lowest"
                icon={<TrendingDown className="w-3 h-3" />}
                value={
                  data.summary.min
                    ? `${data.summary.min.g.toFixed(1)} g`
                    : "—"
                }
                detail={
                  data.summary.min
                    ? format(new Date(data.summary.min.t), "d MMM HH:mm")
                    : undefined
                }
                accent="#10b981"
              />
              <SummaryStat
                label="Highest"
                icon={<TrendingUp className="w-3 h-3" />}
                value={
                  data.summary.max
                    ? `${data.summary.max.g.toFixed(1)} g`
                    : "—"
                }
                detail={
                  data.summary.max
                    ? format(new Date(data.summary.max.t), "d MMM HH:mm")
                    : undefined
                }
                accent="#ef4444"
              />
              <SummaryStat
                label="Time in low-carbon"
                icon={<Wind className="w-3 h-3" />}
                value={`${data.summary.lowPct}%`}
                detail={`< 60 g · med ${data.summary.medPct}% · high ${data.summary.highPct}%`}
                accent="#10b981"
              />
            </div>

            <div className="mt-6">
              <h4 className="text-sm font-medium mb-2">
                Carbon intensity over time
              </h4>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart
                  data={chartData}
                  margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="gIntensity" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis
                    dataKey="t"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    scale="time"
                    tickFormatter={tickFormatter}
                    stroke="#71717a"
                    fontSize={11}
                  />
                  <YAxis
                    stroke="#71717a"
                    fontSize={11}
                    label={{
                      value: "gCO₂e/kWh",
                      angle: -90,
                      position: "insideLeft",
                      offset: 18,
                      style: { fill: "#71717a", fontSize: 11 },
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#0a0a0a",
                      border: "1px solid #27272a",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                    labelFormatter={(value) =>
                      format(new Date(Number(value)), "d MMM yyyy HH:mm")
                    }
                    formatter={(value: number, name: string) => [
                      `${Number(value).toFixed(1)}${name === "g" ? " gCO₂e/kWh" : " %"}`,
                      name === "g" ? "Intensity" : "Renewable",
                    ]}
                  />
                  <ReferenceLine
                    y={60}
                    stroke="#10b981"
                    strokeDasharray="3 3"
                    label={{
                      value: "Low / Med",
                      position: "right",
                      fill: "#10b981",
                      fontSize: 10,
                    }}
                  />
                  <ReferenceLine
                    y={100}
                    stroke="#ef4444"
                    strokeDasharray="3 3"
                    label={{
                      value: "Med / High",
                      position: "right",
                      fill: "#ef4444",
                      fontSize: 10,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="g"
                    stroke="#10b981"
                    strokeWidth={1.6}
                    fill="url(#gIntensity)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-6">
              <div className="flex items-baseline justify-between mb-2">
                <h4 className="text-sm font-medium">
                  Average by hour of day{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    (NZ time)
                  </span>
                </h4>
                {greenestHour && (
                  <span className="text-xs text-emerald-400">
                    Greenest window: {String(greenestHour.hour).padStart(2, "0")}:00 NZT ·{" "}
                    {greenestHour.g.toFixed(1)} g
                  </span>
                )}
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={data.hourlyAverage.map((h) => ({
                    hour: `${String(h.hour).padStart(2, "0")}:00`,
                    g: h.g,
                  }))}
                  margin={{ top: 4, right: 12, left: -8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="hour" stroke="#71717a" fontSize={10} interval={1} />
                  <YAxis
                    stroke="#71717a"
                    fontSize={10}
                    label={{
                      value: "g/kWh",
                      angle: -90,
                      position: "insideLeft",
                      offset: 18,
                      style: { fill: "#71717a", fontSize: 10 },
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#0a0a0a",
                      border: "1px solid #27272a",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                    formatter={(value: number) =>
                      value == null ? "—" : `${Number(value).toFixed(1)} gCO₂e/kWh`
                    }
                  />
                  <Bar dataKey="g" radius={[3, 3, 0, 0]}>
                    {data.hourlyAverage.map((h) => (
                      <Cell key={h.hour} fill={intensityColor(h.g)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="text-[11px] text-muted-foreground mt-2">
                Hours coloured green are typically the best to charge an EV or
                run a heat pump. Hours in red are when fossil-fired generation
                is filling the gap.
              </p>
            </div>

            <p className="text-[11px] text-muted-foreground/70 mt-4 text-right">
              {data.source}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryStat({
  label,
  value,
  detail,
  icon,
  accent,
}: {
  label: string;
  value: string;
  detail?: string;
  icon?: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-card/50 p-3">
      <div className="text-[11px] text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div
        className="text-lg font-semibold tabular-nums mt-0.5"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
      {detail && (
        <div className="text-[10px] text-muted-foreground mt-0.5">{detail}</div>
      )}
    </div>
  );
}
