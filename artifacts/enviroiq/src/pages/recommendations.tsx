import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Lightbulb, TrendingDown, Loader2, Car, Zap, Sun, Building2, Wrench,
  Plug, AlertCircle, ChevronRight, Target, ExternalLink, DollarSign,
  Clock, ArrowRight, ChevronDown, Award, CalendarDays, TrendingUp, Wallet,
  Info,
} from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

type Aggressiveness = "conservative" | "moderate" | "aggressive";

interface PlanYear {
  year: number;
  yearOffset: number;
  capexNzd: number;
  cumulativeCapexNzd: number;
  annualSavingNzdRunRate: number;
  cumulativeSavingNzd: number;
  annualCo2eReductionKg: number;
  residualCo2eKg: number;
  reductionPctOfBaseline: number;
  items: { id: string; title: string; category: string; capexNzd: number; annualCo2eSavingKg: number; annualCostSavingNzd: number }[];
}

interface RolloutPlan {
  aggressiveness: Aggressiveness;
  horizonYears: number;
  startYear: number;
  baselineCo2eKg: number;
  totalCapexNzd: number;
  matureAnnualSavingNzd: number;
  matureAnnualCo2eReductionKg: number;
  matureReductionPct: number;
  simplePaybackYears: number | null;
  years: PlanYear[];
  targetAlignment?: {
    targetYear: number;
    targetPctReduction: number;
    targetCo2eKg: number;
    planResidualInTargetYearKg: number;
    onTrack: boolean;
    shortfallKg: number;
  };
}

type RecCategory = "fleet" | "energy" | "solar" | "supplier" | "building" | "operations";
type RecPriority = "high" | "medium" | "low";
type RecEffort = "low" | "medium" | "high";

interface ScoredCandidate {
  name: string;
  type: "BEV" | "PHEV" | "HEV";
  nzPriceNzd: number;
  rangeKmEV: number;
  towKg: number;
  payloadKg: number;
  availability: "available" | "preorder" | "limited";
  warrantyYears: number;
  note: string;
  score: number;
  breakdown: { emissions: number; tco: number; suitability: number; availability: number };
  annualCo2eKg: number;
  annualCo2eSavingKg: number;
  annualRunningNzd: number;
  annualRunningSavingNzd: number;
  fiveYearTcoNzd: number;
  reasons: string[];
}

interface Recommendation {
  id: string;
  category: RecCategory;
  priority: RecPriority;
  scope: "1" | "2" | "3";
  title: string;
  rationale: string;
  action: string;
  annualCo2eSavingKg: number;
  annualCostSavingNzd?: number;
  estimatedCapexNzd?: number;
  paybackYears?: number;
  effort: RecEffort;
  related?: { vehicleId?: string; vehicleName?: string };
  links?: { label: string; href: string }[];
  vehicleScoring?: {
    segment: string;
    pick: string;
    candidates: ScoredCandidate[];
  };
}

interface RecommendationsResponse {
  generatedAt: string;
  aggressiveness: Aggressiveness;
  baseline: { totalCo2eKg: number; fleetCo2eKg: number; energyCo2eKg: number };
  totals: {
    count: number;
    annualCo2eSavingKg: number;
    annualCostSavingNzd: number;
    reductionPct: number;
  };
  targetGap: {
    targetYear: number;
    targetPctReduction: number;
    currentKg: number;
    targetKg: number;
    gapKg: number;
    yearsRemaining: number;
    requiredAnnualReductionKg: number;
    coveredByRecommendationsPct: number;
  } | null;
  plan: RolloutPlan;
  items: Recommendation[];
}

