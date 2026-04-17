import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Target, Plus, Trash2, Loader2, TrendingDown, Calendar,
  CheckCircle2, AlertTriangle, ChevronRight, Sparkles, Wand2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface EmissionTarget {
  id: string;
  baselineYear: number;
  baselineCo2eKg: number;
  targetYear: number;
  targetPctReduction: number;
  label?: string;
  framework?: string;
  createdAt: string;
}

interface TargetWithProgress extends EmissionTarget {
  targetCo2eKg: number;
  currentCo2eKg?: number;     // actual current-year emissions (from API summary)
  progressPct?: number;        // how far along the reduction path
  onTrack?: boolean;
}

const FRAMEWORKS = [
  { value: "", label: "Custom" },
  { value: "SBTi-1.5", label: "Science-Based Target — 1.5°C aligned" },
  { value: "SBTi-WB2", label: "Science-Based Target — Well-below 2°C" },
  { value: "NZ-ETS", label: "NZ ETS Commitment" },
  { value: "CEMARS", label: "Toitū carbonreduce / CEMARS" },
  { value: "NetZero", label: "Net Zero 2050" },
];

// Framework-aligned defaults the assistant uses to suggest values.
// SBTi 1.5°C requires ≥4.2% absolute reduction per year (linear).
// SBTi WB2 requires ≥2.5% per year. Toitū carbonreduce requires ≥1% per year.
// Net Zero 2050 means ~100% by 2050 with residual offsets.
const FRAMEWORK_DEFAULTS: Record<
  string,
  { label: string; annualPct: number; suggestedTargetYear: (baseline: number) => number; minPct: number; note: string }
> = {
  "SBTi-1.5": {
    label: "SBTi 1.5°C",
    annualPct: 4.2,
    suggestedTargetYear: (b) => b + 10,
    minPct: 42,
    note: "SBTi requires ≥4.2% absolute reduction per year for 1.5°C alignment. 42% by year 10 is the minimum.",
  },
  "SBTi-WB2": {
    label: "SBTi Well-Below 2°C",
    annualPct: 2.5,
    suggestedTargetYear: (b) => b + 10,
    minPct: 25,
    note: "SBTi WB2 requires ≥2.5% absolute reduction per year. 25% by year 10 is the minimum.",
  },
  "NZ-ETS": {
    label: "NZ ETS aligned",
    annualPct: 2.0,
    suggestedTargetYear: () => 2030,
    minPct: 30,
    note: "Aligned with NZ's NDC: 50% net by 2030 from gross 2005, ~30% gross from a 2025 baseline.",
  },
  "CEMARS": {
    label: "Toitū carbonreduce",
    annualPct: 1.0,
    suggestedTargetYear: (b) => b + 5,
    minPct: 5,
    note: "Toitū carbonreduce requires a verified ≥1% absolute reduction per year against baseline.",
  },
  "NetZero": {
    label: "Net Zero 2050",
    annualPct: 3.6,
    suggestedTargetYear: () => 2050,
    minPct: 90,
    note: "Net Zero 2050: ≥90% absolute reduction by 2050 with the residual offset by removals.",
  },
};

function ProgressRing({ pct, size = 80 }: { pct: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(pct, 100) / 100) * c;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth={6} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={pct >= 100 ? "#34d399" : pct >= 50 ? "#60a5fa" : "#f59e0b"}
        strokeWidth={6}
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-700"
      />
    </svg>
  );
}

