import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Shield, Loader2, Save, CheckCircle2, XCircle, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface GovernanceSnapshot {
  id?: string;
  periodYear: number;
  boardSize?: number | null;
  boardIndependentCount?: number | null;
  boardFemaleCount?: number | null;
  boardMeetingsPerYear?: number | null;
  hasAuditCommittee?: boolean;
  hasCodeOfConduct?: boolean;
  hasWhistleblower?: boolean;
  hasAntiBribery?: boolean;
  hasPrivacyPolicy?: boolean;
  hasCyberFramework?: boolean;
  hasEsgRiskRegister?: boolean;
  hasTcfdAligned?: boolean;
  hasExternalAssurance?: boolean;
  hasModernSlaveryPolicy?: boolean;
  frameworkAlignment?: string | null;
  notes?: string | null;
}

const FRAMEWORK_OPTIONS = ["GRI Standards", "SASB", "TCFD", "Toitū CEMARS", "ISO 14001", "B Corp", "UN SDGs"];

const POLICIES = [
  {
    key: "hasCodeOfConduct" as const,
    label: "Code of Conduct",
    description: "Documented ethical standards for all staff",
  },
  {
    key: "hasWhistleblower" as const,
    label: "Whistleblower / Speak-up Policy",
    description: "Protected disclosure channel for staff concerns",
  },
  {
    key: "hasAntiBribery" as const,
    label: "Anti-bribery & Corruption Policy",
    description: "Zero tolerance policy documented and communicated",
  },
  {
    key: "hasPrivacyPolicy" as const,
    label: "Privacy Policy (NZ Privacy Act 2020)",
    description: "Data collection, use and retention policy in place",
  },
  {
    key: "hasCyberFramework" as const,
    label: "Cyber Security Framework",
    description: "ISO 27001, NZISM or equivalent in place",
  },
  {
    key: "hasEsgRiskRegister" as const,
    label: "ESG Risk Register",
    description: "Documented ESG-specific risks and controls",
  },
  {
    key: "hasTcfdAligned" as const,
    label: "Climate-related Financial Disclosures (TCFD)",
    description: "Aligned to TCFD / NZ mandatory climate reporting",
  },
  {
    key: "hasExternalAssurance" as const,
    label: "External Assurance",
    description: "ESG data verified by an independent third party",
  },
  {
    key: "hasModernSlaveryPolicy" as const,
    label: "Modern Slavery Policy",
    description: "Supply chain human rights due diligence policy",
  },
  {
    key: "hasAuditCommittee" as const,
    label: "Audit Committee",
    description: "Independent audit committee in place",
  },
];

function numField(val: number | null | undefined): string {
  return val == null ? "" : String(val);
}
function parseIntOrNull(val: string): number | null {
  const n = parseInt(val);
  return isNaN(n) ? null : n;
}

