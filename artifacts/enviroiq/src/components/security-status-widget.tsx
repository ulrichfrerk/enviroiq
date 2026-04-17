import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Download,
} from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type CheckStatus = "pass" | "warn" | "fail";
type Severity = "critical" | "high" | "medium" | "low";

interface SecurityCheck {
  id: string;
  category:
    | "transport"
    | "auth"
    | "session"
    | "headers"
    | "data"
    | "integration"
    | "audit";
  label: string;
  severity: Severity;
  status: CheckStatus;
  detail: string;
}

interface SecurityStatusResponse {
  generatedAt: string;
  overall: CheckStatus;
  counts: { pass: number; warn: number; fail: number };
  checks: SecurityCheck[];
}

const CATEGORY_LABEL: Record<SecurityCheck["category"], string> = {
  transport: "Transport & TLS",
  auth: "Authentication",
  session: "Sessions",
  headers: "HTTP Headers",
  data: "Data at Rest",
  integration: "Integrations",
  audit: "Audit Logging",
};

function statusIcon(status: CheckStatus) {
  if (status === "pass")
    return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "warn")
    return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  return <XCircle className="h-4 w-4 text-red-500" />;
}

function severityBadge(severity: Severity, status: CheckStatus) {
  // When the check is passing, the severity is informational only ("this is a
  // critical-importance area — and it's covered"). Use a muted style so users
  // don't read a green-pass + red-CRITICAL badge as an alarm.
  if (status === "pass") {
    return (
      <Badge
        variant="outline"
        className="text-[10px] px-1.5 py-0 h-4 font-medium uppercase bg-muted text-muted-foreground border-border"
        title={`${severity} importance — currently passing`}
      >
        {severity}
      </Badge>
    );
  }
  // Only when the check is warn/fail does the severity drive the colour.
  const styles: Record<Severity, string> = {
    critical: "bg-red-500/10 text-red-500 border-red-500/30",
    high: "bg-amber-500/10 text-amber-500 border-amber-500/30",
    medium: "bg-blue-500/10 text-blue-500 border-blue-500/30",
    low: "bg-muted text-muted-foreground border-border",
  };
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] px-1.5 py-0 h-4 font-medium uppercase", styles[severity])}
    >
      {severity}
    </Badge>
  );
}

function overallStyles(status: CheckStatus | undefined) {
  if (status === "pass")
    return {
      Icon: ShieldCheck,
      ring: "ring-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20",
      dot: "bg-emerald-500",
      label: "Secure",
    };
  if (status === "warn")
    return {
      Icon: ShieldAlert,
      ring: "ring-amber-500/40 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20",
      dot: "bg-amber-500",
      label: "Attention",
    };
  if (status === "fail")
    return {
      Icon: ShieldX,
      ring: "ring-red-500/40 bg-red-500/10 text-red-500 hover:bg-red-500/20",
      dot: "bg-red-500",
      label: "Action required",
    };
  return {
    Icon: ShieldCheck,
    ring: "ring-border bg-card text-muted-foreground hover:bg-muted",
    dot: "bg-muted-foreground",
    label: "Checking…",
  };
}

export function SecurityStatusWidget() {
  const [open, setOpen] = useState(false);
  const { session } = useAuth();
  const role = session?.role;
  const isAdmin = role === "super_admin" || role === "org_admin";

  const { data, isLoading, isFetching, refetch, error } =
    useQuery<SecurityStatusResponse>({
      queryKey: ["/api/security/status"],
      queryFn: async () => {
        const res = await fetch("/api/security/status", { credentials: "include" });
        if (!res.ok) throw new Error(`Security status request failed (${res.status})`);
        return (await res.json()) as SecurityStatusResponse;
      },
      enabled: isAdmin,
      refetchInterval: open ? 60_000 : 5 * 60_000,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    });

  if (!isAdmin) return null;

  const overall = data?.overall;
  const styles = overallStyles(overall);
  const Icon = styles.Icon;

  const grouped = (data?.checks ?? []).reduce<
    Record<SecurityCheck["category"], SecurityCheck[]>
  >((acc, c) => {
    (acc[c.category] ||= []).push(c);
    return acc;
  }, {} as Record<SecurityCheck["category"], SecurityCheck[]>);

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            data-testid="security-status-trigger"
            aria-label={`Security status: ${styles.label}`}
            className={cn(
              "h-12 w-12 rounded-full ring-2 shadow-lg shadow-black/20 backdrop-blur-md transition-all",
              styles.ring,
            )}
          >
            <div className="relative">
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Icon className="h-5 w-5" />
              )}
              <span
                className={cn(
                  "absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full ring-2 ring-background",
                  styles.dot,
                )}
              />
            </div>
          </Button>
        </PopoverTrigger>

        <PopoverContent
          side="top"
          align="end"
          sideOffset={8}
          className="w-[380px] p-0 border-border bg-card/95 backdrop-blur-xl"
        >
          <div className="flex items-center justify-between p-4 border-b border-border/60">
            <div className="flex items-center gap-2">
              <Icon className={cn("h-5 w-5", styles.ring.split(" ").find((c) => c.startsWith("text-")))} />
              <div>
                <h3 className="text-sm font-semibold">
                  Security status: {styles.label}
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  {data
                    ? `${data.counts.pass} pass · ${data.counts.warn} warn · ${data.counts.fail} fail`
                    : "Running checks…"}
                </p>
              </div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="security-status-refresh"
              aria-label="Refresh security checks"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isFetching && "animate-spin")}
              />
            </Button>
          </div>

          <ScrollArea className="h-[420px]">
            <div className="p-3 space-y-4">
              {error && (
                <div className="text-sm text-red-500 px-1">
                  Could not load security status. Try refreshing.
                </div>
              )}

              {!error &&
                Object.entries(grouped).map(([category, items]) => (
                  <div key={category}>
                    <div className="text-[11px] font-semibold uppercase text-muted-foreground tracking-wider px-1 mb-1.5">
                      {CATEGORY_LABEL[category as SecurityCheck["category"]] ??
                        category}
                    </div>
                    <div className="space-y-1.5">
                      {items.map((check) => (
                        <div
                          key={check.id}
                          data-testid={`security-check-${check.id}`}
                          className="rounded-md border border-border/60 bg-background/60 p-2.5 hover-elevate"
                        >
                          <div className="flex items-start gap-2">
                            <div className="mt-0.5">{statusIcon(check.status)}</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 mb-0.5">
                                <span className="text-xs font-medium leading-tight">
                                  {check.label}
                                </span>
                                {severityBadge(check.severity)}
                              </div>
                              <p className="text-[11px] leading-snug text-muted-foreground">
                                {check.detail}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </ScrollArea>

          {data && (
            <>
              <div className="px-3 py-2 border-t border-border/60">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full h-8 text-xs"
                  asChild
                  data-testid="security-pack-download"
                >
                  <a href="/api/security/pack.txt" download>
                    <Download className="h-3.5 w-3.5 mr-2" />
                    Download full security pack (admin)
                  </a>
                </Button>
              </div>
              <div className="px-4 py-2 border-t border-border/60 text-[10px] text-muted-foreground flex justify-between">
                <span>Auto-refreshes every 60s</span>
                <span>
                  Last check {new Date(data.generatedAt).toLocaleTimeString()}
                </span>
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
