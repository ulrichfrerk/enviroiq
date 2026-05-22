import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useListReports, useGenerateReport, ReportReportType } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  FileText, Download, Loader2, Plus, Calendar as CalIcon, TrendingDown, TrendingUp, Minus,
  BarChart2, Trash2,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

type MonthPoint = { month: string; fleetCo2e: number; energyCo2e: number; fleetKm: number; energyKwh: number };

type ReportTypeKey = keyof typeof ReportReportType;

type PeriodPreset = "Q1" | "Q2" | "Q3" | "Q4" | "H1" | "H2" | "FY";

const MONTH_NAMES_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** Returns [startDate, endDateInclusiveExclusive) for the Nth slice of FY,
 *  where each slice is `slice` months long. FY starts on day 1 of
 *  `fyStartMonth` (1–12) of the given calendar `year`. */
function fySlice(year: number, fyStartMonth: number, sliceIndex: number, sliceMonths: number) {
  const startMonth0 = (fyStartMonth - 1) + sliceIndex * sliceMonths; // 0..23
  const startYear = year + Math.floor(startMonth0 / 12);
  const startMonth = startMonth0 % 12;
  const endMonth0 = startMonth0 + sliceMonths;
  const endYear = year + Math.floor(endMonth0 / 12);
  const endMonth = endMonth0 % 12;
  // end = last second of the month before endMonth, i.e. day 0 of endMonth
  const from = new Date(startYear, startMonth, 1, 0, 0, 0);
  const to = new Date(endYear, endMonth, 0, 23, 59, 59);
  return { from, to, startMonth, endMonth: (endMonth + 11) % 12 };
}

function presetDates(preset: PeriodPreset, year: number, fyStartMonth: number): { from: Date; to: Date } {
  switch (preset) {
    case "Q1": return fySlice(year, fyStartMonth, 0, 3);
    case "Q2": return fySlice(year, fyStartMonth, 1, 3);
    case "Q3": return fySlice(year, fyStartMonth, 2, 3);
    case "Q4": return fySlice(year, fyStartMonth, 3, 3);
    case "H1": return fySlice(year, fyStartMonth, 0, 6);
    case "H2": return fySlice(year, fyStartMonth, 1, 6);
    case "FY": return fySlice(year, fyStartMonth, 0, 12);
  }
}

function presetLabel(preset: PeriodPreset, fyStartMonth: number): string {
  const slice = (idx: number, months: number) => {
    const startM = (fyStartMonth - 1 + idx * months) % 12;
    const endM = (fyStartMonth - 1 + (idx + 1) * months - 1) % 12;
    return `${MONTH_NAMES_SHORT[startM]}–${MONTH_NAMES_SHORT[endM]}`;
  };
  switch (preset) {
    case "Q1": return `Q1 (${slice(0, 3)})`;
    case "Q2": return `Q2 (${slice(1, 3)})`;
    case "Q3": return `Q3 (${slice(2, 3)})`;
    case "Q4": return `Q4 (${slice(3, 3)})`;
    case "H1": return `H1 (${slice(0, 6)})`;
    case "H2": return `H2 (${slice(1, 6)})`;
    case "FY": return fyStartMonth === 1 ? "Full Year" : `Full Year (FY${slice(0, 12)})`;
  }
}

const PRESET_KEYS: PeriodPreset[] = ["Q1", "Q2", "Q3", "Q4", "H1", "H2", "FY"];

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function monthLabel(ym: string) {
  const [, m] = ym.split("-");
  return MONTH_SHORT[parseInt(m) - 1];
}

