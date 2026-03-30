import { useAuth } from "@/hooks/use-auth";
import { useListAuditLogs } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Shield, Loader2, CheckCircle, XCircle } from "lucide-react";
import { format } from "date-fns";

const outcomeBadge = (outcome: string) => {
  if (outcome === "success") return "bg-emerald-500/10 text-emerald-400";
  if (outcome === "failure") return "bg-destructive/10 text-destructive";
  return "bg-secondary text-muted-foreground";
};

export default function Audit() {
  const { session } = useAuth();
  const orgId = session?.organisationId;

  const { data: logs, isLoading } = useListAuditLogs(orgId!, undefined, { query: { enabled: !!orgId } });

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
              {logs?.items.map((log) => (
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
              {(!logs?.items || logs.items.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                    No audit events recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {logs?.total && logs.total > 0 && (
          <div className="px-6 py-3 border-t border-border/50 bg-secondary/10 text-xs text-muted-foreground">
            Showing {logs.items.length} of {logs.total} total events
          </div>
        )}
      </Card>
    </div>
  );
}
