// /notifications — full inbox view backed by GET /organisations/:orgId/notifications
// with category + severity + read/unread filters and dismiss/read actions
// per row. Drives the same dataset as the bell popover; deliberately reuses
// no shared component because the inbox is a richer table whereas the bell
// is a compact summary.

import { useState, useMemo, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, X, AlertCircle, AlertTriangle, Info, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/utils";

type Severity = "info" | "warn" | "error";

interface NotificationRow {
  id: string;
  category: string;
  severity: Severity;
  title: string;
  body: string;
  linkUrl: string | null;
  readAt: string | null;
  createdAt: string;
  sourceAuditId: string | null;
}

interface ListResponse {
  items: NotificationRow[];
  total: number;
  page: number;
  limit: number;
}

function severityBadge(s: Severity) {
  if (s === "error")
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="w-3 h-3" /> Error
      </Badge>
    );
  if (s === "warn")
    return (
      <Badge className="gap-1 bg-amber-500/15 text-amber-600 border-amber-500/40 hover:bg-amber-500/20">
        <AlertTriangle className="w-3 h-3" /> Warning
      </Badge>
    );
  return (
    <Badge variant="secondary" className="gap-1">
      <Info className="w-3 h-3" /> Info
    </Badge>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-NZ", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function NotificationsPage() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const qc = useQueryClient();

  const [severity, setSeverity] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [page, setPage] = useState<number>(1);
  const PAGE_SIZE = 25;

  // Reset to page 1 whenever a filter changes — otherwise a filter applied
  // on page 3 can land on an empty page.
  useEffect(() => {
    setPage(1);
  }, [severity, status, category]);

  const queryKey = useMemo(
    () => ["notifications", "page", orgId, severity, status, category, page] as const,
    [orgId, severity, status, category, page],
  );
  const unreadKey = ["notifications", "unread-count", orgId] as const;

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(page) });
      if (severity !== "all") params.set("severity", severity);
      if (status !== "all") params.set("status", status);
      if (category !== "all") params.set("category", category);
      return apiClient<ListResponse>(`/organisations/${orgId}/notifications?${params.toString()}`);
    },
    enabled: !!orgId,
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  // Build the category options dynamically from whatever the inbox has
  // currently surfaced. Keeps the filter useful as new failure sources are
  // wired in without us having to maintain a hardcoded list of categories.
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const n of data?.items ?? []) set.add(n.category);
    return Array.from(set).sort();
  }, [data]);

  const markRead = useMutation({
    mutationFn: (id: string) =>
      apiClient(`/organisations/${orgId}/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: unreadKey });
    },
  });

  const dismiss = useMutation({
    mutationFn: (id: string) =>
      apiClient(`/organisations/${orgId}/notifications/${id}/dismiss`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: unreadKey });
    },
  });

  const markAll = useMutation({
    mutationFn: () =>
      apiClient(`/organisations/${orgId}/notifications/mark-all-read`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: unreadKey });
    },
  });

  if (!orgId) {
    return (
      <div className="text-muted-foreground p-6">No organisation context.</div>
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" />
            Notifications
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Alerts about uploads, imports, and telematics events that need your attention.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={markAll.isPending || items.every((i) => i.readAt)}
          onClick={() => markAll.mutate()}
          data-testid="notifications-page-mark-all"
        >
          <Check className="w-4 h-4 mr-1" />
          Mark all read
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-3 flex-wrap">
            <span className="text-muted-foreground font-normal">Filters:</span>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="h-8 w-32" data-testid="filter-severity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="error">Errors</SelectItem>
                <SelectItem value="warn">Warnings</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-8 w-32" data-testid="filter-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="unread">Unread only</SelectItem>
                <SelectItem value="read">Read only</SelectItem>
              </SelectContent>
            </Select>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-8 w-56" data-testid="filter-category">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categoryOptions.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground ml-auto">
              {data?.total ?? 0} notification{(data?.total ?? 0) === 1 ? "" : "s"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 text-center text-sm text-muted-foreground">Loading…</div>
          ) : items.length === 0 ? (
            <div className="p-12 text-center">
              <Bell className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground">Nothing here</p>
              <p className="text-xs text-muted-foreground mt-1">
                When uploads, imports, or telematics events fail, you'll see them here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    "p-5 grid grid-cols-[auto_1fr_auto] gap-4 items-start hover:bg-muted/40 transition-colors",
                    !n.readAt && "bg-primary/5",
                  )}
                  data-testid={`row-notification-${n.id}`}
                >
                  <div className="pt-1">{severityBadge(n.severity)}</div>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{n.title}</h3>
                      <span className="text-[11px] text-muted-foreground">{formatDate(n.createdAt)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 whitespace-pre-line">{n.body}</p>
                    <div className="mt-3 flex items-center gap-3">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/80 bg-muted/60 px-2 py-0.5 rounded">
                        {n.category}
                      </span>
                      {n.linkUrl && (
                        <Link
                          href={n.linkUrl}
                          onClick={() => {
                            if (!n.readAt) markRead.mutate(n.id);
                          }}
                          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                        >
                          Open <ExternalLink className="w-3 h-3" />
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    {!n.readAt && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => markRead.mutate(n.id)}
                        data-testid={`row-read-${n.id}`}
                      >
                        <Check className="w-3 h-3 mr-1" />
                        Read
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => dismiss.mutate(n.id)}
                      data-testid={`row-dismiss-${n.id}`}
                    >
                      <X className="w-3 h-3 mr-1" />
                      Dismiss
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
        {(data?.total ?? 0) > PAGE_SIZE && (
          <div
            className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border/60 text-xs text-muted-foreground"
            data-testid="notifications-pagination"
          >
            <span>
              Showing {(page - 1) * PAGE_SIZE + 1}–
              {Math.min(page * PAGE_SIZE, data?.total ?? 0)} of {data?.total ?? 0}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2"
                disabled={page <= 1 || isLoading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                data-testid="notifications-page-prev"
              >
                <ChevronLeft className="w-3 h-3" />
                Prev
              </Button>
              <span className="font-medium text-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2"
                disabled={page >= totalPages || isLoading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                data-testid="notifications-page-next"
              >
                Next
                <ChevronRight className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
