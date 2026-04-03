import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Globe, Loader2, BrainCircuit, CheckCircle, AlertCircle,
  ChevronRight, ChevronLeft, Car, Zap, Users, ShieldCheck,
  Trash2, FolderOpen, HardHat, Building2, Sparkles,
  ArrowRight, Clock, Info, ExternalLink,
} from "lucide-react";

// ── Module metadata ────────────────────────────────────────────────────────────
const MODULE_META: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; path: string }> = {
  fleet: { icon: Car, color: "bg-emerald-50 border-emerald-200 text-emerald-700", path: "/fleet" },
  energy: { icon: Zap, color: "bg-blue-50 border-blue-200 text-blue-700", path: "/energy" },
  social: { icon: Users, color: "bg-purple-50 border-purple-200 text-purple-700", path: "/social" },
  governance: { icon: ShieldCheck, color: "bg-indigo-50 border-indigo-200 text-indigo-700", path: "/governance" },
  waste: { icon: Trash2, color: "bg-amber-50 border-amber-200 text-amber-700", path: "/waste" },
  projects: { icon: FolderOpen, color: "bg-orange-50 border-orange-200 text-orange-700", path: "/projects" },
  subcontractors: { icon: HardHat, color: "bg-slate-50 border-slate-200 text-slate-700", path: "/subcontractors" },
};

const PRIORITY_COLOR: Record<string, string> = {
  essential: "bg-red-100 text-red-700 border-red-200",
  recommended: "bg-amber-100 text-amber-700 border-amber-200",
  optional: "bg-slate-100 text-slate-500 border-slate-200",
};

const SIZE_LABEL: Record<string, string> = {
  micro: "Micro (1–4 staff)",
  small: "Small (5–19 staff)",
  medium: "Medium (20–100 staff)",
  large: "Large (100+ staff)",
};

interface Analysis {
  businessName: string;
  industry: string;
  businessSummary: string;
  size: string;
  sizeReasoning: string;
  primaryActivities: string[];
  esgWeighting: { environmental: number; social: number; governance: number; reasoning: string };
  modules: Array<{ key: string; name: string; priority: string; reason: string }>;
  reportingObligations: Array<{ name: string; applies: boolean; urgency: string; description: string }>;
  setupOrder: Array<{ step: number; module: string; title: string; description: string; estimatedTime: string }>;
  nzProcurementAdvantage: string;
  firstYearGoal: string;
}

