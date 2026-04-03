import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiClient } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sparkles, Leaf, Zap, Car, ShieldCheck, FileText, Award,
  TrendingDown, AlertCircle, CheckCircle, Clock, ArrowRight,
  Send, Loader2, RefreshCw, Info, ExternalLink, CalendarClock,
  ChevronDown, ChevronUp, BookOpen
} from "lucide-react";

const categoryIcon: Record<string, React.ComponentType<{ className?: string }>> = {
  fleet: Car,
  energy: Zap,
  governance: ShieldCheck,
  certification: Award,
  reporting: FileText,
  policy: BookOpen,
};

const categoryColor: Record<string, string> = {
  fleet: "bg-emerald-50 border-emerald-200 text-emerald-800",
  energy: "bg-blue-50 border-blue-200 text-blue-800",
  governance: "bg-purple-50 border-purple-200 text-purple-800",
  certification: "bg-amber-50 border-amber-200 text-amber-800",
  reporting: "bg-slate-50 border-slate-200 text-slate-700",
  policy: "bg-indigo-50 border-indigo-200 text-indigo-800",
};

const impactDot: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-emerald-500",
};

const effortLabel: Record<string, string> = {
  quick_win: "Quick Win",
  medium_term: "Medium-term",
  strategic: "Strategic",
};

