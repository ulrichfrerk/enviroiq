import { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Beaker, TrendingDown, Save, Trash2, Plus, Loader2, Info,
  Car, Zap, Wind, Leaf, RotateCcw, ChevronRight, Flame,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, Cell,
} from "recharts";
import { format } from "date-fns";

// ── Types ────────────────────────────────────────────────────────────────────

interface ScenarioLevers {
  evTransitionPct: number;
  fleetKmReductionPct: number;
  modalShiftPct: number;
  renewableEnergyPct: number;
  buildingEfficiencyPct: number;
  offsetPct: number;
}

interface LeverImpact {
  lever: string;
  label: string;
  savedKg: number;
  pct: number;
}

interface ScenarioResult {
  baselineCo2eKg: number;
  baselineFleetKg: number;
  baselineEnergyKg: number;
  projectedCo2eKg: number;
  projectedFleetKg: number;
  projectedEnergyKg: number;
  savedCo2eKg: number;
  savedPct: number;
  leverImpacts: LeverImpact[];
}

interface Baseline {
  fleetKg: number;
  energyKg: number;
  totalKg: number;
}

interface SavedScenario {
  id: string;
  name: string;
  description?: string;
  levers: ScenarioLevers;
  result: ScenarioResult;
  updatedAt: string;
}

const DEFAULT_LEVERS: ScenarioLevers = {
  evTransitionPct: 0,
  fleetKmReductionPct: 0,
  modalShiftPct: 0,
  renewableEnergyPct: 0,
  buildingEfficiencyPct: 0,
  offsetPct: 0,
};

// ── Lever definitions ─────────────────────────────────────────────────────────

