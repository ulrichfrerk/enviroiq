import { useMemo, useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import {
  useListAuditLogs,
  useGetEnergyEmailAddress,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Inbox as InboxIcon,
  Mail,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Paperclip,
  Copy,
  Filter,
  X,
  Bell,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type InboundDetails = {
  from?: string;
  subject?: string;
  emailId?: string;
  attachmentsProcessed?: number;
  readingIds?: string[];
  reason?: string;
  toAddresses?: string[];
  snapshot?: {
    inlineAttachmentCount?: number;
    inlineAttachmentMeta?: Array<{ filename?: string | null; content_type?: string }>;
  };
};

function parseDetails(d: unknown): InboundDetails {
  if (!d) return {};
  if (typeof d === "string") {
    try { return JSON.parse(d) as InboundDetails; } catch { return {}; }
  }
  if (typeof d === "object") return d as InboundDetails;
  return {};
}

function statusFor(d: InboundDetails, outcome: string): {
  label: string;
  tone: "ok" | "warn" | "fail";
  detail: string;
} {
  if (outcome === "failure") {
    if (d.reason === "fleet_report_routed_to_energy") {
      return {
        label: "Fleet report — import manually",
        tone: "warn",
        detail: "Recognised as a fleet/telematics report. Import the spreadsheet under Fleet → Import to add it to your emissions data.",
      };
    }
    return {
      label: "Rejected",
      tone: "fail",
      detail: d.reason ? `Reason: ${d.reason}` : "Could not be processed",
    };
  }
  const processed = d.attachmentsProcessed ?? 0;
  const created = d.readingIds?.length ?? 0;
  if (processed > 0 && created > 0) {
    return {
      label: "Imported",
      tone: "ok",
      detail: `${created} reading${created !== 1 ? "s" : ""} created from ${processed} attachment${processed !== 1 ? "s" : ""}`,
    };
  }
  if (processed > 0 && created === 0) {
    return {
      label: "Parsed, no data",
      tone: "warn",
      detail: `${processed} attachment${processed !== 1 ? "s" : ""} read but nothing extracted`,
    };
  }
  return {
    label: "No attachments processed",
    tone: "warn",
    detail: "Email arrived but no usable attachments were found. If you expected a PDF bill, re-send with the file attached directly (not forwarded inline).",
  };
}

const toneClass = (t: "ok" | "warn" | "fail") =>
  t === "ok" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
  : t === "warn" ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
  : "bg-destructive/10 text-destructive border-destructive/30";

export default function Inbox() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const { toast } = useToast();

  const { data: emailInfo } = useGetEnergyEmailAddress(orgId!, { query: { enabled: !!orgId } });
  const { data: logs, isLoading, refetch, isFetching } = useListAuditLogs(
    orgId!,
    { action: "webhook.energy.inbound_email", limit: 200 } as Record<string, unknown>,
    { query: { enabled: !!orgId } },
  );

  const [search, setSearch] = useState("");

  const items = useMemo(() => {
    const all = logs?.items ?? [];
    const term = search.trim().toLowerCase();
    const enriched = all.map((l) => {
      const d = parseDetails(l.details);
      return { log: l, details: d, status: statusFor(d, l.outcome) };
    });
    enriched.sort(
      (a, b) => new Date(b.log.createdAt).getTime() - new Date(a.log.createdAt).getTime(),
    );
    if (!term) return enriched;
    return enriched.filter(({ details }) => {
      const hay = `${details.from ?? ""} ${details.subject ?? ""} ${details.emailId ?? ""}`.toLowerCase();
      return hay.includes(term);
    });
  }, [logs, search]);

  const stats = useMemo(() => {
    const total = items.length;
    const ok = items.filter(i => i.status.tone === "ok").length;
    const warn = items.filter(i => i.status.tone === "warn").length;
    const fail = items.filter(i => i.status.tone === "fail").length;
    const last = items[0]?.log.createdAt;
    return { total, ok, warn, fail, last };
  }, [items]);

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Inbound Email</h1>
          <p className="text-muted-foreground mt-1">
            Every email sent to your EnviroIQ inbox — power bills, fleet reports, and any other forwards.
            Use this to confirm scheduled reports actually arrived.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
          {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
          Refresh
        </Button>
      </div>

      {/* Address card */}
      <Card className="p-4 border-primary/20 bg-primary/5">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center">
            <InboxIcon className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-primary uppercase tracking-wide">Your inbox address</p>
            {emailInfo?.emailAddress ? (
              <code className="text-sm font-mono text-foreground break-all">{emailInfo.emailAddress}</code>
            ) : (
              <p className="text-xs text-muted-foreground">Loading…</p>
            )}
          </div>
          {emailInfo?.emailAddress && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                navigator.clipboard.writeText(emailInfo.emailAddress!);
                toast({ title: "Copied", description: "Inbox address copied." });
              }}
            >
              <Copy className="w-3.5 h-3.5" /> Copy
            </Button>
          )}
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total received</p>
          <p className="text-2xl font-bold text-foreground mt-1">{stats.total}</p>
          {stats.last && (
            <p className="text-xs text-muted-foreground mt-1">
              Last: {format(new Date(stats.last), "d MMM yyyy, h:mm a")}
            </p>
          )}
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Imported</p>
          <p className="text-2xl font-bold text-emerald-500 mt-1">{stats.ok}</p>
          <p className="text-xs text-muted-foreground mt-1">Created readings</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Needs attention</p>
          <p className="text-2xl font-bold text-amber-500 mt-1">{stats.warn}</p>
          <p className="text-xs text-muted-foreground mt-1">No data extracted</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Rejected</p>
          <p className="text-2xl font-bold text-destructive mt-1">{stats.fail}</p>
          <p className="text-xs text-muted-foreground mt-1">Wrong address / bad envelope</p>
        </Card>
      </div>

      {/* Missing-report alerts info */}
      <Card className="p-4 border-border/50 bg-secondary/10">
        <div className="flex items-start gap-3">
          <Bell className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
          <div className="text-sm space-y-1">
            <p className="font-semibold text-foreground">Alerts when expected reports don't arrive</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              EnviroIQ runs a daily check at 6am (Pacific/Auckland) for vehicles that haven't reported telematics in over a week, and for utility accounts missing a monthly bill.
              When something's missing you'll get a notification on the bell icon and in the daily digest email.{" "}
              <Link to="/notifications" className="text-primary hover:underline font-medium">View your notifications →</Link>
            </p>
          </div>
        </div>
      </Card>

      {/* Filters */}
      <Card className="p-4 border-border/50">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by sender, subject, or email id…"
            className="max-w-md"
          />
          {search && (
            <Button variant="ghost" size="sm" onClick={() => setSearch("")} className="h-8">
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </Card>

      {/* List */}
      <Card className="border-border/50 overflow-hidden">
        {items.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <InboxIcon className="w-10 h-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">
              {search ? "No emails match your search." : "Nothing here yet — when emails arrive at your inbox they'll show up here."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {items.map(({ log, details, status }) => {
              const attCount = details.snapshot?.inlineAttachmentCount ?? details.attachmentsProcessed ?? 0;
              const attNames = details.snapshot?.inlineAttachmentMeta
                ?.map(a => a.filename)
                .filter((n): n is string => !!n) ?? [];
              return (
                <div key={log.id} className="p-4 hover:bg-secondary/10 transition-colors">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground truncate">
                          {details.subject || "(no subject)"}
                        </span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded border ${toneClass(status.tone)}`}>
                          {status.tone === "ok" ? <CheckCircle2 className="w-3 h-3 inline mr-1" /> :
                           status.tone === "fail" ? <X className="w-3 h-3 inline mr-1" /> :
                           <AlertTriangle className="w-3 h-3 inline mr-1" />}
                          {status.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        From <span className="font-mono text-foreground">{details.from || "(unknown)"}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">{status.detail}</p>
                      {attCount > 0 && (
                        <div className="flex items-start gap-1.5 mt-1.5">
                          <Paperclip className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                          <div className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{attCount}</span> attachment{attCount !== 1 ? "s" : ""}
                            {attNames.length > 0 && (
                              <span className="ml-1 font-mono">
                                — {attNames.join(", ")}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground text-right md:min-w-[160px] flex-shrink-0">
                      <p className="font-medium text-foreground">{format(new Date(log.createdAt), "d MMM yyyy")}</p>
                      <p>{format(new Date(log.createdAt), "h:mm a")}</p>
                      {details.emailId && (
                        <p className="font-mono mt-1 truncate" title={details.emailId}>
                          {details.emailId.slice(0, 8)}…
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