function YoYBadge({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return <span className="text-xs text-muted-foreground">No prior year</span>;
  const neg = pct < 0;
  const Icon = neg ? TrendingDown : pct > 0 ? TrendingUp : Minus;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${neg ? "bg-emerald-500/10 text-emerald-400" : pct > 0 ? "bg-red-500/10 text-red-400" : "bg-secondary text-muted-foreground"}`}>
      <Icon className="w-3 h-3" />
      {Math.abs(pct).toFixed(1)}% vs prior year
    </span>
  );
}

export default function Reports() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);

  const { data: org } = useQuery<{ fyStartMonth?: number }>({
    queryKey: [`/api/organisations/${orgId}`],
    queryFn: () => fetch(`/api/organisations/${orgId}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!orgId,
  });
  const fyStartMonth = org?.fyStartMonth ?? 4;

  // FY label year = the calendar year the FY *ends* in if FY starts mid-year.
  // For a NZ April-start FY, "FY2026" = Apr 2025 → Mar 2026, so we work with
  // the calendar year that contains the FY start: thatYear = endYear - 1 when
  // fyStartMonth > 1. We expose `year` as the start-year for date math; label
  // it as the end-year for the UI.
  const now = new Date();
  const currentFyStartYear = now.getMonth() + 1 >= fyStartMonth ? now.getFullYear() : now.getFullYear() - 1;
  const [preset, setPreset] = useState<PeriodPreset>("FY");
  const [year, setYear] = useState(currentFyStartYear);
  const [reportType, setReportType] = useState<ReportTypeKey>("board_summary");
  const fyLabelYear = fyStartMonth === 1 ? year : year + 1;

  const { data: reports, isLoading, refetch } = useListReports(orgId!, { query: { enabled: !!orgId } });
  const generate = useGenerateReport();

  const { data: trendData, isLoading: trendLoading } = useQuery<{ data: MonthPoint[] }>({
    queryKey: [`/api/organisations/${orgId}/reports/trend`],
    queryFn: () => fetch(`/api/organisations/${orgId}/reports/trend?months=26`, { credentials: "include" }).then(r => r.json()),
    enabled: !!orgId,
  });

  const autoTitle = `${fyLabelYear} ${presetLabel(preset, fyStartMonth)} ESG Board Report`;

  const handleGenerate = async () => {
    const { from, to } = presetDates(preset, year, fyStartMonth);
    try {
      await generate.mutateAsync({
        orgId: orgId!,
        data: {
          title: autoTitle,
          reportType: ReportReportType[reportType],
          periodStart: from.toISOString(),
          periodEnd: to.toISOString(),
        },
      });
      toast({ title: "Report generating…", description: "Refresh in a moment to download." });
      setIsOpen(false);
      setTimeout(() => refetch(), 3000);
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "Failed" });
    }
  };

  const handleDownload = async (reportId: string, reportTitle?: string) => {
    const t = toast({ title: "Generating PDF…", description: "This usually takes a few seconds." });
    try {
      const res = await fetch(`/api/organisations/${orgId}/reports/${reportId}/pdf`, { credentials: "include" });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const m = cd.match(/filename="?([^";]+)"?/);
      const safe = (reportTitle ?? "report").replace(/[^a-z0-9]/gi, "_");
      const filename = m?.[1] ?? `${safe}_board_pack.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      t.dismiss?.();
      toast({ title: "Download ready", description: filename });
    } catch (e) {
      t.dismiss?.();
      toast({ variant: "destructive", title: "Download failed", description: e instanceof Error ? e.message : "Unknown error" });
    }
  };

  const handleTenderPackDownload = async () => {
    const t = toast({ title: "Generating tender pack…", description: "This usually takes a few seconds." });
    try {
      const res = await fetch(`/api/organisations/${orgId}/reports/tender-pack`, { credentials: "include" });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const m = cd.match(/filename="?([^";]+)"?/);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = m?.[1] ?? "tender_pack.pdf";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      t.dismiss?.();
      toast({ title: "Tender pack ready" });
    } catch (e) {
      t.dismiss?.();
      toast({ variant: "destructive", title: "Download failed", description: e instanceof Error ? e.message : "Unknown error" });
    }
  };

  const handleDelete = async (reportId: string) => {
    try {
      await fetch(`/api/organisations/${orgId}/reports/${reportId}`, { method: "DELETE", credentials: "include" });
      toast({ title: "Report deleted" });
      qc.invalidateQueries({ queryKey: [`/api/organisations/${orgId}/reports`] });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not delete report" });
    }
  };

  const chartData = useMemo(() => {
    if (!trendData?.data) return [];
    const raw = trendData.data;
    const byMonth: Record<string, { label: string; year: number; fleetCo2e: number; energyCo2e: number }> = {};
    for (const pt of raw) {
      const [y, m] = pt.month.split("-").map(Number);
      const label = MONTH_SHORT[m - 1];
      const key = `${label}|${y}`;
      byMonth[key] = { label, year: y, fleetCo2e: pt.fleetCo2e / 1000, energyCo2e: pt.energyCo2e / 1000 };
    }
    const years = [...new Set(raw.map(r => r.month.split("-")[0]))].sort().slice(-2);
    const [prevYear, curYear] = years.length === 1 ? [null, years[0]] : [years[0], years[1]];

    return MONTH_SHORT.map(mon => {
      const cur = curYear ? byMonth[`${mon}|${curYear}`] : null;
      const prev = prevYear ? byMonth[`${mon}|${prevYear}`] : null;
      return {
        month: mon,
        [`${curYear} Fleet`]: cur ? +(cur.fleetCo2e.toFixed(3)) : 0,
        [`${curYear} Energy`]: cur ? +(cur.energyCo2e.toFixed(3)) : 0,
        [`${prevYear} Fleet`]: prev ? +(prev.fleetCo2e.toFixed(3)) : undefined,
        [`${prevYear} Energy`]: prev ? +(prev.energyCo2e.toFixed(3)) : undefined,
        _hasData: !!(cur && (cur.fleetCo2e + cur.energyCo2e) > 0),
        _years: { cur: curYear, prev: prevYear },
      };
    }).filter(r => r._hasData || (r[`${years[0]} Fleet`] !== undefined));
  }, [trendData]);

  const yoyAnnual = useMemo(() => {
    if (!trendData?.data) return null;
    const raw = trendData.data;
    const years = [...new Set(raw.map(r => r.month.split("-")[0]))].sort().slice(-2);
    if (years.length < 2) return null;
    const [prev, cur] = years;

    // Only compare months that have data in the CURRENT year (same-period comparison).
    // This avoids a misleading result when the current year is partial (e.g. Jan–Mar only).
    const curMonths = new Set(
      raw.filter(r => r.month.startsWith(cur)).map(r => r.month.slice(5, 7))
    );
    const curTotal = raw
      .filter(r => r.month.startsWith(cur))
      .reduce((s, r) => s + r.fleetCo2e + r.energyCo2e, 0);
    const prevTotal = raw
      .filter(r => r.month.startsWith(prev) && curMonths.has(r.month.slice(5, 7)))
      .reduce((s, r) => s + r.fleetCo2e + r.energyCo2e, 0);

    if (prevTotal === 0) return null;

    // Build a human-readable period label e.g. "Jan–Mar"
    const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const sortedMonths = [...curMonths].sort();
    const firstMon = MONTH_NAMES[parseInt(sortedMonths[0], 10) - 1];
    const lastMon  = MONTH_NAMES[parseInt(sortedMonths[sortedMonths.length - 1], 10) - 1];
    const periodLabel = firstMon === lastMon ? firstMon : `${firstMon}–${lastMon}`;

    return { pct: ((curTotal - prevTotal) / prevTotal) * 100, cur, prev, curTotal, prevTotal, periodLabel };
  }, [trendData]);

  const chartYears = useMemo(() => {
    if (!trendData?.data) return { cur: null, prev: null };
    const years = [...new Set(trendData.data.map(r => r.month.split("-")[0]))].sort().slice(-2);
    return years.length === 1 ? { cur: years[0], prev: null } : { cur: years[1], prev: years[0] };
  }, [trendData]);

  if (isLoading) return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  const yearOptions = Array.from({ length: 5 }, (_, i) => currentFyStartYear - i);

  return (
    <div className="space-y-8 pb-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Board Reporting</h1>
          <p className="text-muted-foreground mt-1">Year-on-year comparison and professional ESG board reports.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" className="gap-2 border-primary/40 text-primary hover:bg-primary/10" onClick={handleTenderPackDownload}>
            <Download className="w-4 h-4" /> Tender Evidence Pack
          </Button>
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="shadow-lg shadow-primary/20 gap-2"><Plus className="w-4 h-4" /> Generate Report</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border sm:max-w-[500px]">
            <DialogHeader><DialogTitle>Generate Board Report</DialogTitle></DialogHeader>
            <div className="space-y-5 pt-2">
              {/* Period selector */}
              <div>
                <label className="text-sm font-medium mb-2 block">Report Period</label>
                <div className="flex gap-2 mb-3 flex-wrap">
                  {(["Q1","Q2","Q3","Q4","H1","H2","FY"] as PeriodPreset[]).map(p => (
                    <button
                      key={p}
                      onClick={() => setPreset(p)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        preset === p
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={year}
                    onChange={e => setYear(parseInt(e.target.value))}
                    className="flex h-9 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  >
                    {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <span className="text-sm text-muted-foreground flex-1">
                    {presetLabel(preset, fyStartMonth)}
                    {(() => { const { from, to } = presetDates(preset, year, fyStartMonth); return ` · ${format(from, "d MMM yyyy")} – ${format(to, "d MMM yyyy")}`; })()}
                  </span>
                </div>
              </div>

              {/* Report type */}
              <div>
                <label className="text-sm font-medium mb-2 block">Report Type</label>
                <select
                  value={reportType}
                  onChange={e => setReportType(e.target.value as ReportTypeKey)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                >
                  <option value="board_summary">Board Summary (1-pager + methodology)</option>
                  <option value="full_esg">Full ESG Detailed Report</option>
                  <option value="fleet_only">Fleet Emissions Only</option>
                </select>
              </div>

              {/* Title preview */}
              <div className="rounded-lg bg-secondary/40 border border-border px-3 py-2">
                <p className="text-xs text-muted-foreground mb-0.5">Report title</p>
                <p className="text-sm font-medium">{autoTitle}</p>
              </div>

              <Button className="w-full gap-2" onClick={handleGenerate} disabled={generate.isPending}>
                {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                Generate PDF
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* YoY chart */}
      <Card className="border-border/50 overflow-hidden">
        <div className="p-6 border-b border-border/50 bg-secondary/20 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-primary" />
              Year-on-Year Emissions Comparison
            </h3>
            <p className="text-muted-foreground text-sm mt-0.5">Monthly CO₂e in tonnes — fleet (Scope 1) + energy (Scope 2)</p>
          </div>
          {yoyAnnual && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground mb-1">Same-period YoY ({yoyAnnual.periodLabel})</p>
              <YoYBadge pct={yoyAnnual.pct} />
            </div>
          )}
        </div>
        <div className="p-4">
          {trendLoading ? (
            <div className="h-64 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : chartData.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No data yet — import fleet KMs and energy bills to see trends.</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} barGap={2} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} unit=" t" width={48} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number, name: string) => [`${v.toFixed(3)} tCO₂e`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                {chartYears.prev && (
                  <Bar dataKey={`${chartYears.prev} Fleet`}  stackId="prev" fill="#94a3b8" radius={[0,0,0,0]} />
                )}
                {chartYears.prev && (
                  <Bar dataKey={`${chartYears.prev} Energy`} stackId="prev" fill="#cbd5e1" radius={[3,3,0,0]} />
                )}
                {chartYears.cur && (
                  <Bar dataKey={`${chartYears.cur} Fleet`}  stackId="cur" fill="#16a34a" radius={[0,0,0,0]} />
                )}
                {chartYears.cur && (
                  <Bar dataKey={`${chartYears.cur} Energy`} stackId="cur" fill="#4ade80" radius={[3,3,0,0]} />
                )}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        {yoyAnnual && (
          <div className="px-6 pb-4 grid grid-cols-3 gap-4 text-center text-xs">
            <div className="rounded-lg bg-secondary/30 p-3">
              <p className="text-muted-foreground mb-1">{chartYears.prev} ({yoyAnnual.periodLabel})</p>
              <p className="font-bold text-foreground text-base">{(yoyAnnual.prevTotal / 1000).toFixed(2)} t</p>
            </div>
            <div className="rounded-lg bg-secondary/30 p-3">
              <p className="text-muted-foreground mb-1">{chartYears.cur} ({yoyAnnual.periodLabel})</p>
              <p className="font-bold text-foreground text-base">{(yoyAnnual.curTotal / 1000).toFixed(2)} t</p>
            </div>
            <div className="rounded-lg bg-secondary/30 p-3">
              <p className="text-muted-foreground mb-1">Same-period change</p>
              <p className={`font-bold text-base ${yoyAnnual.pct < 0 ? "text-emerald-400" : "text-red-400"}`}>
                {yoyAnnual.pct > 0 ? "+" : ""}{yoyAnnual.pct.toFixed(1)}%
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Report list */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Generated Reports</h2>
        {reports?.items.map((report) => (
          <Card key={report.id} className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4 bg-secondary/10 border-border/50 hover:bg-secondary/20 transition-colors">
            <div className="flex items-center gap-4 w-full sm:w-auto">
              <div className="p-3 bg-card rounded-lg border border-border shrink-0"><FileText className="w-5 h-5 text-primary" /></div>
              <div>
                <h4 className="font-semibold text-foreground">{report.title}</h4>
                <div className="flex items-center flex-wrap text-xs text-muted-foreground mt-1 gap-3">
                  <span className="flex items-center gap-1"><CalIcon className="w-3 h-3" /> {format(new Date(report.createdAt), "d MMM yyyy")}</span>
                  <span className="uppercase tracking-wider">{report.reportType.replace(/_/g, " ")}</span>
                  <span className={`px-2 py-0.5 rounded-full ${report.status === "ready" ? "bg-emerald-500/10 text-emerald-400" : report.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-400"}`}>
                    {report.status}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-2 w-full sm:w-auto justify-end">
              <Button variant="outline" size="sm" onClick={() => handleDownload(report.id, report.title)} disabled={report.status !== "ready"} className="gap-2">
                <Download className="w-4 h-4" /> Open PDF
              </Button>
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => handleDelete(report.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </Card>
        ))}
        {(!reports?.items || reports.items.length === 0) && (
          <div className="py-12 text-center text-muted-foreground border-2 border-dashed border-border rounded-xl">
            No reports generated yet. Use the button above to generate your first board report.
          </div>
        )}
      </div>
    </div>
  );
}