const AGGRESSIVENESS_META: Record<Aggressiveness, { label: string; sub: string; horizon: number; color: string }> = {
  conservative: { label: "Conservative", sub: "7-year roll-out · low capex first", horizon: 7, color: "border-sky-500 bg-sky-950/30 text-sky-200" },
  moderate:     { label: "Moderate",     sub: "5-year roll-out · best ROI first", horizon: 5, color: "border-emerald-500 bg-emerald-950/30 text-emerald-200" },
  aggressive:   { label: "Aggressive",   sub: "3-year roll-out · max impact first", horizon: 3, color: "border-amber-500 bg-amber-950/30 text-amber-200" },
};

const CATEGORY_META: Record<RecCategory, { label: string; icon: any; color: string; bg: string; border: string }> = {
  fleet:       { label: "Fleet",        icon: Car,        color: "text-blue-400",    bg: "bg-blue-900/15",    border: "border-blue-800/30" },
  energy:      { label: "Energy",       icon: Zap,        color: "text-yellow-400",  bg: "bg-yellow-900/15",  border: "border-yellow-800/30" },
  solar:       { label: "Solar",        icon: Sun,        color: "text-amber-400",   bg: "bg-amber-900/15",   border: "border-amber-800/30" },
  supplier:    { label: "Supplier",     icon: Plug,       color: "text-emerald-400", bg: "bg-emerald-900/15", border: "border-emerald-800/30" },
  building:    { label: "Building",     icon: Building2,  color: "text-violet-400",  bg: "bg-violet-900/15",  border: "border-violet-800/30" },
  operations:  { label: "Operations",   icon: Wrench,     color: "text-cyan-400",    bg: "bg-cyan-900/15",    border: "border-cyan-800/30" },
};

const PRIORITY_META: Record<RecPriority, { label: string; classes: string }> = {
  high:   { label: "High impact",   classes: "bg-rose-900/40 text-rose-300 border-rose-800/40" },
  medium: { label: "Medium impact", classes: "bg-amber-900/40 text-amber-300 border-amber-800/40" },
  low:    { label: "Quick win",     classes: "bg-sky-900/40 text-sky-300 border-sky-800/40" },
};

const EFFORT_META: Record<RecEffort, string> = {
  low:    "Low effort",
  medium: "Medium effort",
  high:   "Capital project",
};