export default function OnboardingWizard() {
  const { session } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  // Step 3 form
  const [form, setForm] = useState({
    name: "",
    industry: "",
    country: "NZ",
    adminEmail: "",
    adminName: "",
  });

  if (session?.role !== "super_admin") {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center gap-4">
        <AlertCircle className="w-12 h-12 text-destructive" />
        <h2 className="text-xl font-semibold">Access Denied</h2>
        <Button onClick={() => setLocation("/dashboard")}>Return to Dashboard</Button>
      </div>
    );
  }

  // Step 1 → 2: analyse the website
  const analyseMutation = useMutation({
    mutationFn: () =>
      apiClient("/api/admin/onboarding/analyse", {
        method: "POST",
        body: JSON.stringify({ websiteUrl }),
      }) as Promise<{ analysis: Analysis; websiteUrl: string }>,
    onSuccess: ({ analysis: a }) => {
      setAnalysis(a);
      setForm(prev => ({
        ...prev,
        name: a.businessName || prev.name,
        industry: a.industry || prev.industry,
      }));
      setStep(2);
    },
    onError: () => {
      toast({ variant: "destructive", title: "Analysis failed", description: "Check the URL and try again." });
    },
  });

  // Step 3: create the organisation
  const createMutation = useMutation({
    mutationFn: () =>
      apiClient("/api/organisations", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          onboardingBrief: JSON.stringify(analysis),
        }),
      }),
    onSuccess: () => {
      toast({ title: "Organisation created", description: `${form.name} is ready. An invite has been sent to ${form.adminEmail}.` });
      setLocation("/admin");
    },
    onError: (e: unknown) => {
      toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "Could not create organisation" });
    },
  });

  const essential = analysis?.modules.filter(m => m.priority === "essential") ?? [];
  const recommended = analysis?.modules.filter(m => m.priority === "recommended") ?? [];
  const optional = analysis?.modules.filter(m => m.priority === "optional") ?? [];

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-16">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div>
        <button onClick={() => setLocation("/admin")} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-4">
          <ChevronLeft className="w-4 h-4" /> Back to admin
        </button>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-xl bg-primary/10">
            <BrainCircuit className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">AI-Guided Business Setup</h1>
        </div>
        <p className="text-muted-foreground">
          Paste the business's website URL — the AI reads it and generates a tailored ESG setup guide, then creates the organisation in one step.
        </p>
      </div>

      {/* ── Step indicator ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-sm">
        {[
          { n: 1, label: "Analyse website" },
          { n: 2, label: "Review setup guide" },
          { n: 3, label: "Create organisation" },
        ].map(({ n, label }, i) => (
          <div key={n} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
              step === n ? "bg-primary border-primary text-white" :
              step > n ? "bg-emerald-500 border-emerald-500 text-white" :
              "border-border text-muted-foreground bg-background"
            }`}>
              {step > n ? <CheckCircle className="w-3.5 h-3.5" /> : n}
            </div>
            <span className={`font-medium ${step === n ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
            {i < 2 && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* ════════════ STEP 1: Enter website URL ════════════════════════════ */}
      {step === 1 && (
        <Card className="p-8">
          <div className="flex items-center gap-2 mb-6">
            <Globe className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Enter the business website</h2>
          </div>
          <p className="text-muted-foreground mb-6 text-sm leading-relaxed">
            The AI will fetch the website, read about the business, and generate a tailored ESG setup guide covering which modules to enable, reporting obligations, and a prioritised onboarding order.
          </p>
          <div className="flex gap-3">
            <Input
              placeholder="e.g. https://acmeconstruction.co.nz"
              value={websiteUrl}
              onChange={e => setWebsiteUrl(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && websiteUrl.trim()) analyseMutation.mutate(); }}
              className="flex-1 text-base"
            />
            <Button
              onClick={() => analyseMutation.mutate()}
              disabled={!websiteUrl.trim() || analyseMutation.isPending}
              size="lg"
              className="gap-2 shrink-0"
            >
              {analyseMutation.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Analysing…</>
                : <><BrainCircuit className="w-4 h-4" /> Analyse</>
              }
            </Button>
          </div>
          {analyseMutation.isPending && (
            <div className="mt-6 rounded-xl bg-primary/5 border border-primary/20 p-4 text-sm text-muted-foreground flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0" />
              <span>Fetching the website and generating your ESG setup guide… This takes about 15–20 seconds.</span>
            </div>
          )}
          <div className="mt-8 grid sm:grid-cols-3 gap-4 text-sm">
            {[
              { icon: BrainCircuit, title: "Reads the website", body: "Extracts business activities, industry, and scale to tailor the guide." },
              { icon: ShieldCheck, title: "NZ obligations", body: "Identifies which NZ reporting obligations apply (ETS, H&S Act, XRB, Toitū)." },
              { icon: Sparkles, title: "Module priorities", body: "Orders every EnviroIQ module from essential to optional for this business." },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-xl border border-border p-4">
                <Icon className="w-5 h-5 text-primary mb-2" />
                <p className="font-semibold text-foreground mb-1">{title}</p>
                <p className="text-muted-foreground text-xs leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ════════════ STEP 2: Review AI recommendations ════════════════════ */}
      {step === 2 && analysis && (
        <div className="space-y-6">
          {/* Business summary */}
          <Card className="p-6 border-primary/20 bg-primary/3">
            <div className="flex gap-4">
              <div className="p-2.5 rounded-xl bg-primary/10 shrink-0 h-fit">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                  <h2 className="text-xl font-bold text-foreground">{analysis.businessName}</h2>
                  <div className="flex flex-wrap gap-2">
                    <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">{analysis.industry}</span>
                    <span className="text-xs px-2.5 py-1 rounded-full bg-muted border border-border text-muted-foreground font-medium">{SIZE_LABEL[analysis.size] ?? analysis.size}</span>
                  </div>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">{analysis.businessSummary}</p>
                <div className="flex flex-wrap gap-2">
                  {analysis.primaryActivities?.map((a, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-muted border border-border text-foreground">{a}</span>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          {/* ESG weighting */}
          <Card className="p-5">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              ESG Focus Weighting
            </h3>
            <div className="space-y-3">
              {[
                { label: "Environmental", value: analysis.esgWeighting.environmental, color: "bg-emerald-500" },
                { label: "Social", value: analysis.esgWeighting.social, color: "bg-blue-500" },
                { label: "Governance", value: analysis.esgWeighting.governance, color: "bg-purple-500" },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-semibold text-foreground">{value}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{analysis.esgWeighting.reasoning}</p>
          </Card>

          {/* Module recommendations */}
          <Card className="p-5">
            <h3 className="font-semibold text-foreground mb-5 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-primary" />
              Recommended Module Setup
            </h3>
            {[
              { label: "Essential — set up immediately", modules: essential, dotColor: "bg-red-500" },
              { label: "Recommended — set up in first month", modules: recommended, dotColor: "bg-amber-500" },
              { label: "Optional — add when ready", modules: optional, dotColor: "bg-slate-400" },
            ].map(({ label, modules, dotColor }) => modules.length > 0 && (
              <div key={label} className="mb-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  {modules.map(mod => {
                    const meta = MODULE_META[mod.key];
                    const Icon = meta?.icon ?? Building2;
                    return (
                      <div key={mod.key} className="rounded-xl border border-border p-4 bg-background hover:bg-muted/30 transition-colors">
                        <div className="flex items-center gap-3 mb-2">
                          <div className={`p-2 rounded-lg border shrink-0 ${meta?.color ?? "bg-muted border-border text-foreground"}`}>
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <p className="font-semibold text-sm text-foreground truncate">{mod.name}</p>
                            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 ${PRIORITY_COLOR[mod.priority]}`}>
                              {mod.priority}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">{mod.reason}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </Card>

          {/* NZ Reporting obligations */}
          <Card className="p-5">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              NZ Reporting Obligations
            </h3>
            <div className="space-y-3">
              {analysis.reportingObligations?.map((ob, i) => (
                <div key={i} className={`rounded-xl border p-3 ${ob.applies ? "border-border bg-background" : "border-border/50 bg-muted/20 opacity-70"}`}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-sm font-semibold text-foreground">{ob.name}</p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {ob.applies
                        ? <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${ob.urgency === "immediate" ? "bg-red-100 text-red-700 border-red-200" : ob.urgency === "this_year" ? "bg-amber-100 text-amber-700 border-amber-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}>
                            {ob.urgency === "immediate" ? "Immediate" : ob.urgency === "this_year" ? "This year" : "Voluntary"}
                          </span>
                        : <span className="text-xs px-2 py-0.5 rounded-full border bg-slate-100 text-slate-400 border-slate-200">Not applicable</span>
                      }
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{ob.description}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* Prioritised setup order */}
          {analysis.setupOrder?.length > 0 && (
            <Card className="p-5">
              <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                Recommended Setup Order
              </h3>
              <div className="space-y-3">
                {analysis.setupOrder.map((s, i) => {
                  const meta = MODULE_META[s.module];
                  const Icon = meta?.icon ?? Building2;
                  return (
                    <div key={i} className="flex gap-4 items-start">
                      <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0 mt-0.5">
                        {s.step}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-sm font-semibold text-foreground">{s.title}</p>
                          <span className="text-xs text-muted-foreground">· {s.estimatedTime}</span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">{s.description}</p>
                      </div>
                      {meta && (
                        <div className={`p-1.5 rounded-lg border shrink-0 ${meta.color}`}>
                          <Icon className="w-3 h-3" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* First-year goal + procurement advantage */}
          <div className="grid sm:grid-cols-2 gap-4">
            <Card className="p-5 border-emerald-200 bg-emerald-50/50">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <p className="text-sm font-semibold text-emerald-800">First-year ESG goal</p>
              </div>
              <p className="text-sm text-emerald-700 leading-relaxed">{analysis.firstYearGoal}</p>
            </Card>
            <Card className="p-5 border-blue-200 bg-blue-50/50">
              <div className="flex items-center gap-2 mb-2">
                <ExternalLink className="w-4 h-4 text-blue-600" />
                <p className="text-sm font-semibold text-blue-800">NZ procurement advantage</p>
              </div>
              <p className="text-sm text-blue-700 leading-relaxed">{analysis.nzProcurementAdvantage}</p>
            </Card>
          </div>

          {/* CTA */}
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)} className="gap-2">
              <ChevronLeft className="w-4 h-4" /> Back
            </Button>
            <Button onClick={() => setStep(3)} className="gap-2">
              Create this organisation <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ════════════ STEP 3: Create organisation ══════════════════════════ */}
      {step === 3 && analysis && (
        <Card className="p-8">
          <div className="flex items-center gap-2 mb-6">
            <Building2 className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Create the organisation</h2>
          </div>
          <p className="text-muted-foreground text-sm mb-6">
            The AI has pre-filled the name and industry. Enter the admin's details and confirm.
            The setup guide will be saved to the organisation for the admin to follow when they first log in.
          </p>

          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Organisation name *</label>
                <Input
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Acme Logistics Ltd"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Industry</label>
                <Input
                  value={form.industry}
                  onChange={e => setForm(p => ({ ...p, industry: e.target.value }))}
                  placeholder="Road Freight & Logistics"
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Country</label>
              <Input
                value={form.country}
                onChange={e => setForm(p => ({ ...p, country: e.target.value }))}
                placeholder="NZ"
                className="max-w-[120px]"
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Admin full name *</label>
                <Input
                  value={form.adminName}
                  onChange={e => setForm(p => ({ ...p, adminName: e.target.value }))}
                  placeholder="Jane Smith"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Admin email *</label>
                <Input
                  type="email"
                  value={form.adminEmail}
                  onChange={e => setForm(p => ({ ...p, adminEmail: e.target.value }))}
                  placeholder="jane@acmelogistics.co.nz"
                />
              </div>
            </div>
          </div>

          {/* Summary of what will be created */}
          <div className="mt-6 rounded-xl bg-muted/50 border border-border p-4 text-sm space-y-2">
            <p className="font-semibold text-foreground">What happens when you click Create:</p>
            <ul className="space-y-1 text-muted-foreground">
              <li className="flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> Organisation created with slug + widget key</li>
              <li className="flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> Admin account created and invite email sent</li>
              <li className="flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> AI-generated setup guide saved to the organisation</li>
              <li className="flex items-center gap-2"><CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> {essential.length} essential + {recommended.length} recommended modules identified</li>
            </ul>
          </div>

          <div className="flex justify-between mt-6">
            <Button variant="outline" onClick={() => setStep(2)} className="gap-2">
              <ChevronLeft className="w-4 h-4" /> Back to guide
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!form.name || !form.adminEmail || !form.adminName || createMutation.isPending}
              className="gap-2"
            >
              {createMutation.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</>
                : <><Building2 className="w-4 h-4" /> Create organisation</>
              }
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
