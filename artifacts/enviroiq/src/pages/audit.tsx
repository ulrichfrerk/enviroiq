import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useListAuditLogs } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Shield, Loader2, CheckCircle, XCircle, Filter, X, History } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";

const outcomeBadge = (outcome: string) => {
  if (outcome === "success") return "bg-emerald-500/10 text-emerald-400";
  if (outcome === "failure") return "bg-destructive/10 text-destructive";
  return "bg-secondary text-muted-foreground";
};

export default function Audit() {
  const { session } = useAuth();
  const orgId = session?.organisationId;

  const { data: logs, isLoading } = useListAuditLogs(orgId!, undefined, { query: { enabled: !!orgId } });

  const [actionFilter, setActionFilter] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("action") ?? "";
  });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [outcome, setOutcome] = useState<"all" | "success" | "failure">("all");

  const filtered = useMemo(() => {
    const items = logs?.items ?? [];
    const fromTs = from ? new Date(from).getTime() : 0;
    const toTs = to ? new Date(to + "T23:59:59").getTime() : Number.MAX_SAFE_INTEGER;
    const term = actionFilter.trim().toLowerCase();
    return items.filter((l) => {
      const t = new Date(l.createdAt).getTime();
      if (t < fromTs || t > toTs) return false;
      if (outcome !== "all" && l.outcome !== outcome) return false;
      if (term) {
        const hay = `${l.action} ${l.resourceType ?? ""} ${l.userEmail ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [logs, actionFilter, from, to, outcome]);

  const clearFilters = () => { setActionFilter(""); setFrom(""); setTo(""); setOutcome("all"); };
  const hasFilters = actionFilter || from || to || outcome !== "all";

  if (isLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-8 pb-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Audit Log</h1>
        <p className="text-muted-foreground mt-1">
          Complete record of all actions taken in your organisation. Immutable for SOC 2 compliance.
        </p>
      </div>

      <Card className="p-4 bg-primary/5 border-primary/20">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-primary mt-0.5 shrink-0" />
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">SOC 2 Audit Trail</span> — All create, update, and delete operations are logged with user, timestamp, and IP address. Log entries are immutable.
          </div>
        </div>
      </Card>

      <Card className="p-4 border-border/50">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Filters</span>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="ml-auto h-7 text-xs">
              <X className="w-3 h-3 mr-1" /> Clear
            </Button>
          )}
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <Label htmlFor="action" className="text-xs text-muted-foreground mb-1.5">Action / user / resource</Label>
            <Input id="action" placeholder="e.g. fleet.event_created" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="from" className="text-xs text-muted-foreground mb-1.5">From</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="to" className="text-xs text-muted-foreground mb-1.5">To</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="outcome" className="text-xs text-muted-foreground mb-1.5">Outcome</Label>
            <select
              id="outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as "all" | "success" | "failure")}
              className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
            >
              <option value="all">All</option>
              <option value="success">Success only</option>
              <option value="failure">Failure only</option>
            </select>
          </div>
        </div>
      </Card>

      <Card className="border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary/30 text-muted-foreground uppercase text-xs font-semibold">
              <tr>
                <th className="px-6 py-4">Timestamp</th>
                <th className="px-6 py-4">Action</th>
                <th className="px-6 py-4">User</th>
                <th className="px-6 py-4">Resource</th>
                <th className="px-6 py-4">Outcome</th>
                <th className="px-6 py-4">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filtered.map((log) => (
                <tr key={log.id} className="hover:bg-secondary/20 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {format(new Date(log.createdAt), "MMM d, HH:mm:ss")}
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-medium text-foreground font-mono text-xs bg-secondary px-2 py-1 rounded">
                      {log.action}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">{log.userEmail || log.userId || "—"}</td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {log.resourceType ? (
                      <span>
                        <span className="capitalize">{log.resourceType}</span>
                        {log.resourceId && <span className="font-mono text-xs ml-1 opacity-60">{log.resourceId.substring(0, 8)}…</span>}
                      </span>
                    ) : "—"}
                    {log.action === "user.sign_in_policy.changed" && log.resourceId && (
                      <Link
                        href={(() => {
                          const params = new URLSearchParams({ signInUserId: log.resourceId });
                          // Include the audit row's org so the Users page can detect a
                          // cross-org deep-link (e.g. from the super-admin global view)
                          // and surface a clear error instead of silently looking the
                          // user up in the wrong tenant's directory.
                          if (log.organisationId) params.set("signInOrgId", log.organisationId);
                          return `/users?${params.toString()}`;
                        })()}
                        className="ml-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        data-testid={`link-sign-in-history-${log.id}`}
                        title="View this user's sign-in restriction history"
                      >
                        <History className="w-3 h-3" />
                        Why?
                      </Link>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1 w-fit ${outcomeBadge(log.outcome)}`}>
                      {log.outcome === "success"
                        ? <CheckCircle className="w-3 h-3" />
                        : <XCircle className="w-3 h-3" />}
                      {log.outcome}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-muted-foreground">{log.ipAddress || "—"}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                    {hasFilters ? "No audit events match the current filters." : "No audit events recorded yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {logs?.total != null && logs.total > 0 && (
          <div className="px-6 py-3 border-t border-border/50 bg-secondary/10 text-xs text-muted-foreground">
            Showing {filtered.length} of {logs.total} total events{hasFilters ? " (filtered)" : ""}
          </div>
        )}
      </Card>
    </div>
  );
}