function fmtKg(kg: number) {
  if (kg >= 1_000_000) return `${(kg / 1_000_000).toFixed(1)} t`;
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`;
  return `${Math.round(kg).toLocaleString()} kg`;
}

function fmtNzd(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

const ALL_CATEGORIES: ("all" | RecCategory)[] = [
  "all", "fleet", "energy", "solar", "supplier", "building", "operations",
];

// ── Vehicle scoring comparison table ────────────────────────────────────────
function VehicleScoringTable({ scoring }: { scoring: NonNullable<Recommendation["vehicleScoring"]> }) {
  const [open, setOpen] = useState(false);
  const candidates = scoring.candidates;

  return (
    <div className="mt-4 rounded-lg border border-border/40 bg-background/30">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-secondary/30 rounded-lg transition-colors"
      >
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Award className="w-3.5 h-3.5" />
          Why this pick? Compare {candidates.length} {scoring.segment.toLowerCase()} alternative{candidates.length === 1 ? "" : "s"}
        </span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 space-y-3">
          <div className="rounded-md border border-border/40 bg-secondary/20 p-3 space-y-2">
            <p className="text-[11px] text-muted-foreground">
              Each candidate is scored out of <span className="font-semibold text-foreground">100</span> against this vehicle's
              actual annual km and current fuel use. Top score wins.
            </p>
            <ul className="text-[11px] text-muted-foreground space-y-1.5 leading-relaxed">
              <li>
                <span className="font-semibold text-foreground">Emissions · /40</span> — share of this vehicle's CO₂e the
                replacement removes. Linear: a 50% cut scores 20, a 100% cut scores 40.
              </li>
              <li>
                <span className="font-semibold text-foreground">5-yr TCO · /30</span> — capex + 5 years of running cost vs
                continuing to fuel the existing vehicle. Cheaper than business-as-usual = full marks. 2.5× more expensive = 0.
              </li>
              <li>
                <span className="font-semibold text-foreground">Suitability · /20</span> — fit for this vehicle's actual job.
                Loses points for tow / payload shortfalls vs the segment median, and for BEV range that's tight for the typical
                daily km.
              </li>
              <li>
                <span className="font-semibold text-foreground">Availability · /10</span> — NZ supply right now. On lots = 10,
                preorder = 5, limited / special-order = 3.
              </li>
            </ul>
          </div>

          <div className="overflow-x-auto -mx-3 px-3">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/30">
                  <th className="py-2 pr-3 font-semibold">Vehicle</th>
                  <th className="py-2 px-2 font-semibold text-right">Score</th>
                  <th className="py-2 px-2 font-semibold text-right">
                    <HoverCard openDelay={150}>
                      <HoverCardTrigger asChild>
                        <span className="inline-flex items-center gap-1 cursor-help">
                          Em · TCO · Fit · Avail
                          <Info className="w-3 h-3 text-muted-foreground/70" />
                        </span>
                      </HoverCardTrigger>
                      <HoverCardContent side="top" className="w-72 text-xs leading-relaxed">
                        <p className="font-semibold mb-2">Score breakdown</p>
                        <ul className="space-y-1.5 text-muted-foreground">
                          <li><span className="font-medium text-foreground">Em /40</span> — % CO₂e cut vs current vehicle</li>
                          <li><span className="font-medium text-foreground">TCO /30</span> — 5-yr cost vs business-as-usual</li>
                          <li><span className="font-medium text-foreground">Fit /20</span> — tow / payload / EV range fit</li>
                          <li><span className="font-medium text-foreground">Avail /10</span> — NZ supply now</li>
                        </ul>
                        <p className="mt-2 text-[10px] text-muted-foreground/80">Sum of all four = total score out of 100.</p>
                      </HoverCardContent>
                    </HoverCard>
                  </th>
                  <th className="py-2 px-2 font-semibold text-right">CO₂e saved /yr</th>
                  <th className="py-2 px-2 font-semibold text-right">5-yr TCO</th>
                  <th className="py-2 px-2 font-semibold text-right">Capex</th>
                  <th className="py-2 pl-2 font-semibold">Capability</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c, i) => {
                  const isTop = i === 0;
                  return (
                    <tr key={c.name} className={`border-b border-border/20 last:border-0 ${isTop ? "bg-emerald-950/15" : ""}`}>
                      <td className="py-2.5 pr-3">
                        <div className="flex items-start gap-2">
                          {isTop && <Award className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />}
                          <div className="min-w-0">
                            <p className={`font-medium leading-tight ${isTop ? "text-foreground" : "text-muted-foreground"}`}>
                              {c.name}
                            </p>
                            <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                              {c.type}
                              {c.rangeKmEV > 0 && ` · ${c.rangeKmEV} km EV`}
                              {c.availability !== "available" && ` · ${c.availability}`}
                              {` · ${c.warrantyYears}yr warranty`}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className={`py-2.5 px-2 text-right tabular-nums font-bold ${isTop ? "text-emerald-300" : "text-foreground"}`}>
                        {c.score}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums text-[11px] text-muted-foreground">
                        <HoverCard openDelay={200}>
                          <HoverCardTrigger asChild>
                            <span className="cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2">
                              {c.breakdown.emissions} · {c.breakdown.tco} · {c.breakdown.suitability} · {c.breakdown.availability}
                            </span>
                          </HoverCardTrigger>
                          <HoverCardContent side="left" className="w-64 text-xs leading-relaxed">
                            <p className="font-semibold mb-2">{c.name}</p>
                            <ul className="space-y-1 text-muted-foreground">
                              <li className="flex justify-between"><span>Emissions</span><span className="tabular-nums text-foreground">{c.breakdown.emissions} / 40</span></li>
                              <li className="flex justify-between"><span>5-yr TCO</span><span className="tabular-nums text-foreground">{c.breakdown.tco} / 30</span></li>
                              <li className="flex justify-between"><span>Suitability</span><span className="tabular-nums text-foreground">{c.breakdown.suitability} / 20</span></li>
                              <li className="flex justify-between"><span>Availability</span><span className="tabular-nums text-foreground">{c.breakdown.availability} / 10</span></li>
                              <li className="flex justify-between border-t border-border/40 pt-1 mt-1"><span className="font-medium text-foreground">Total</span><span className="tabular-nums font-semibold text-foreground">{c.score} / 100</span></li>
                            </ul>
                          </HoverCardContent>
                        </HoverCard>
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums text-emerald-300/90">
                        {c.annualCo2eSavingKg >= 1000 ? `${(c.annualCo2eSavingKg / 1000).toFixed(1)} t` : `${c.annualCo2eSavingKg} kg`}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums text-foreground">
                        ${(c.fiveYearTcoNzd / 1000).toFixed(0)}k
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums text-muted-foreground">
                        ${(c.nzPriceNzd / 1000).toFixed(0)}k
                      </td>
                      <td className="py-2.5 pl-2 text-[11px] text-muted-foreground">
                        {c.towKg > 0 ? `${(c.towKg / 1000).toFixed(c.towKg >= 1000 ? 1 : 2)}T tow` : "no tow"}
                        {` · ${c.payloadKg}kg payload`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="text-[11px] text-muted-foreground leading-relaxed border-t border-border/30 pt-2">
            <span className="font-semibold text-foreground">Top pick:</span> {candidates[0].note}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Recommendations() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const [filter, setFilter] = useState<"all" | RecCategory>("all");
  const [aggressiveness, setAggressiveness] = useState<Aggressiveness>("moderate");

  const { data, isLoading, error } = useQuery<RecommendationsResponse>({
    queryKey: ["recommendations", orgId, aggressiveness],
    enabled: !!orgId,
    queryFn: async () => {
      const res = await fetch(
        `/api/organisations/${orgId}/recommendations?aggressiveness=${aggressiveness}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to fetch recommendations");
      return res.json();
    },
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    return filter === "all" ? data.items : data.items.filter(r => r.category === filter);
  }, [data, filter]);

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: data?.items.length ?? 0 };
    for (const c of ALL_CATEGORIES) if (c !== "all") m[c] = 0;
    for (const r of data?.items ?? []) m[r.category] = (m[r.category] ?? 0) + 1;
    return m;
  }, [data]);

  return (
    <div className="space-y-8 pb-10">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Lightbulb className="w-7 h-7 text-amber-400" />
            Recommendations
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Concrete, ranked actions to cut your emissions — with real NZ alternatives,
            quantified savings, and payback estimates. Generated from your live fleet, energy, and target data.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : error ? (
        <Card className="p-12 border-destructive/30 text-center">
          <AlertCircle className="w-10 h-10 mx-auto text-destructive mb-3" />
          <p className="text-foreground font-medium">Couldn't load recommendations</p>
          <p className="text-muted-foreground text-sm mt-1">Try refreshing the page in a moment.</p>
        </Card>
      ) : !data || data.items.length === 0 ? (
        <Card className="p-12 border-border/50 text-center">
          <Lightbulb className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
          <h3 className="font-semibold text-lg mb-1">No recommendations yet</h3>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            Add some fleet vehicles or energy readings and we'll surface concrete next steps —
            specific vehicle alternatives, right-sized solar, supplier switches, and more.
          </p>
          <div className="flex justify-center gap-2 mt-5">
            <Button asChild variant="outline" size="sm"><Link href="/fleet"><Car className="w-3.5 h-3.5 mr-1.5" />Add fleet</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/energy"><Zap className="w-3.5 h-3.5 mr-1.5" />Add energy</Link></Button>
          </div>
        </Card>
      ) : (
        <>
          {/* ── Headline summary ─────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="p-5 border-border/50 bg-gradient-to-br from-emerald-950/30 to-transparent">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Potential annual saving</p>
              <p className="text-3xl font-bold tabular-nums text-emerald-300 mt-1">{fmtKg(data.totals.annualCo2eSavingKg)} CO₂e</p>
              <p className="text-xs text-muted-foreground mt-1">
                <TrendingDown className="w-3 h-3 inline mr-0.5" />
                {data.totals.reductionPct}% of your current footprint
              </p>
            </Card>
            <Card className="p-5 border-border/50">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Annual cost saving</p>
              <p className="text-3xl font-bold tabular-nums text-foreground mt-1">{fmtNzd(data.totals.annualCostSavingNzd)}</p>
              <p className="text-xs text-muted-foreground mt-1">If all recommendations adopted</p>
            </Card>
            <Card className="p-5 border-border/50">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Recommendations</p>
              <p className="text-3xl font-bold tabular-nums text-foreground mt-1">{data.totals.count}</p>
              <p className="text-xs text-muted-foreground mt-1">Across fleet, energy, solar, ops</p>
            </Card>
            <Card className="p-5 border-border/50">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Current footprint (12M)</p>
              <p className="text-3xl font-bold tabular-nums text-foreground mt-1">{fmtKg(data.baseline.totalCo2eKg)}</p>
              <p className="text-xs text-muted-foreground mt-1">Fleet {fmtKg(data.baseline.fleetCo2eKg)} · Energy {fmtKg(data.baseline.energyCo2eKg)}</p>
            </Card>
          </div>

          {/* ── Target gap callout ──────────────────────────────────────── */}
          {data.targetGap && (
            <Card className="p-5 border-primary/30 bg-primary/5">
              <div className="flex flex-col md:flex-row md:items-center gap-4">
                <Target className="w-8 h-8 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground">
                    Your target: <span className="text-primary">↓{data.targetGap.targetPctReduction}% by {data.targetGap.targetYear}</span>
                    {" "}({data.targetGap.yearsRemaining} {data.targetGap.yearsRemaining === 1 ? "year" : "years"} left)
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    To hit it you need to cut <span className="font-semibold text-foreground">{fmtKg(data.targetGap.gapKg)}</span> CO₂e —
                    these recommendations cover{" "}
                    <span className={`font-semibold ${data.targetGap.coveredByRecommendationsPct >= 100 ? "text-emerald-400" : data.targetGap.coveredByRecommendationsPct >= 70 ? "text-amber-400" : "text-rose-400"}`}>
                      {data.targetGap.coveredByRecommendationsPct}%
                    </span> of that gap.
                  </p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href="/targets">View target <ChevronRight className="w-3.5 h-3.5 ml-1" /></Link>
                </Button>
              </div>
              {/* Coverage bar */}
              <div className="mt-4 w-full bg-secondary/40 rounded-full h-2.5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    data.targetGap.coveredByRecommendationsPct >= 100
                      ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                      : data.targetGap.coveredByRecommendationsPct >= 70
                      ? "bg-gradient-to-r from-amber-500 to-amber-400"
                      : "bg-gradient-to-r from-rose-500 to-rose-400"
                  }`}
                  style={{ width: `${Math.min(100, data.targetGap.coveredByRecommendationsPct)}%` }}
                />
              </div>
            </Card>
          )}

          {/* ── Multi-year roll-out plan ────────────────────────────────── */}
          {data.plan && data.plan.years.length > 0 && (
            <Card className="p-5 border-border/50 bg-gradient-to-br from-secondary/20 to-transparent">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-5">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <CalendarDays className="w-5 h-5 text-primary" />
                    Year-by-year roll-out plan
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                    Choose how aggressively to schedule these recommendations. Capex hits in the install year;
                    savings accrue from then on. Cumulative columns show total spend and CO₂e progress to date.
                  </p>
                </div>

                {/* Aggressiveness selector */}
                <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                  {(["conservative", "moderate", "aggressive"] as Aggressiveness[]).map(level => {
                    const meta = AGGRESSIVENESS_META[level];
                    const active = aggressiveness === level;
                    return (
                      <button
                        key={level}
                        onClick={() => setAggressiveness(level)}
                        className={`text-left px-3 py-2 rounded-lg border-2 transition-all ${
                          active
                            ? meta.color
                            : "border-border/40 bg-card text-muted-foreground hover:border-border hover:text-foreground"
                        }`}
                      >
                        <p className="text-xs font-bold uppercase tracking-wider">{meta.label}</p>
                        <p className="text-[10px] mt-0.5 opacity-90">{meta.sub}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Plan totals strip */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-2.5">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1">
                    <Wallet className="w-3 h-3" /> Total capex ({data.plan.horizonYears}-yr plan)
                  </p>
                  <p className="text-xl font-bold tabular-nums text-foreground mt-0.5">{fmtNzd(data.plan.totalCapexNzd)}</p>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-2.5">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1">
                    <DollarSign className="w-3 h-3" /> Mature annual saving
                  </p>
                  <p className="text-xl font-bold tabular-nums text-foreground mt-0.5">{fmtNzd(data.plan.matureAnnualSavingNzd)}</p>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-2.5">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1">
                    <TrendingDown className="w-3 h-3" /> Mature CO₂e cut
                  </p>
                  <p className="text-xl font-bold tabular-nums text-emerald-300 mt-0.5">
                    {fmtKg(data.plan.matureAnnualCo2eReductionKg)}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{data.plan.matureReductionPct}% of baseline</p>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-2.5">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Simple payback
                  </p>
                  <p className="text-xl font-bold tabular-nums text-foreground mt-0.5">
                    {data.plan.simplePaybackYears != null ? `${data.plan.simplePaybackYears} yr` : "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Capex ÷ mature savings</p>
                </div>
              </div>

              {/* Target alignment */}
              {data.plan.targetAlignment && (
                <div className={`rounded-lg border px-3 py-2.5 mb-5 ${
                  data.plan.targetAlignment.onTrack
                    ? "border-emerald-700/40 bg-emerald-950/20"
                    : "border-rose-800/40 bg-rose-950/20"
                }`}>
                  <p className="text-sm">
                    <span className="font-semibold text-foreground">
                      {data.plan.targetAlignment.onTrack ? "On track" : "Falls short"}
                    </span>
                    <span className="text-muted-foreground"> of your ↓{data.plan.targetAlignment.targetPctReduction}% by {data.plan.targetAlignment.targetYear} target.</span>
                    <span className="text-muted-foreground">
                      {" "}This plan reaches <span className="font-semibold text-foreground">{fmtKg(data.plan.targetAlignment.planResidualInTargetYearKg)}</span> by {data.plan.targetAlignment.targetYear} vs target of {fmtKg(data.plan.targetAlignment.targetCo2eKg)}.
                    </span>
                    {!data.plan.targetAlignment.onTrack && (
                      <span className="text-rose-300"> Shortfall: {fmtKg(data.plan.targetAlignment.shortfallKg)}.</span>
                    )}
                  </p>
                </div>
              )}

              {/* Year-by-year table */}
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/30">
                      <th className="py-2 pr-3 font-semibold">Year</th>
                      <th className="py-2 px-2 font-semibold text-right">Items installed</th>
                      <th className="py-2 px-2 font-semibold text-right">Capex this yr</th>
                      <th className="py-2 px-2 font-semibold text-right">Cumulative capex</th>
                      <th className="py-2 px-2 font-semibold text-right">Annual saving (run-rate)</th>
                      <th className="py-2 px-2 font-semibold text-right">Cumulative cash saved</th>
                      <th className="py-2 px-2 font-semibold text-right">CO₂e cut (annual)</th>
                      <th className="py-2 pl-2 font-semibold text-right">Residual / % cut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.plan.years.map(y => {
                      const isInstallYear = y.items.length > 0;
                      return (
                        <tr key={y.year} className="border-b border-border/20 last:border-0 align-top">
                          <td className="py-3 pr-3">
                            <p className="font-bold tabular-nums text-foreground">{y.year}</p>
                            <p className="text-[10px] text-muted-foreground">Y{y.yearOffset + 1}</p>
                          </td>
                          <td className="py-3 px-2 text-right">
                            {isInstallYear ? (
                              <details className="text-right">
                                <summary className="cursor-pointer tabular-nums text-foreground hover:text-primary">
                                  {y.items.length} {y.items.length === 1 ? "item" : "items"}
                                </summary>
                                <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground text-left list-disc list-inside marker:text-muted-foreground/40">
                                  {y.items.map(it => (
                                    <li key={it.id} className="leading-snug">{it.title}</li>
                                  ))}
                                </ul>
                              </details>
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </td>
                          <td className="py-3 px-2 text-right tabular-nums text-foreground">
                            {y.capexNzd > 0 ? fmtNzd(y.capexNzd) : <span className="text-muted-foreground/50">—</span>}
                          </td>
                          <td className="py-3 px-2 text-right tabular-nums text-muted-foreground">
                            {fmtNzd(y.cumulativeCapexNzd)}
                          </td>
                          <td className="py-3 px-2 text-right tabular-nums text-foreground">
                            {y.annualSavingNzdRunRate > 0 ? fmtNzd(y.annualSavingNzdRunRate) : <span className="text-muted-foreground/50">—</span>}
                          </td>
                          <td className="py-3 px-2 text-right tabular-nums text-emerald-300/90">
                            {fmtNzd(y.cumulativeSavingNzd)}
                          </td>
                          <td className="py-3 px-2 text-right tabular-nums text-emerald-300/90">
                            {fmtKg(y.annualCo2eReductionKg)}
                          </td>
                          <td className="py-3 pl-2 text-right">
                            <p className="tabular-nums text-foreground font-medium">{fmtKg(y.residualCo2eKg)}</p>
                            <p className="text-[10px] text-muted-foreground tabular-nums">↓{y.reductionPctOfBaseline}%</p>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border/40 bg-secondary/20">
                      <td className="py-2.5 pr-3 text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Total</td>
                      <td className="py-2.5 px-2 text-right tabular-nums text-foreground font-semibold">{data.totals.count}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums text-foreground font-bold">{fmtNzd(data.plan.totalCapexNzd)}</td>
                      <td className="py-2.5 px-2"></td>
                      <td className="py-2.5 px-2 text-right tabular-nums text-foreground font-semibold">{fmtNzd(data.plan.matureAnnualSavingNzd)}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums text-emerald-300 font-bold">
                        {fmtNzd(data.plan.years[data.plan.years.length - 1]?.cumulativeSavingNzd ?? 0)}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums text-emerald-300 font-bold">
                        {fmtKg(data.plan.matureAnnualCo2eReductionKg)}
                      </td>
                      <td className="py-2.5 pl-2 text-right tabular-nums text-emerald-300 font-bold">
                        {data.plan.matureReductionPct}%
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
                <TrendingUp className="w-3 h-3 inline mr-0.5" />
                "Run-rate" = annualised saving once installed measures have been operating a full year. Cumulative cash saved
                assumes savings start the year of install. Capex figures are NZ market estimates — validate with quotes.
              </p>
            </Card>
          )}

          {/* ── Category filter chips ───────────────────────────────────── */}
          <div className="flex flex-wrap gap-2">
            {ALL_CATEGORIES.map(c => {
              const active = filter === c;
              const meta = c === "all" ? null : CATEGORY_META[c];
              const Icon = meta?.icon;
              return (
                <button
                  key={c}
                  onClick={() => setFilter(c)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  }`}
                >
                  {Icon && <Icon className="w-3.5 h-3.5" />}
                  <span className="capitalize">{c === "all" ? "All" : meta!.label}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${active ? "bg-primary-foreground/20" : "bg-secondary/60"}`}>
                    {counts[c]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ── Recommendation cards ────────────────────────────────────── */}
          <div className="space-y-3">
            {filtered.map(r => {
              const cat = CATEGORY_META[r.category];
              const CatIcon = cat.icon;
              const prio = PRIORITY_META[r.priority];
              return (
                <Card key={r.id} className={`p-5 border ${cat.border} ${cat.bg}`}>
                  <div className="flex flex-col md:flex-row gap-5">
                    {/* Icon column */}
                    <div className="shrink-0 flex md:flex-col items-start gap-3">
                      <div className={`w-12 h-12 rounded-xl ${cat.bg} border ${cat.border} flex items-center justify-center`}>
                        <CatIcon className={`w-6 h-6 ${cat.color}`} />
                      </div>
                    </div>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-start gap-2 mb-1.5">
                        <h3 className="font-semibold text-foreground text-base leading-snug">{r.title}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${prio.classes}`}>
                          {prio.label}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-secondary/60 border border-border/40 text-muted-foreground">
                          Scope {r.scope}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-secondary/60 border border-border/40 text-muted-foreground">
                          {EFFORT_META[r.effort]}
                        </span>
                      </div>

                      <p className="text-sm text-muted-foreground leading-relaxed">{r.rationale}</p>

                      <div className="mt-3 rounded-lg bg-background/40 border border-border/40 px-3 py-2.5">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1 flex items-center gap-1.5">
                          <ArrowRight className="w-3 h-3" /> What to do
                        </p>
                        <p className="text-sm text-foreground">{r.action}</p>
                      </div>

                      {/* Metrics row */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">CO₂e saved /yr</p>
                          <p className="text-lg font-bold tabular-nums text-emerald-300">{fmtKg(r.annualCo2eSavingKg)}</p>
                        </div>
                        {r.annualCostSavingNzd != null && r.annualCostSavingNzd > 0 && (
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1"><DollarSign className="w-2.5 h-2.5" />Cost saving /yr</p>
                            <p className="text-lg font-bold tabular-nums text-foreground">{fmtNzd(r.annualCostSavingNzd)}</p>
                          </div>
                        )}
                        {r.estimatedCapexNzd != null && (
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Capex</p>
                            <p className="text-lg font-bold tabular-nums text-foreground">{fmtNzd(r.estimatedCapexNzd)}</p>
                          </div>
                        )}
                        {r.paybackYears != null && r.paybackYears > 0 && (
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1"><Clock className="w-2.5 h-2.5" />Payback</p>
                            <p className="text-lg font-bold tabular-nums text-foreground">{r.paybackYears} yr</p>
                          </div>
                        )}
                      </div>

                      {/* Vehicle scoring breakdown (fleet-swap recs only) */}
                      {r.vehicleScoring && <VehicleScoringTable scoring={r.vehicleScoring} />}

                      {/* Links */}
                      {r.links && r.links.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-4">
                          {r.links.map((l, i) => {
                            const isExternal = l.href.startsWith("http");
                            return isExternal ? (
                              <a
                                key={i}
                                href={l.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              >
                                {l.label} <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              <Link key={i} href={l.href} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                                {l.label} <ChevronRight className="w-3 h-3" />
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
            {filtered.length === 0 && (
              <Card className="p-8 border-border/50 text-center text-sm text-muted-foreground">
                No recommendations in this category right now.
              </Card>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground text-center pt-2">
            Generated {new Date(data.generatedAt).toLocaleString()} · Costs and payback are NZ market estimates
            (NZ MfE 2024 emission factors, SEANZ solar benchmarks, retail energy tariffs). Always validate with quotes.
          </p>
        </>
      )}
    </div>
  );
}