const LEVER_DEFS = [
  {
    key: "evTransitionPct" as keyof ScenarioLevers,
    label: "EV Fleet Transition",
    sublabel: "% of fleet converted to electric",
    icon: Car,
    color: "text-blue-400",
    bg: "bg-blue-900/20",
    border: "border-blue-800/30",
    accent: "#60a5fa",
    tip: "Models ICE → EV switch using NZ grid electricity. EVs reduce fleet Scope 1 by ~80% (NZ renewables ~86%).",
    group: "fleet",
  },
  {
    key: "fleetKmReductionPct" as keyof ScenarioLevers,
    label: "Fleet km Reduction",
    sublabel: "% fewer total kilometres driven",
    icon: TrendingDown,
    color: "text-violet-400",
    bg: "bg-violet-900/20",
    border: "border-violet-800/30",
    accent: "#a78bfa",
    tip: "Route optimisation, remote work, or consolidated deliveries. Directly reduces Scope 1 fleet emissions.",
    group: "fleet",
  },
  {
    key: "modalShiftPct" as keyof ScenarioLevers,
    label: "Modal Shift",
    sublabel: "% of trips switched to lower-emission modes",
    icon: ChevronRight,
    color: "text-cyan-400",
    bg: "bg-cyan-900/20",
    border: "border-cyan-800/30",
    accent: "#22d3ee",
    tip: "Shifting trips to public transport, cycling, or walking. Applied after fleet km reduction.",
    group: "fleet",
  },
  {
    key: "renewableEnergyPct" as keyof ScenarioLevers,
    label: "Renewable Energy",
    sublabel: "% of electricity from certified renewables",
    icon: Wind,
    color: "text-emerald-400",
    bg: "bg-emerald-900/20",
    border: "border-emerald-800/30",
    accent: "#34d399",
    tip: "GHG Protocol market-based method: 100% renewable tariff = 0 kg CO₂e for electricity. Applied after building efficiency.",
    group: "energy",
  },
  {
    key: "buildingEfficiencyPct" as keyof ScenarioLevers,
    label: "Building Efficiency",
    sublabel: "% reduction in total energy consumption",
    icon: Zap,
    color: "text-yellow-400",
    bg: "bg-yellow-900/20",
    border: "border-yellow-800/30",
    accent: "#fbbf24",
    tip: "LED lighting, HVAC upgrades, insulation. Reduces total energy consumed before renewable factor is applied.",
    group: "energy",
  },
  {
    key: "offsetPct" as keyof ScenarioLevers,
    label: "Carbon Offsets",
    sublabel: "% of remaining emissions offset",
    icon: Leaf,
    color: "text-green-400",
    bg: "bg-green-900/20",
    border: "border-green-800/30",
    accent: "#4ade80",
    tip: "Applied to residual emissions after all other levers. Use high-quality verified offsets (e.g. Gold Standard, Verra VCS).",
    group: "offset",
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(kg: number) {
  if (kg >= 1000000) return `${(kg / 1000000).toFixed(1)}t CO₂e`;
  if (kg >= 1000)    return `${(kg / 1000).toFixed(1)}k kg`;
  return `${Math.round(kg).toLocaleString()} kg`;
}

function LeverSlider({
  def,
  value,
  onChange,
  disabled,
}: {
  def: (typeof LEVER_DEFS)[number];
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const Icon = def.icon;
  return (
    <div className={`rounded-xl border ${def.border} ${def.bg} p-4 space-y-3`}>
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${def.color}`} />
        <span className="text-sm font-medium text-foreground">{def.label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">{def.tip}</TooltipContent>
        </Tooltip>
        <span className={`ml-auto text-lg font-bold tabular-nums ${def.color}`}>{value}%</span>
      </div>
      <p className="text-xs text-muted-foreground">{def.sublabel}</p>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        disabled={disabled}
        style={{ accentColor: def.accent }}
        className="w-full cursor-pointer disabled:opacity-50"
      />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Scenarios() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const { toast } = useToast();
  const qc = useQueryClient();

  const [levers, setLevers] = useState<ScenarioLevers>(DEFAULT_LEVERS);
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<{ baseline: Baseline; result: ScenarioResult } | null>(null);

  // Saved scenarios list
  const { data: savedData, isLoading: loadingSaved } = useQuery<{ items: SavedScenario[]; baseline: Baseline }>({
    queryKey: ["scenarios", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const res = await fetch(`/api/organisations/${orgId}/scenarios`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch scenarios");
      return res.json();
    },
  });

  // Debounced preview — fires 400ms after sliders stop moving
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!orgId) return;
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(async () => {
      setIsPreviewing(true);
      try {
        const res = await fetch(`/api/organisations/${orgId}/scenarios/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ levers }),
        });
        if (!res.ok) throw new Error("Preview failed");
        const data = await res.json();
        setPreviewResult(data);
      } catch { /* silent — preview is best-effort */ } finally {
        setIsPreviewing(false);
      }
    }, 400);
    return () => { if (previewTimerRef.current) clearTimeout(previewTimerRef.current); };
  }, [orgId, levers]);

  const setLever = (key: keyof ScenarioLevers, val: number) => {
    setLevers(prev => ({ ...prev, [key]: val }));
  };
  const resetLevers = () => setLevers(DEFAULT_LEVERS);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/organisations/${orgId}/scenarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: saveName, description: saveDesc || undefined, levers }),
      });
      if (!res.ok) throw new Error("Failed to save scenario");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scenarios", orgId] });
      setIsSaveOpen(false);
      setSaveName("");
      setSaveDesc("");
      toast({ title: "Scenario saved" });
    },
    onError: () => toast({ variant: "destructive", title: "Failed to save scenario" }),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/organisations/${orgId}/scenarios/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scenarios", orgId] });
      toast({ title: "Scenario deleted" });
    },
  });

  // Load a saved scenario into the sliders
  const loadScenario = (s: SavedScenario) => {
    setLevers(s.levers);
    toast({ title: `Loaded: ${s.name}` });
  };

  const r = previewResult?.result;
  const baseline = previewResult?.baseline ?? savedData?.baseline;

  const fleetLevers = LEVER_DEFS.filter(d => d.group === "fleet");
  const energyLevers = LEVER_DEFS.filter(d => d.group === "energy");
  const offsetLevers = LEVER_DEFS.filter(d => d.group === "offset");

  const hasAnyLever = Object.values(levers).some(v => v > 0);

  const barData = r?.leverImpacts.map(li => ({
    name: li.label.split(" (")[0],
    kg: Math.round(li.savedKg),
    pct: li.pct,
  })) ?? [];

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Scenario Modelling</h1>
          <p className="text-muted-foreground mt-1">
            Model decarbonisation pathways and quantify the impact of each lever.
          </p>
        </div>
        <div className="flex gap-2">
          {hasAnyLever && (
            <Button variant="outline" onClick={resetLevers} size="sm">
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Reset
            </Button>
          )}
          <Button onClick={() => setIsSaveOpen(true)} disabled={!hasAnyLever} size="sm" className="shadow-sm shadow-primary/20">
            <Save className="w-3.5 h-3.5 mr-1.5" /> Save Scenario
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">

        {/* ── Levers panel ──────────────────────────────────────────────── */}
        <div className="xl:col-span-2 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Flame className="w-4 h-4 text-orange-400" />
            <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Fleet Levers</span>
          </div>
          {fleetLevers.map(def => (
            <LeverSlider key={def.key} def={def} value={levers[def.key]} onChange={v => setLever(def.key, v)} />
          ))}

          <div className="flex items-center gap-2 mt-6 mb-1">
            <Zap className="w-4 h-4 text-yellow-400" />
            <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Energy Levers</span>
          </div>
          {energyLevers.map(def => (
            <LeverSlider key={def.key} def={def} value={levers[def.key]} onChange={v => setLever(def.key, v)} />
          ))}

          <div className="flex items-center gap-2 mt-6 mb-1">
            <Leaf className="w-4 h-4 text-green-400" />
            <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Offset</span>
          </div>
          {offsetLevers.map(def => (
            <LeverSlider key={def.key} def={def} value={levers[def.key]} onChange={v => setLever(def.key, v)} />
          ))}
        </div>

        {/* ── Results panel ─────────────────────────────────────────────── */}
        <div className="xl:col-span-3 space-y-6">

          {/* Before / After headline */}
          <Card className="p-6 border-border/50">
            <div className="flex items-center gap-2 mb-5">
              <h3 className="font-semibold text-lg">Projected Outcome</h3>
              {isPreviewing && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            </div>
            {baseline ? (
              <div className="grid grid-cols-2 gap-4">
                {/* Baseline */}
                <div className="bg-secondary/30 rounded-xl p-4 border border-border/40">
                  <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide font-semibold">Baseline (12M)</p>
                  <p className="text-3xl font-bold tabular-nums text-foreground">{fmt(baseline.totalKg)}</p>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <div className="flex justify-between"><span className="flex items-center gap-1"><Car className="w-3 h-3" />Fleet</span><span>{fmt(baseline.fleetKg)}</span></div>
                    <div className="flex justify-between"><span className="flex items-center gap-1"><Zap className="w-3 h-3" />Energy</span><span>{fmt(baseline.energyKg)}</span></div>
                  </div>
                </div>
                {/* Projected */}
                <div className={`rounded-xl p-4 border transition-colors ${r && r.savedPct > 0 ? "bg-emerald-950/30 border-emerald-800/30" : "bg-secondary/20 border-border/40"}`}>
                  <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide font-semibold">Scenario</p>
                  <p className={`text-3xl font-bold tabular-nums ${r && r.savedPct > 0 ? "text-emerald-300" : "text-foreground"}`}>
                    {r ? fmt(r.projectedCo2eKg) : "—"}
                  </p>
                  {r && r.savedPct > 0 ? (
                    <div className="mt-2 space-y-1 text-xs">
                      <div className="flex justify-between text-emerald-400/80"><span>Saved</span><span className="font-semibold">{fmt(r.savedCo2eKg)} ({r.savedPct.toFixed(1)}%)</span></div>
                      <div className="flex justify-between text-muted-foreground"><span className="flex items-center gap-1"><Car className="w-3 h-3" />Fleet</span><span>{fmt(r.projectedFleetKg)}</span></div>
                      <div className="flex justify-between text-muted-foreground"><span className="flex items-center gap-1"><Zap className="w-3 h-3" />Energy</span><span>{fmt(r.projectedEnergyKg)}</span></div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-2">Adjust the levers to model a reduction.</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            )}
          </Card>

          {/* Progress bar */}
          {r && r.savedPct > 0 && (
            <Card className="p-5 border-border/50">
              <p className="text-sm font-medium text-muted-foreground mb-3">Reduction Progress</p>
              <div className="w-full bg-secondary/40 rounded-full h-4 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
                  style={{ width: `${Math.min(r.savedPct, 100)}%` }}
                />
              </div>
              <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
                <span>0%</span>
                <span className="font-semibold text-emerald-400">{r.savedPct.toFixed(1)}% reduction</span>
                <span>100%</span>
              </div>
            </Card>
          )}

          {/* Lever impacts waterfall bar chart */}
          {barData.length > 0 && (
            <Card className="p-6 border-border/50">
              <h4 className="font-medium mb-4">Reduction by Lever (kg CO₂e saved)</h4>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} layout="vertical" margin={{ left: 8, right: 40, top: 0, bottom: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px" }}
                      formatter={(val: number, _, props) => [`${val.toLocaleString()} kg (${props.payload?.pct?.toFixed(1)}%)`, "Saved"]}
                    />
                    <Bar dataKey="kg" radius={[0, 4, 4, 0]} maxBarSize={28}>
                      {barData.map((_, i) => (
                        <Cell key={i} fill={["#60a5fa","#a78bfa","#22d3ee","#34d399","#fbbf24","#4ade80"][i % 6]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {/* Saved scenarios */}
          <Card className="border-border/50 overflow-hidden">
            <div className="p-5 border-b border-border/50 flex items-center justify-between">
              <h4 className="font-semibold">Saved Scenarios</h4>
              <span className="text-xs text-muted-foreground">{savedData?.items.length ?? 0} saved</span>
            </div>
            {loadingSaved ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : !savedData?.items.length ? (
              <div className="px-5 py-8 text-center text-muted-foreground text-sm">
                <Beaker className="w-8 h-8 mx-auto mb-2 opacity-30" />
                No saved scenarios yet. Adjust the levers and click Save.
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {savedData.items.map(s => (
                  <div key={s.id} className="flex items-center gap-4 px-5 py-4 hover:bg-secondary/20 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{s.name}</p>
                      {s.description && <p className="text-xs text-muted-foreground truncate">{s.description}</p>}
                      <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="text-emerald-400 font-semibold">↓{s.result.savedPct.toFixed(1)}%</span>
                        <span>{fmt(s.result.savedCo2eKg)} saved</span>
                        <span>{format(new Date(s.updatedAt), "d MMM yyyy")}</span>
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <Button variant="outline" size="sm" onClick={() => loadScenario(s)} className="text-xs h-8">
                        <Plus className="w-3 h-3 mr-1" /> Load
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteMutation.mutate(s.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Save dialog */}
      <Dialog open={isSaveOpen} onOpenChange={setIsSaveOpen}>
        <DialogContent className="bg-card border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save Scenario</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Name</label>
              <Input
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                placeholder="e.g. 50% EV + 100% Renewable"
                className="mt-1.5 bg-background"
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Description (optional)</label>
              <Input
                value={saveDesc}
                onChange={e => setSaveDesc(e.target.value)}
                placeholder="Short description for this pathway"
                className="mt-1.5 bg-background"
              />
            </div>
            {r && r.savedPct > 0 && (
              <div className="rounded-lg bg-emerald-950/30 border border-emerald-800/30 px-4 py-3 text-sm">
                <span className="text-emerald-400 font-semibold">↓{r.savedPct.toFixed(1)}%</span>
                <span className="text-muted-foreground ml-2">— saves {fmt(r.savedCo2eKg)} CO₂e/year</span>
              </div>
            )}
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => setIsSaveOpen(false)}>Cancel</Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={!saveName.trim() || saveMutation.isPending}
              >
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Save className="w-4 h-4 mr-1.5" />}
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
