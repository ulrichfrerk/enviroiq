import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, ShieldCheck, Building2, AlertTriangle, Send, FileText, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";

interface Summary {
  total: number; active: number; critical: number; avgScore: number;
  compliantPct: number; overdue: number; dueSoon: number;
  riskCounts: { low: number; medium: number; high: number; unrated: number };
  auditsByStatus: { draft: number; sent: number; in_progress: number; submitted: number; approved: number; expired: number };
  top: Array<{ id: string; legalName: string; score: number | null; risk: string | null }>;
  bottom: Array<{ id: string; legalName: string; score: number | null; risk: string | null }>;
  suppliers: Array<{ id: string; legalName: string; riskTag: string; isCritical: boolean; status: string; latestEsgScore: number | null; latestRiskLevel: string | null; lastAuditAt: string | null; nextAuditDueAt: string | null }>;
}

function riskClasses(r?: string | null) {
  if (r === "low") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40";
  if (r === "medium") return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40";
  if (r === "high") return "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40";
  return "bg-muted text-muted-foreground border-border";
}

export default function SupplierReportsPage() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const { data, isLoading } = useQuery<Summary>({
    queryKey: ["supplier-reports", orgId],
    queryFn: () => apiClient(`/organisations/${orgId}/supplier-reports/summary`),
    enabled: !!orgId,
  });

  const downloadPdf = async () => {
    try {
      const res = await fetch(`/api/organisations/${orgId}/supplier-reports/pdf`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `supplier-esg-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Report downloaded");
    } catch (e) { toast.error((e as Error).message || "Download failed"); }
  };

  if (isLoading || !data) {
    return <div className="flex items-center justify-center py-32 text-muted-foreground">Loading supplier insights…</div>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Supplier ESG Report</h1>
          <p className="text-muted-foreground mt-1">Programme-wide assurance view of every supplier and audit cycle.</p>
        </div>
        <Button onClick={downloadPdf} data-testid="button-download-pdf">
          <Download className="h-4 w-4 mr-2" /> Download board PDF
        </Button>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<Building2 className="h-5 w-5 text-primary" />} label="Suppliers" value={data.total} />
        <Kpi icon={<AlertTriangle className="h-5 w-5 text-rose-500" />} label="Critical" value={data.critical} />
        <Kpi icon={<TrendingUp className="h-5 w-5 text-emerald-500" />} label="Avg ESG score" value={data.avgScore} />
        <Kpi icon={<ShieldCheck className="h-5 w-5 text-emerald-500" />} label="≥ 80 score" value={`${data.compliantPct}%`} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold mb-3">Risk heat-map</h2>
          <div className="grid grid-cols-4 gap-2">
            <RiskCell value={data.riskCounts.low} label="Low" cls="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" />
            <RiskCell value={data.riskCounts.medium} label="Medium" cls="bg-amber-500/15 text-amber-700 dark:text-amber-300" />
            <RiskCell value={data.riskCounts.high} label="High" cls="bg-rose-500/15 text-rose-700 dark:text-rose-300" />
            <RiskCell value={data.riskCounts.unrated} label="Unrated" cls="bg-muted text-muted-foreground" />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold mb-3">Audits in flight</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Row label="Sent / open" value={data.auditsByStatus.sent + data.auditsByStatus.in_progress} />
            <Row label="Submitted" value={data.auditsByStatus.submitted} />
            <Row label="Approved" value={data.auditsByStatus.approved} />
            <Row label="Expired" value={data.auditsByStatus.expired} />
            <Row label="Overdue" value={data.overdue} accent="rose" />
            <Row label="Due in 30 days" value={data.dueSoon} accent="amber" />
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <RankedList title="Top performers" suppliers={data.top} icon={<TrendingUp className="h-4 w-4 text-emerald-500" />} />
        <RankedList title="Needs attention" suppliers={data.bottom} icon={<TrendingDown className="h-4 w-4 text-rose-500" />} />
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <header className="px-5 py-3 border-b border-border bg-muted/40 flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">Full supplier register</h2>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                <th className="text-left px-4 py-2">Supplier</th>
                <th className="text-left px-4 py-2">Risk tag</th>
                <th className="text-left px-4 py-2">Score</th>
                <th className="text-left px-4 py-2">Risk level</th>
                <th className="text-left px-4 py-2">Last audit</th>
                <th className="text-left px-4 py-2">Next due</th>
              </tr>
            </thead>
            <tbody>
              {data.suppliers.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No suppliers registered yet.</td></tr>
              )}
              {data.suppliers.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    <div className="font-medium">{s.legalName}</div>
                    {s.isCritical && <Badge className="mt-0.5 bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40 text-[10px]">Critical</Badge>}
                  </td>
                  <td className="px-4 py-2"><Badge variant="outline" className={`capitalize ${riskClasses(s.riskTag)}`}>{s.riskTag}</Badge></td>
                  <td className="px-4 py-2 font-semibold">{s.latestEsgScore ?? "—"}</td>
                  <td className="px-4 py-2"><Badge variant="outline" className={`capitalize ${riskClasses(s.latestRiskLevel)}`}>{s.latestRiskLevel ?? "—"}</Badge></td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{s.lastAuditAt ? new Date(s.lastAuditAt).toLocaleDateString("en-NZ") : "Never"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{s.nextAuditDueAt ? new Date(s.nextAuditDueAt).toLocaleDateString("en-NZ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>{icon}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function RiskCell({ value, label, cls }: { value: number; label: string; cls: string }) {
  return (
    <div className={`rounded-lg p-4 text-center ${cls}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide opacity-80">{label}</div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: number; accent?: "rose" | "amber" }) {
  const accentCls = accent === "rose" ? "text-rose-600" : accent === "amber" ? "text-amber-600" : "";
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right font-semibold ${accentCls}`}>{value}</span>
    </>
  );
}

function RankedList({ title, suppliers, icon }: { title: string; suppliers: Array<{ id: string; legalName: string; score: number | null; risk: string | null }>; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-semibold mb-3 flex items-center gap-2">{icon}{title}</h2>
      {suppliers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No scored suppliers yet.</p>
      ) : (
        <ol className="space-y-2 text-sm">
          {suppliers.map((s) => (
            <li key={s.id} className="flex items-center justify-between border-b border-border pb-2 last:border-b-0 last:pb-0">
              <span className="font-medium">{s.legalName}</span>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={`capitalize ${riskClasses(s.risk)}`}>{s.risk ?? "—"}</Badge>
                <span className="font-bold w-8 text-right">{s.score ?? "—"}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