export default function Targets() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const { toast } = useToast();
  const qc = useQueryClient();

  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({
    baselineYear: new Date().getFullYear() - 1,
    baselineCo2eKg: "",
    targetYear: new Date().getFullYear() + 5,
    targetPctReduction: "30",
    label: "",
    framework: "",
  });

  // Fetch targets
  const { data, isLoading } = useQuery<{ items: EmissionTarget[] }>({
    queryKey: ["targets", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const res = await fetch(`/api/organisations/${orgId}/targets`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch targets");
      return res.json();
    },
  });

  // Fetch current emissions for progress calculation
  const { data: summary } = useQuery<{ totalCo2eKg: number }>({
    queryKey: ["org-summary", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const res = await fetch(`/api/organisations/${orgId}/summary`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch summary");
      return res.json();
    },
  });

  // Last-12-month emissions — used by the Target Assistant to seed baseline
  const { data: trailing12m, isLoading: trailing12mLoading } = useQuery<{ totalCo2eKg: number }>({
    queryKey: ["org-summary-12m", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const res = await fetch(`/api/organisations/${orgId}/summary?period=12m`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch 12-month summary");
      return res.json();
    },
  });

  // Target Assistant — fills in baseline + framework-aligned reduction & timeline.
  function applyAssistantSuggestion(framework?: string) {
    const baselineKg = trailing12m?.totalCo2eKg ?? 0;
    const baselineYear = new Date().getFullYear() - 1; // most-recent complete year proxy
    const fw = framework ?? form.framework;
    const def = fw && FRAMEWORK_DEFAULTS[fw];

    if (!baselineKg) {
      toast({
        variant: "destructive",
        title: "No emissions data yet",
        description: "Add fleet or energy data first so the assistant can calculate a baseline.",
      });
      return;
    }

    if (def) {
      const targetYear = def.suggestedTargetYear(baselineYear);
      const years = Math.max(1, targetYear - baselineYear);
      // Linear annual reduction × years, capped at 100, with framework minimum.
      const calculatedPct = Math.min(100, Math.round(def.annualPct * years));
      const targetPctReduction = Math.max(def.minPct, calculatedPct);
      setForm({
        baselineYear,
        baselineCo2eKg: String(Math.round(baselineKg)),
        targetYear,
        targetPctReduction: String(targetPctReduction),
        label: `${def.label} commitment`,
        framework: fw,
      });
      toast({
        title: "Suggestion applied",
        description: `${def.label}: ${targetPctReduction}% by ${targetYear}.`,
      });
    } else {
      // Custom — sensible NZ default: 30% by year+5 from real baseline.
      const targetYear = baselineYear + 5;
      setForm((f) => ({
        ...f,
        baselineYear,
        baselineCo2eKg: String(Math.round(baselineKg)),
        targetYear,
        targetPctReduction: f.targetPctReduction || "30",
      }));
      toast({
        title: "Baseline filled",
        description: "Used your last 12 months of emissions as the baseline.",
      });
    }
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/organisations/${orgId}/targets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          baselineYear: Number(form.baselineYear),
          baselineCo2eKg: Number(form.baselineCo2eKg),
          targetYear: Number(form.targetYear),
          targetPctReduction: Number(form.targetPctReduction),
          label: form.label || undefined,
          framework: form.framework || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json() as { message?: string };
        throw new Error(err.message ?? "Failed to create target");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["targets", orgId] });
      setIsOpen(false);
      toast({ title: "Target created" });
      setForm({ baselineYear: new Date().getFullYear() - 1, baselineCo2eKg: "", targetYear: new Date().getFullYear() + 5, targetPctReduction: "30", label: "", framework: "" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Failed to create target", description: e.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/organisations/${orgId}/targets/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["targets", orgId] });
      toast({ title: "Target removed" });
    },
  });

  // Enrich targets with progress
  const currentYear = new Date().getFullYear();
  const targets: TargetWithProgress[] = (data?.items ?? []).map(t => {
    const targetCo2eKg = t.baselineCo2eKg * (1 - t.targetPctReduction / 100);
    const yearsElapsed = currentYear - t.baselineYear;
    const totalYears   = t.targetYear - t.baselineYear;
    const expectedProgress = totalYears > 0 ? Math.min((yearsElapsed / totalYears) * 100, 100) : 0;
    const currentKg = summary?.totalCo2eKg;
    let progressPct: number | undefined;
    let onTrack: boolean | undefined;
    if (currentKg != null) {
      const reductionAchieved = t.baselineCo2eKg - currentKg;
      const reductionNeeded   = t.baselineCo2eKg - targetCo2eKg;
      progressPct = reductionNeeded > 0 ? Math.max(0, (reductionAchieved / reductionNeeded) * 100) : 0;
      onTrack = progressPct >= expectedProgress * 0.8;
    }
    return { ...t, targetCo2eKg, currentCo2eKg: currentKg, progressPct, onTrack };
  });

  const fmt = (kg: number) =>
    kg >= 1000 ? `${(kg / 1000).toFixed(1)}k kg` : `${Math.round(kg).toLocaleString()} kg`;

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Emission Targets</h1>
          <p className="text-muted-foreground mt-1">
            Set science-based reduction goals and track your trajectory.
          </p>
        </div>
        <Button onClick={() => setIsOpen(true)} className="shadow-lg shadow-primary/20">
          <Plus className="w-4 h-4 mr-2" /> Set Target
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : targets.length === 0 ? (
        <Card className="p-12 border-border/50 text-center">
          <Target className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
          <h3 className="font-semibold text-lg mb-1">No targets yet</h3>
          <p className="text-muted-foreground text-sm max-w-md mx-auto mb-6">
            Setting an emission reduction target is the first step toward a credible decarbonisation plan —
            and a requirement for most ESG tender frameworks.
          </p>
          <Button onClick={() => setIsOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> Set your first target
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {targets.map(t => (
            <Card key={t.id} className="p-6 border-border/50">
              <div className="flex flex-col md:flex-row items-start gap-6">
                {/* Ring */}
                <div className="relative shrink-0">
                  <ProgressRing pct={t.progressPct ?? 0} size={88} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-lg font-bold tabular-nums">{Math.round(t.progressPct ?? 0)}%</span>
                    <span className="text-[10px] text-muted-foreground">done</span>
                  </div>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-start gap-2 mb-2">
                    <h3 className="font-semibold text-lg text-foreground">
                      {t.label || `${t.targetPctReduction}% reduction by ${t.targetYear}`}
                    </h3>
                    {t.framework && (
                      <span className="text-xs bg-primary/10 text-primary px-2.5 py-0.5 rounded-full font-medium">
                        {t.framework}
                      </span>
                    )}
                    {t.onTrack != null && (
                      <span className={`flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-medium ${
                        t.onTrack ? "bg-emerald-900/40 text-emerald-300" : "bg-amber-900/40 text-amber-300"
                      }`}>
                        {t.onTrack ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                        {t.onTrack ? "On track" : "Needs attention"}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mt-3">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Baseline ({t.baselineYear})</p>
                      <p className="font-semibold text-foreground">{fmt(t.baselineCo2eKg)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Target ({t.targetYear})</p>
                      <p className="font-semibold text-emerald-400">{fmt(t.targetCo2eKg)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Required reduction</p>
                      <p className="font-semibold text-foreground">↓{t.targetPctReduction}% ({fmt(t.baselineCo2eKg - t.targetCo2eKg)})</p>
                    </div>
                    {t.currentCo2eKg != null && (
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Current (12M)</p>
                        <p className={`font-semibold ${t.currentCo2eKg <= t.targetCo2eKg ? "text-emerald-400" : "text-foreground"}`}>
                          {fmt(t.currentCo2eKg)}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Timeline bar */}
                  <div className="mt-4">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{t.baselineYear}</span>
                      <span>{t.targetYear}</span>
                    </div>
                    <div className="h-2 bg-secondary/40 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-400 transition-all duration-700"
                        style={{ width: `${Math.min(t.progressPct ?? 0, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                <Button
                  variant="ghost" size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteMutation.mutate(t.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="w-5 h-5 text-primary" /> New Emission Target
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {/* Target Assistant — auto-fills baseline + framework defaults */}
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 rounded-md bg-primary/15 p-1.5">
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">Target Assistant</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {trailing12mLoading
                      ? "Reading your last 12 months of emissions…"
                      : trailing12m?.totalCo2eKg
                        ? <>Use your last 12 months ({Math.round(trailing12m.totalCo2eKg).toLocaleString()} kg CO₂e) as the baseline, then pick a framework for a science-aligned suggestion.</>
                        : "Add fleet or energy data first so I can calculate a baseline from your real emissions."}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    <Button
                      size="sm" variant="outline"
                      className="h-7 text-xs"
                      onClick={() => applyAssistantSuggestion("SBTi-1.5")}
                      disabled={!trailing12m?.totalCo2eKg}
                    >
                      <Wand2 className="w-3 h-3 mr-1" />SBTi 1.5°C
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      className="h-7 text-xs"
                      onClick={() => applyAssistantSuggestion("NetZero")}
                      disabled={!trailing12m?.totalCo2eKg}
                    >
                      <Wand2 className="w-3 h-3 mr-1" />Net Zero 2050
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      className="h-7 text-xs"
                      onClick={() => applyAssistantSuggestion("NZ-ETS")}
                      disabled={!trailing12m?.totalCo2eKg}
                    >
                      <Wand2 className="w-3 h-3 mr-1" />NZ ETS
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      className="h-7 text-xs"
                      onClick={() => applyAssistantSuggestion("CEMARS")}
                      disabled={!trailing12m?.totalCo2eKg}
                    >
                      <Wand2 className="w-3 h-3 mr-1" />Toitū
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Baseline year</label>
                <Input
                  type="number"
                  value={form.baselineYear}
                  onChange={e => setForm(f => ({ ...f, baselineYear: Number(e.target.value) }))}
                  className="mt-1.5 bg-background"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Baseline CO₂e (kg)</label>
                <Input
                  type="number"
                  value={form.baselineCo2eKg}
                  onChange={e => setForm(f => ({ ...f, baselineCo2eKg: e.target.value }))}
                  placeholder="e.g. 50000"
                  className="mt-1.5 bg-background"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Target year</label>
                <Input
                  type="number"
                  value={form.targetYear}
                  onChange={e => setForm(f => ({ ...f, targetYear: Number(e.target.value) }))}
                  className="mt-1.5 bg-background"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">% Reduction target</label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.targetPctReduction}
                  onChange={e => setForm(f => ({ ...f, targetPctReduction: e.target.value }))}
                  placeholder="e.g. 30"
                  className="mt-1.5 bg-background"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">Label (optional)</label>
              <Input
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Net Zero 2030, SBTi Commitment"
                className="mt-1.5 bg-background"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">Framework</label>
              <select
                value={form.framework}
                onChange={e => setForm(f => ({ ...f, framework: e.target.value }))}
                className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              >
                {FRAMEWORKS.map(fw => (
                  <option key={fw.value} value={fw.value}>{fw.label}</option>
                ))}
              </select>
            </div>

            {form.baselineCo2eKg && form.targetPctReduction && (
              <div className="rounded-lg bg-emerald-950/30 border border-emerald-800/30 px-4 py-3 text-sm">
                Target: <span className="font-semibold text-emerald-300">
                  {Math.round(Number(form.baselineCo2eKg) * (1 - Number(form.targetPctReduction) / 100)).toLocaleString()} kg CO₂e
                </span> by {form.targetYear} — a reduction of{" "}
                <span className="font-semibold text-emerald-300">
                  {Math.round(Number(form.baselineCo2eKg) * Number(form.targetPctReduction) / 100).toLocaleString()} kg
                </span>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!form.baselineCo2eKg || !form.targetPctReduction || createMutation.isPending}
                className="shadow-sm shadow-primary/20"
              >
                {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Plus className="w-4 h-4 mr-1.5" />}
                Create Target
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
