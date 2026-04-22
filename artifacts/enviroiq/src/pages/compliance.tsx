import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api";
import {
  ShieldCheck, Download, CheckCircle2, Lock, Database, GitBranch,
  Users, Server, AlertCircle, FileSearch, Loader2, Hash, Globe,
} from "lucide-react";

type ComplianceSummary = {
  organisation: { id: string; name: string; requireMfa: boolean; dataResidency: string };
  audit: { total: number; last30d: number };
  controls: Record<string, boolean>;
};

const controlMeta: Record<string, { title: string; desc: string; icon: React.ComponentType<{ className?: string }> }> = {
  immutable_audit_log:        { title: "Immutable Audit Log",        desc: "Append-only event log with user, timestamp, IP, and before/after values.", icon: ShieldCheck },
  rbac_enabled:               { title: "Role-Based Access Control",  desc: "Super Admin, Org Admin, Org User, Org Viewer, Org Auditor.",                icon: Users },
  passwordless_auth:          { title: "Passwordless Authentication",desc: "WebAuthn / passkeys via device biometrics.",                                 icon: Lock },
  tenant_isolation:           { title: "Tenant Isolation",           desc: "Every query is scoped by organisation_id at the database layer.",            icon: Server },
  encryption_at_rest:         { title: "Encryption at Rest",         desc: "AES-256 on the database and all customer file storage.",                     icon: Database },
  encryption_in_transit:      { title: "Encryption in Transit",      desc: "TLS 1.3 for every customer connection.",                                     icon: Lock },
  versioned_emission_factors: { title: "Versioned Emission Factors", desc: "Every factor stamped with a version + effective date.",                      icon: GitBranch },
  data_lineage_tracking:      { title: "Data Lineage Tracking",      desc: "Every metric links back to source data + factor version + ingest batch.",     icon: FileSearch },
  mfa_enforcement:            { title: "MFA Enforcement",            desc: "Org-level toggle requiring MFA for every member.",                            icon: ShieldCheck },
};

