// Header notification bell — polls unread-count, lazily loads latest 10 on open.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Bell, Check, X, AlertCircle, AlertTriangle, Info, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
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
}

interface NotificationListResponse {
  items: NotificationRow[];
  total: number;
  page: number;
  limit: number;
}

interface UnreadResponse { count: number }

const POLL_INTERVAL_MS = 60_000;

function severityIcon(s: Severity) {
  if (s === "error") return <AlertCircle className="w-4 h-4 text-destructive shrink-0" />;
  if (s === "warn") return <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />;
  return <Info className="w-4 h-4 text-primary shrink-0" />;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function NotificationsBell() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const unreadKey = ["notifications", "unread-count", orgId] as const;
  const listKey = ["notifications", "list", orgId] as const;

  const { data: unread } = useQuery<UnreadResponse>({
    queryKey: unreadKey,
    queryFn: () => apiClient<UnreadResponse>(`/organisations/${orgId}/notifications/unread-count`),
    enabled: !!orgId,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const { data: list, isLoading: listLoading } = useQuery<NotificationListResponse>({
    queryKey: listKey,
    queryFn: () => apiClient<NotificationListResponse>(`/organisations/${orgId}/notifications?limit=10`),
    enabled: !!orgId && open,
  });

  const markRead = useMutation({
    mutationFn: (id: string) =>
      apiClient(`/organisations/${orgId}/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: unreadKey });
      void qc.invalidateQueries({ queryKey: listKey });
    },
  });

  const dismiss = useMutation({
    mutationFn: (id: string) =>
      apiClient(`/organisations/${orgId}/notifications/${id}/dismiss`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: unreadKey });
      void qc.invalidateQueries({ queryKey: listKey });
    },
  });

  const markAll = useMutation({
    mutationFn: () =>
      apiClient(`/organisations/${orgId}/notifications/mark-all-read`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: unreadKey });
      void qc.invalidateQueries({ queryKey: listKey });
    },
  });

  if (!orgId) return null;
  const count = unread?.count ?? 0;
  const items = list?.items ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Notifications${count > 0 ? ` (${count} unread)` : ""}`}
          className="relative hover-elevate text-muted-foreground hover:text-foreground"
          data-testid="notifications-bell"
        >
          <Bell className="w-4 h-4" />
          {count > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center leading-none"
              data-testid="notifications-bell-badge"
            >
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" data-testid="notifications-popover">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <div className="font-semibold text-sm text-foreground">Notifications</div>
          <Button
            variant="ghost"
            size="sm"
            disabled={count === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
            className="h-7 text-xs"
            data-testid="notifications-mark-all"
          >
            <Check className="w-3.5 h-3.5 mr-1" />
            Mark all read
          </Button>
        </div>

        <ScrollArea className="h-[420px]">
          {listLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center">
              <Bell className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground">You're all caught up</p>
              <p className="text-xs text-muted-foreground mt-1">
                We'll let you know when an upload, import, or telematics event needs attention.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    "p-3 flex gap-3 hover:bg-muted/40 transition-colors",
                    !n.readAt && "bg-primary/5",
                  )}
                  data-testid={`notification-${n.id}`}
                >
                  <div className="pt-0.5">{severityIcon(n.severity)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-foreground leading-tight">{n.title}</p>
                      <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                        {timeAgo(n.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-3 whitespace-pre-line">{n.body}</p>
                    <div className="mt-2 flex items-center gap-2">
                      {n.linkUrl && (
                        <Link
                          href={n.linkUrl}
                          onClick={() => {
                            if (!n.readAt) markRead.mutate(n.id);
                            setOpen(false);
                          }}
                          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                        >
                          Open <ExternalLink className="w-3 h-3" />
                        </Link>
                      )}
                      {!n.readAt && (
                        <button
                          onClick={() => markRead.mutate(n.id)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                          data-testid={`notification-read-${n.id}`}
                        >
                          Mark read
                        </button>
                      )}
                      <button
                        onClick={() => dismiss.mutate(n.id)}
                        className="text-xs text-muted-foreground hover:text-destructive ml-auto inline-flex items-center gap-1"
                        data-testid={`notification-dismiss-${n.id}`}
                      >
                        <X className="w-3 h-3" /> Dismiss
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>

        <div className="p-2 border-t border-border/60">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block text-center text-xs text-primary font-medium hover:underline py-1"
          >
            View all notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
