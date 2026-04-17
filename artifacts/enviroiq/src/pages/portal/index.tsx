import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, LogOut, Loader2, FileText, ExternalLink } from "lucide-react";

interface PortalAudit {
  id: string; status: string; dueAt: string; sentAt?: string; submittedAt?: string;
  esgScore?: number | null; riskLevel?: string | null;
  organisationName: string; supplierName: string;
}

function statusColor(s: string) {
  if (s === "submitted" || s === "approved") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (s === "in_progress") return "bg-blue-500/15 text-blue-700 dark:text-blue-300";
  if (s === "sent") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  if (s === "expired") return "bg-rose-500/15 text-rose-700 dark:text-rose-300";
  return "bg-muted text-muted-foreground";
}

export default function SupplierPortalHome() {
  const [, navigate] = useLocation();
  const [me, setMe] = useState<string | null>(null);
  const [audits, setAudits] = useState<PortalAudit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const meRes = await fetch("/api/portal/me", { credentials: "include" });
        if (!meRes.ok) { navigate("/portal/login"); return; }
        const meData = await meRes.json();
        setMe(meData.email);
        const audRes = await fetch("/api/portal/audits", { credentials: "include" });
        if (audRes.ok) setAudits(await audRes.json());
      } finally { setLoading(false); }
    })();
  }, [navigate]);

  const logout = async () => {
    await fetch("/api/portal/logout", { method: "POST", credentials: "include" });
    navigate("/portal/login");
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <header className="border-b border-border bg-background/80 backdrop-blur">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-7 w-7 text-primary" />
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Supplier portal</div>
              <div className="font-semibold">{me}</div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={logout} data-testid="button-portal-logout">
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Your ESG audits</h1>
          <p className="text-muted-foreground text-sm mt-1">All audits sent to <span className="font-mono">{me}</span>. To open one, use the link from the original invitation email.</p>
        </div>

        {audits.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No audits found for this email yet.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground bg-muted/40">
                <tr>
                  <th className="text-left px-4 py-3">From</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Sent</th>
                  <th className="text-left px-4 py-3">Due</th>
                  <th className="text-left px-4 py-3">Score</th>
                </tr>
              </thead>
              <tbody>
                {audits.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="px-4 py-3 font-medium">{a.organisationName}</td>
                    <td className="px-4 py-3"><Badge variant="outline" className={`capitalize ${statusColor(a.status)}`}>{a.status.replace("_", " ")}</Badge></td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{a.sentAt ? new Date(a.sentAt).toLocaleDateString("en-NZ") : "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(a.dueAt).toLocaleDateString("en-NZ")}</td>
                    <td className="px-4 py-3">{typeof a.esgScore === "number" ? <span className="font-semibold">{a.esgScore}</span> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Need to update something on a submitted audit? Contact the requesting organisation directly — submitted audits are
          locked for record-keeping.
        </p>
      </main>
    </div>
  );
}