export default function Compliance() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) {
      // Super admins (and anyone else without an organisation context) shouldn't
      // sit on a perpetual spinner — clear loading and let the no-org UI render.
      setLoading(false);
      return;
    }
    setLoading(true);
    apiClient(`/organisations/${orgId}/compliance/summary`)
      .then((d) => setSummary(d as ComplianceSummary))
      .catch(() => setError("Failed to load compliance summary"))
      .finally(() => setLoading(false));
  }, [orgId]);

  const downloadEvidencePack = async () => {
    if (!orgId) return;
    setExporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/organisations/${orgId}/compliance/evidence-pack`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: new Date(from).toISOString(), to: new Date(to + "T23:59:59").toISOString() }),
      });
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const cd = res.headers.get("content-disposition") || "";
      const m = cd.match(/filename="?([^";]+)"?/);
      a.href = url;
      a.download = m?.[1] ?? `enviroiq-evidence-${from}-to-${to}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (!orgId) {
    return (
      <div className="space-y-8 pb-10">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Compliance & Evidence</h1>
          <p className="text-muted-foreground mt-1">
            Trust controls, audit posture, and one-click evidence pack export for SOC 2, ISO 27001, and external audit review.
          </p>
        </div>
        <Card className="p-8 text-center">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
          <h2 className="text-lg font-semibold text-foreground mb-1">No organisation selected</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Compliance posture and evidence packs are scoped to a specific organisation.
            Sign in as a member of an organisation, or use the Admin console to act on behalf of one.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Compliance & Evidence</h1>
        <p className="text-muted-foreground mt-1">
          Trust controls, audit posture, and one-click evidence pack export for SOC 2, ISO 27001, and external audit review.
        </p>
      </div>

      {/* ── Posture summary ─────────────────────────────────────────────── */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 bg-emerald-500/5 border-emerald-500/20">
          <div className="flex items-center gap-3 mb-2">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            <span className="text-xs font-mono uppercase text-emerald-600 font-bold">Audit Events</span>
          </div>
          <div className="text-3xl font-bold text-foreground">{summary?.audit.total ?? 0}</div>
          <div className="text-xs text-muted-foreground mt-1">{summary?.audit.last30d ?? 0} in last 30 days</div>
        </Card>
        <Card className="p-5 bg-primary/5 border-primary/20">
          <div className="flex items-center gap-3 mb-2">
            <Globe className="w-5 h-5 text-primary" />
            <span className="text-xs font-mono uppercase text-primary font-bold">Data Residency</span>
          </div>
          <div className="text-3xl font-bold text-foreground">{summary?.organisation.dataResidency ?? "NZ"}</div>
          <div className="text-xs text-muted-foreground mt-1">Sovereign storage</div>
        </Card>
        <Card className="p-5 bg-card border-border">
          <div className="flex items-center gap-3 mb-2">
            <Lock className="w-5 h-5 text-foreground" />
            <span className="text-xs font-mono uppercase text-muted-foreground font-bold">MFA Enforcement</span>
          </div>
          <div className="text-3xl font-bold text-foreground">
            {summary?.organisation.requireMfa ? "ON" : "OFF"}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {summary?.organisation.requireMfa ? "Required for all users" : "Passkey optional"}
          </div>
        </Card>
        <Card className="p-5 bg-card border-border">
          <div className="flex items-center gap-3 mb-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <span className="text-xs font-mono uppercase text-muted-foreground font-bold">Controls Active</span>
          </div>
          <div className="text-3xl font-bold text-foreground">
            {summary ? Object.values(summary.controls).filter(Boolean).length : 0}/{summary ? Object.keys(summary.controls).length : 9}
          </div>
          <div className="text-xs text-muted-foreground mt-1">SOC 2 control mapping</div>
        </Card>
      </div>

      {/* ── Evidence pack export ────────────────────────────────────────── */}
      <Card className="p-6 bg-gradient-to-br from-primary/5 to-emerald-500/5 border-primary/20">
        <div className="flex items-start gap-4 mb-6">
          <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
            <Download className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground mb-1">Evidence Pack Export</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Generate a cryptographically-hashed ZIP containing every audit log entry, every fleet event with the emission factor version applied, every energy reading, and a SHA-256 manifest. Suitable as evidence for SOC 2, ISO 27001, or external audit review.
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 items-end">
          <div>
            <Label htmlFor="from" className="text-xs text-muted-foreground mb-1.5">From date</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="to" className="text-xs text-muted-foreground mb-1.5">To date</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button onClick={downloadEvidencePack} disabled={exporting} className="bg-primary hover:bg-primary/90">
            {exporting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating…</> : <><Download className="w-4 h-4 mr-2" />Download ZIP</>}
          </Button>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded bg-destructive/10 border border-destructive/30 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs text-muted-foreground">
          {["manifest.json", "audit_logs.csv", "fleet_events.csv", "energy_readings.csv", "emission_factors_used.csv"].map((f) => (
            <div key={f} className="flex items-center gap-2 font-mono">
              <Hash className="w-3 h-3 text-primary shrink-0" /> {f}
            </div>
          ))}
        </div>
      </Card>

      {/* ── Active controls ─────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-bold text-foreground mb-4">Active Controls</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {summary && Object.entries(summary.controls).map(([key, active]) => {
            const meta = controlMeta[key] ?? { title: key, desc: "", icon: ShieldCheck };
            const Icon = meta.icon;
            return (
              <Card key={key} className={`p-4 border ${active ? "bg-emerald-500/5 border-emerald-500/20" : "bg-muted/30 border-border opacity-60"}`}>
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-emerald-500/15" : "bg-muted"}`}>
                    <Icon className={`w-4 h-4 ${active ? "text-emerald-500" : "text-muted-foreground"}`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-sm text-foreground">{meta.title}</h3>
                      {active ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : null}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{meta.desc}</p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