export default function Governance() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const { toast } = useToast();
  const qc = useQueryClient();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  const { data: snapshot, isLoading } = useQuery<GovernanceSnapshot | null>({
    queryKey: ["governance", orgId, year],
    queryFn: async () => {
      const r = await fetch(`/api/organisations/${orgId}/governance?year=${year}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!orgId,
  });

  const [draft, setDraft] = useState<GovernanceSnapshot | null>(null);
  const active: GovernanceSnapshot = draft ?? (snapshot ?? { periodYear: year });

  function set(field: keyof GovernanceSnapshot, value: unknown) {
    setDraft((prev) => ({ ...(prev ?? active), [field]: value }));
  }

  const save = useMutation({
    mutationFn: async (data: GovernanceSnapshot) => {
      const r = await fetch(`/api/organisations/${orgId}/governance`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, periodYear: year }),
      });
      if (!r.ok) throw new Error("Save failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["governance", orgId, year] });
      setDraft(null);
      toast({ title: "Governance data saved" });
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  // Score: count policies in place
  const policyKeys = POLICIES.map((p) => p.key);
  const inPlaceCount = policyKeys.filter((k) => active[k]).length;
  const scorePct = Math.round((inPlaceCount / policyKeys.length) * 100);

  const boardIndependentPct =
    active.boardSize && active.boardSize > 0 && active.boardIndependentCount != null
      ? Math.round((active.boardIndependentCount / active.boardSize) * 100)
      : null;
  const boardFemalePct =
    active.boardSize && active.boardSize > 0 && active.boardFemaleCount != null
      ? Math.round((active.boardFemaleCount / active.boardSize) * 100)
      : null;

  const selectedFrameworks = active.frameworkAlignment
    ? active.frameworkAlignment.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  function toggleFramework(fw: string) {
    const next = selectedFrameworks.includes(fw)
      ? selectedFrameworks.filter((f) => f !== fw)
      : [...selectedFrameworks, fw];
    set("frameworkAlignment", next.join(", ") || null);
    if (!draft) setDraft({ ...active, frameworkAlignment: next.join(", ") || null });
  }

  if (isLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="animate-spin w-4 h-4" />Loading…
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" /> Governance
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Board structure, policies, risk and framework alignment
          </p>
        </div>
        <Select value={String(year)} onValueChange={(v) => { setYear(parseInt(v)); setDraft(null); }}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Array.from({ length: 5 }, (_, i) => currentYear - i).map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Board Size</p>
            <p className="text-2xl font-bold text-foreground mt-1">{active.boardSize ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Independence</p>
            <p className="text-2xl font-bold text-foreground mt-1">
              {boardIndependentPct != null ? `${boardIndependentPct}%` : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Board Female %</p>
            <p className="text-2xl font-bold text-foreground mt-1">
              {boardFemalePct != null ? `${boardFemalePct}%` : "—"}
            </p>
          </CardContent>
        </Card>
        <Card className={scorePct >= 70 ? "border-green-500/40" : scorePct >= 40 ? "border-yellow-500/40" : "border-red-500/40"}>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Policy Score</p>
            <p className={`text-2xl font-bold mt-1 ${scorePct >= 70 ? "text-green-600" : scorePct >= 40 ? "text-yellow-600" : "text-red-600"}`}>
              {inPlaceCount}/{policyKeys.length}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Board Composition */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="w-4 h-4 text-muted-foreground" />Board &amp; Structure
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Board size (directors)", field: "boardSize" as const },
              { label: "Independent directors", field: "boardIndependentCount" as const },
              { label: "Female directors", field: "boardFemaleCount" as const },
              { label: "Board meetings per year", field: "boardMeetingsPerYear" as const },
            ].map(({ label, field }) => (
              <div key={field} className="grid grid-cols-2 items-center gap-2">
                <Label className="text-sm">{label}</Label>
                <Input
                  type="number"
                  min="0"
                  value={numField(active[field] as number | null | undefined)}
                  onChange={(e) => set(field, parseIntOrNull(e.target.value))}
                  placeholder="—"
                />
              </div>
            ))}
            {boardIndependentPct != null && (
              <p className="text-xs text-muted-foreground">
                {boardIndependentPct}% independent directors
                {boardFemalePct != null && ` · ${boardFemalePct}% female`}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Framework Alignment */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Reporting Framework Alignment</CardTitle>
            <CardDescription className="text-xs">Select all frameworks this organisation reports against</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {FRAMEWORK_OPTIONS.map((fw) => {
                const active_ = selectedFrameworks.includes(fw);
                return (
                  <button
                    key={fw}
                    onClick={() => toggleFramework(fw)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      active_
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/50 text-muted-foreground border-border hover:border-primary/50"
                    }`}
                  >
                    {active_ && <span className="mr-1">✓</span>}
                    {fw}
                  </button>
                );
              })}
            </div>
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground">Other frameworks (comma-separated)</Label>
              <Input
                className="mt-1 text-sm"
                placeholder="e.g. IIRC, AccountAbility AA1000"
                value={active.frameworkAlignment ?? ""}
                onChange={(e) => set("frameworkAlignment", e.target.value || null)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Policies checklist */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="w-4 h-4 text-muted-foreground" />Policies &amp; Compliance
            </CardTitle>
            <CardDescription className="text-xs">
              {inPlaceCount} of {policyKeys.length} policies in place
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Progress bar */}
            <div className="w-full h-2 bg-muted rounded-full mb-4 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  scorePct >= 70 ? "bg-green-500" : scorePct >= 40 ? "bg-yellow-500" : "bg-red-500"
                }`}
                style={{ width: `${scorePct}%` }}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {POLICIES.map((policy) => {
                const value = active[policy.key] ?? false;
                return (
                  <div
                    key={policy.key}
                    className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                      value ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-900/40" : "bg-muted/30 border-border"
                    }`}
                  >
                    <div className="mt-0.5 flex-shrink-0">
                      {value ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                      ) : (
                        <XCircle className="w-4 h-4 text-muted-foreground/50" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${value ? "text-green-800 dark:text-green-300" : "text-foreground"}`}>
                        {policy.label}
                      </p>
                      <p className="text-xs text-muted-foreground">{policy.description}</p>
                    </div>
                    <Switch
                      checked={value}
                      onCheckedChange={(v) => set(policy.key, v)}
                      className="flex-shrink-0"
                    />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Notes */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              className="min-h-[100px]"
              placeholder="Additional governance context, planned improvements, or audit notes for this reporting period…"
              value={active.notes ?? ""}
              onChange={(e) => set("notes", e.target.value || null)}
            />
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate(active)} disabled={save.isPending || !draft}>
          {save.isPending ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : <Save className="w-4 h-4 mr-2" />}
          Save Governance Data
        </Button>
      </div>
    </div>
  );
}