const statusBadge: Record<string, { label: string; color: string }> = {
  required: { label: "Required", color: "bg-red-100 text-red-700 border-red-200" },
  recommended: { label: "Recommended", color: "bg-amber-100 text-amber-700 border-amber-200" },
  not_applicable: { label: "Not Applicable", color: "bg-slate-100 text-slate-500 border-slate-200" },
  achieved: { label: "Achieved ✓", color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
};

const urgencyIcon: Record<string, React.ComponentType<{ className?: string }>> = {
  immediate: AlertCircle,
  this_year: Clock,
  monitor: Info,
};

interface AdvisorData {
  summary?: string;
  complianceItems?: Array<{
    title: string;
    description: string;
    status: string;
    urgency: string;
    link?: string;
  }>;
  insights?: Array<{
    category: string;
    title: string;
    body: string;
    impact: string;
    effort: string;
    saving_co2e_kg?: number | null;
    saving_nzd?: number | null;
  }>;
  certificationPath?: {
    currentLevel: string;
    nextStep: string;
    readinessScore: number;
    gapsToAddress: string[];
  };
  etsCarbonCost?: {
    estimatedAnnualNZD: number;
    explanation: string;
  };
  timeline?: Array<{
    date: string;
    event: string;
    relevantToOrg: boolean;
  }>;
}

function InsightCard({ insight }: { insight: NonNullable<AdvisorData["insights"]>[0] }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = categoryIcon[insight.category] ?? Leaf;
  const colorClass = categoryColor[insight.category] ?? categoryColor.policy;

  return (
    <Card className="p-5 border-border hover:border-primary/30 transition-all hover:shadow-sm">
      <div className="flex items-start gap-4">
        <div className={`p-2.5 rounded-xl border shrink-0 ${colorClass}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-2">
            <h4 className="font-semibold text-foreground text-sm leading-snug">{insight.title}</h4>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${impactDot[insight.impact] ?? "bg-slate-400"}`} title={`${insight.impact} impact`} />
              <span className="text-xs text-muted-foreground whitespace-nowrap">{effortLabel[insight.effort]}</span>
            </div>
          </div>
          <p className={`text-sm text-muted-foreground leading-relaxed ${!expanded ? "line-clamp-2" : ""}`}>
            {insight.body}
          </p>
          {insight.body.length > 120 && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-xs text-primary mt-1 flex items-center gap-1 hover:underline"
            >
              {expanded ? <><ChevronUp className="w-3 h-3" /> Less</> : <><ChevronDown className="w-3 h-3" /> Read more</>}
            </button>
          )}
          {(insight.saving_co2e_kg || insight.saving_nzd) && (
            <div className="flex flex-wrap gap-2 mt-3">
              {insight.saving_co2e_kg && (
                <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-medium">
                  <TrendingDown className="w-3 h-3" />
                  {insight.saving_co2e_kg >= 1000
                    ? `−${(insight.saving_co2e_kg / 1000).toFixed(1)} tCO₂e`
                    : `−${insight.saving_co2e_kg} kgCO₂e`}
                </span>
              )}
              {insight.saving_nzd && (
                <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 font-medium">
                  NZ${insight.saving_nzd.toLocaleString()} potential saving
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function AdvisorPage() {
  const { session } = useAuth();
  const orgId = session?.orgId;
  const [question, setQuestion] = useState("");
  const [conversation, setConversation] = useState<Array<{ q: string; a: string }>>([]);
  const [activeFilter, setActiveFilter] = useState<string>("all");

  const { data: insightsData, isLoading, error, refetch, isFetching } = useQuery<{
    data: AdvisorData;
    orgContext: { name: string; totals: Record<string, number | boolean> };
  }>({
    queryKey: [`/api/organisations/${orgId}/advisor/insights`],
    queryFn: () => apiClient(`/api/organisations/${orgId}/advisor/insights`),
    enabled: !!orgId,
    staleTime: 10 * 60 * 1000,
  });

  const askMutation = useMutation({
    mutationFn: (q: string) =>
      apiClient(`/api/organisations/${orgId}/advisor/ask`, {
        method: "POST",
        body: JSON.stringify({ question: q }),
      }) as Promise<{ answer: string }>,
    onSuccess: (res) => {
      setConversation(prev => [...prev, { q: question, a: res.answer }]);
      setQuestion("");
    },
  });

  const advisor = insightsData?.data;
  const totals = insightsData?.orgContext?.totals;

  const filteredInsights = advisor?.insights?.filter(
    i => activeFilter === "all" || i.category === activeFilter
  ) ?? [];

  const categories = [...new Set(advisor?.insights?.map(i => i.category) ?? [])];

  return (
    <div className="space-y-8 pb-12">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight text-foreground">AI ESG Advisor</h1>
          </div>
          <p className="text-muted-foreground">
            Grounded in NZ's Second Emissions Reduction Plan (ERP2), MfE guidance, and your live data.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-2 shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh insights
        </Button>
      </div>

      {/* ── Policy banner ────────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-gradient-to-r from-primary/8 to-emerald-500/5 border border-primary/20 px-6 py-4 flex flex-wrap items-center gap-6">
        {[
          { label: "Emissions Budget 2", value: "2026–2030 ACTIVE", color: "text-primary" },
          { label: "NZ 2050 Target", value: "Net Zero (non-methane)", color: "text-foreground" },
          { label: "NZ Carbon Price", value: "~$40–46/t CO₂e (2026)", color: "text-foreground" },
          { label: "NZ Grid (2025)", value: "55 gCO₂/kWh", color: "text-foreground" },
          { label: "Toitū carbonreduce", value: "ISO 14065 accredited", color: "text-foreground" },
        ].map((item, i) => (
          <div key={i} className="text-sm">
            <span className="text-muted-foreground text-xs uppercase tracking-wide font-medium">{item.label}</span>
            <p className={`font-semibold ${item.color}`}>{item.value}</p>
          </div>
        ))}
      </div>

      {error && (
        <Card className="p-6 border-red-200 bg-red-50">
          <div className="flex items-center gap-3 text-red-700">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <div>
              <p className="font-semibold">Could not generate insights</p>
              <p className="text-sm text-red-600 mt-1">Ensure you have emissions data entered, then try refreshing.</p>
            </div>
          </div>
        </Card>
      )}

      {/* ── AI Summary ───────────────────────────────────────────────────────── */}
      {isLoading ? (
        <Card className="p-6 space-y-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </Card>
      ) : advisor?.summary && (
        <Card className="p-6 border-primary/20 bg-primary/3">
          <div className="flex gap-3">
            <div className="p-2 rounded-xl bg-primary/10 shrink-0 h-fit">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground mb-2">ESG Position Summary</h2>
              <p className="text-muted-foreground leading-relaxed">{advisor.summary}</p>
              {totals && (
                <div className="flex flex-wrap gap-4 mt-4">
                  <div className="text-sm">
                    <span className="text-muted-foreground">Scope 1 (Fleet)</span>
                    <p className="font-bold text-foreground">
                      {(totals.fleetCo2eKg as number) >= 1000
                        ? `${((totals.fleetCo2eKg as number) / 1000).toFixed(2)} t`
                        : `${totals.fleetCo2eKg} kg`} CO₂e
                    </p>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Scope 2 (Energy)</span>
                    <p className="font-bold text-foreground">
                      {(totals.energyCo2eKg as number) >= 1000
                        ? `${((totals.energyCo2eKg as number) / 1000).toFixed(2)} t`
                        : `${totals.energyCo2eKg} kg`} CO₂e
                    </p>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Fleet electrification</span>
                    <p className="font-bold text-foreground">{totals.evFleetPct as number}% EV</p>
                  </div>
                  {(totals.estimatedETSCarbonCostNZD as number) > 0 && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Est. ETS carbon cost</span>
                      <p className="font-bold text-foreground">NZ${(totals.estimatedETSCarbonCostNZD as number).toLocaleString()}/yr</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-8">
        {/* ── Left column: Insights + Ask ───────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Insights */}
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <h2 className="text-lg font-semibold text-foreground mr-2">AI Insights</h2>
              <button
                onClick={() => setActiveFilter("all")}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${activeFilter === "all" ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}
              >
                All
              </button>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveFilter(cat)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border capitalize transition-colors ${activeFilter === cat ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {isLoading ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <Card key={i} className="p-5">
                    <div className="flex gap-4">
                      <Skeleton className="w-9 h-9 rounded-xl shrink-0" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-2/3" />
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            ) : filteredInsights.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                <Sparkles className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No insights for this category yet.</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {filteredInsights.map((insight, i) => (
                  <InsightCard key={i} insight={insight} />
                ))}
              </div>
            )}
          </div>

          {/* Ask the Advisor */}
          <Card className="p-6 border-primary/20">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <h2 className="font-semibold text-foreground">Ask the NZ ESG Advisor</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Ask about NZ climate policy, your ETS obligations, the Toitū certification pathway, ERP2 sector actions, or what you should prioritise next.
            </p>

            {/* Conversation history */}
            {conversation.length > 0 && (
              <div className="space-y-4 mb-4 max-h-80 overflow-y-auto">
                {conversation.map((entry, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex justify-end">
                      <div className="bg-primary text-white rounded-2xl rounded-tr-sm px-4 py-2 text-sm max-w-[85%]">
                        {entry.q}
                      </div>
                    </div>
                    <div className="flex justify-start">
                      <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 text-sm max-w-[90%] text-foreground leading-relaxed whitespace-pre-wrap">
                        {entry.a}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Suggested questions */}
            {conversation.length === 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {[
                  "Do we need to comply with XRB climate disclosures?",
                  "What's our estimated ETS carbon cost?",
                  "How do we get Toitū carbonreduce certified?",
                  "What does ERP2 mean for our fleet?",
                  "How can we reduce our Scope 2 to zero?",
                ].map((q, i) => (
                  <button
                    key={i}
                    onClick={() => setQuestion(q)}
                    className="text-xs px-3 py-1.5 rounded-full border border-border hover:border-primary/50 hover:bg-primary/5 text-muted-foreground hover:text-foreground transition-colors text-left"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Textarea
                placeholder="Ask anything about NZ ESG, climate policy, your obligations..."
                value={question}
                onChange={e => setQuestion(e.target.value)}
                className="resize-none text-sm"
                rows={2}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey && question.trim()) {
                    e.preventDefault();
                    askMutation.mutate(question.trim());
                  }
                }}
              />
              <Button
                onClick={() => question.trim() && askMutation.mutate(question.trim())}
                disabled={!question.trim() || askMutation.isPending}
                className="shrink-0 self-end"
                size="sm"
              >
                {askMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </Card>
        </div>

        {/* ── Right column: Compliance + Cert + Timeline ───────────────────── */}
        <div className="space-y-5">

          {/* Compliance Radar */}
          <Card className="p-5">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              NZ Compliance Radar
            </h3>
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
              </div>
            ) : advisor?.complianceItems?.length ? (
              <div className="space-y-3">
                {advisor.complianceItems.map((item, i) => {
                  const UrgencyIcon = urgencyIcon[item.urgency] ?? Info;
                  const badge = statusBadge[item.status] ?? statusBadge.monitor;
                  return (
                    <div key={i} className="rounded-xl border border-border p-3 bg-background hover:bg-muted/30 transition-colors">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-sm font-medium text-foreground leading-snug">{item.title}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 ${badge.color}`}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{item.description}</p>
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <UrgencyIcon className="w-3 h-3" />
                          <span className="capitalize">{item.urgency?.replace("_", " ")}</span>
                        </div>
                        {item.link && (
                          <a
                            href={item.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary flex items-center gap-1 hover:underline"
                          >
                            MfE <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Generating compliance assessment…</p>
            )}
          </Card>

          {/* Toitū Certification Path */}
          {(isLoading || advisor?.certificationPath) && (
            <Card className="p-5">
              <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-500" />
                Toitū Certification Pathway
              </h3>
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-20 w-full rounded-xl" />
                </div>
              ) : advisor?.certificationPath && (
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-muted-foreground">Certification readiness</span>
                      <span className="text-sm font-bold text-foreground">{advisor.certificationPath.readinessScore}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-500 transition-all"
                        style={{ width: `${advisor.certificationPath.readinessScore}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex gap-3 items-center">
                    {["none", "carbonreduce", "carbonzero"].map((level, i) => {
                      const current = advisor.certificationPath!.currentLevel;
                      const labels = ["No cert", "carbonreduce", "net carbonzero"];
                      const isActive = current === level;
                      const isPast = ["none", "carbonreduce", "carbonzero"].indexOf(current) > i;
                      return (
                        <div key={level} className="flex-1 text-center">
                          <div className={`rounded-lg border p-2 text-xs font-medium mb-1 ${isActive ? "border-amber-400 bg-amber-50 text-amber-700" : isPast ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-border text-muted-foreground"}`}>
                            {isActive && <CheckCircle className="w-3 h-3 mx-auto mb-0.5" />}
                            {labels[i]}
                          </div>
                          {i < 2 && <ArrowRight className="w-3 h-3 text-muted-foreground mx-auto" />}
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
                    <p className="text-xs font-semibold text-amber-700 mb-1">Next step</p>
                    <p className="text-xs text-amber-600 leading-relaxed">{advisor.certificationPath.nextStep}</p>
                  </div>

                  {advisor.certificationPath.gapsToAddress?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-foreground mb-2">Address these gaps:</p>
                      <ul className="space-y-1">
                        {advisor.certificationPath.gapsToAddress.map((gap, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                            {gap}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* ETS Carbon Cost */}
          {(isLoading || advisor?.etsCarbonCost) && (
            <Card className="p-5">
              <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-blue-500" />
                ETS Carbon Cost Exposure
              </h3>
              {isLoading ? <Skeleton className="h-16 w-full rounded-xl" /> : advisor?.etsCarbonCost && (
                <div>
                  <p className="text-3xl font-bold text-foreground mb-1">
                    NZ${advisor.etsCarbonCost.estimatedAnnualNZD.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground mb-3">Estimated annual ETS carbon cost embedded in fuel</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{advisor.etsCarbonCost.explanation}</p>
                  <a
                    href="https://environment.govt.nz/what-government-is-doing/areas-of-work/climate-change/ets/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 text-xs text-primary flex items-center gap-1 hover:underline"
                  >
                    About the NZ ETS <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </Card>
          )}

          {/* NZ Policy Timeline */}
          <Card className="p-5">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-primary" />
              NZ Policy Timeline
            </h3>
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
              </div>
            ) : advisor?.timeline?.length ? (
              <div className="relative pl-4">
                <div className="absolute left-1.5 top-0 bottom-0 w-px bg-border" />
                <div className="space-y-4">
                  {advisor.timeline.map((item, i) => (
                    <div key={i} className="relative">
                      <div className={`absolute -left-3 top-1 w-2.5 h-2.5 rounded-full border-2 border-background ${item.relevantToOrg ? "bg-primary" : "bg-muted-foreground/40"}`} />
                      <div className={`rounded-xl p-3 border text-xs ${item.relevantToOrg ? "border-primary/25 bg-primary/3" : "border-border bg-background"}`}>
                        <p className={`font-semibold mb-0.5 ${item.relevantToOrg ? "text-primary" : "text-muted-foreground"}`}>{item.date}</p>
                        <p className="text-muted-foreground leading-relaxed">{item.event}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3 relative pl-4">
                <div className="absolute left-1.5 top-0 bottom-0 w-px bg-border" />
                {[
                  { date: "2026 (active)", event: "Emissions Budget 2 begins (2026–2030). ERP2 in force.", highlight: true },
                  { date: "2026/27", event: "Govt fleet carbon neutral target — all public agencies", highlight: false },
                  { date: "2030", event: "NZ ETS: industrial coal phase-out target", highlight: false },
                  { date: "2030", event: "NZ NDC: −50% below 2005 gross emissions", highlight: false },
                  { date: "2050", event: "Net zero all GHGs (except biogenic methane)", highlight: false },
                ].map((item, i) => (
                  <div key={i} className="relative">
                    <div className={`absolute -left-3 top-1 w-2.5 h-2.5 rounded-full border-2 border-background ${item.highlight ? "bg-primary" : "bg-muted-foreground/40"}`} />
                    <div className={`rounded-xl p-3 border text-xs ${item.highlight ? "border-primary/25 bg-primary/3" : "border-border"}`}>
                      <p className={`font-semibold mb-0.5 ${item.highlight ? "text-primary" : "text-muted-foreground"}`}>{item.date}</p>
                      <p className="text-muted-foreground">{item.event}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
