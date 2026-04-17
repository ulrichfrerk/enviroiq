import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Download,
  RefreshCw,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiUrl } from "@/lib/api";

type Health = "operational" | "degraded" | "down";
type CategoryStatus = "operational" | "degraded";

interface CategorySnapshot {
  name: string;
  status: CategoryStatus;
  passing: number;
  total: number;
}

interface PublicSnapshot {
  status: Health;
  passing: number;
  total: number;
  categories: CategorySnapshot[];
  last_verified_at: string;
  next_refresh_seconds: number;
  frameworks: string[];
  attestation: string;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return "just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

function statusStyle(s: Health) {
  switch (s) {
    case "operational":
      return {
        label: "All systems operational",
        Icon: ShieldCheck,
        text: "text-emerald-400",
        ring: "ring-emerald-400/40",
        dot: "bg-emerald-400",
        glow: "shadow-[0_0_30px_rgba(52,211,153,0.25)]",
        bar: "bg-emerald-400",
      };
    case "degraded":
      return {
        label: "Degraded — non-critical check failing",
        Icon: ShieldAlert,
        text: "text-amber-400",
        ring: "ring-amber-400/40",
        dot: "bg-amber-400",
        glow: "shadow-[0_0_30px_rgba(251,191,36,0.25)]",
        bar: "bg-amber-400",
      };
    default:
      return {
        label: "Critical issue — see status page",
        Icon: ShieldAlert,
        text: "text-red-400",
        ring: "ring-red-400/40",
        dot: "bg-red-400",
        glow: "shadow-[0_0_30px_rgba(248,113,113,0.25)]",
        bar: "bg-red-400",
      };
  }
}

/**
 * Live trust badge for the marketing site. Polls the public sanitised
 * compliance snapshot every 60s and exposes a downloadable trust pack.
 */
export function ComplianceWidget() {
  const [data, setData] = useState<PublicSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchOnce() {
    try {
      const r = await fetch(apiUrl("/api/compliance/public"), {
        cache: "no-cache",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as PublicSnapshot;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load status");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchOnce();
    const id = setInterval(fetchOnce, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = statusStyle(data?.status ?? "operational");
  const Icon = style.Icon;
  const passingPct =
    data && data.total > 0 ? Math.round((data.passing / data.total) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      className={`relative overflow-hidden rounded-2xl border border-border bg-card/80 backdrop-blur-md ${style.glow}`}
      data-testid="compliance-widget"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-border/60 px-6 py-5">
        <div className="flex items-center gap-4">
          <div className={`relative h-12 w-12 rounded-xl ring-2 ${style.ring} flex items-center justify-center bg-background`}>
            <Icon className={`h-6 w-6 ${style.text}`} />
            <span className={`absolute -top-1 -right-1 h-3 w-3 rounded-full ${style.dot} ring-2 ring-background animate-pulse`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Live operational compliance
              </span>
              <Badge variant="outline" className="border-primary/30 text-primary text-xs px-2 py-0 h-5">
                <Activity className="w-3 h-3 mr-1" />
                Auto-verified
              </Badge>
            </div>
            <h3 className={`text-xl font-bold mt-0.5 ${style.text}`}>{style.label}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {loading ? "Checking…" : error
                ? `Status unavailable — ${error}`
                : `${data?.passing} of ${data?.total} checks passing · last verified ${relativeTime(data?.last_verified_at ?? null)}`}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="border-border h-9"
            onClick={() => {
              setLoading(true);
              fetchOnce();
            }}
            data-testid="compliance-refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            className="bg-primary text-primary-foreground hover:bg-primary/90 h-9"
            asChild
            data-testid="compliance-download"
          >
            <a href={apiUrl("/api/compliance/public/pack.txt")} download>
              <Download className="w-3.5 h-3.5 mr-2" />
              Trust pack
            </a>
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-6 pt-5">
        <div className="flex items-center justify-between text-xs font-mono text-muted-foreground mb-2">
          <span>OPERATIONAL CHECKS</span>
          <span className={style.text}>{passingPct}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${passingPct}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className={`h-full ${style.bar}`}
          />
        </div>
      </div>

      {/* Categories grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-6">
        {(data?.categories ?? []).map((c) => {
          const ok = c.status === "operational";
          return (
            <div
              key={c.name}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-muted/40 border border-border/60"
              data-testid={`compliance-cat-${c.name.toLowerCase().replace(/\W+/g, "-")}`}
            >
              {ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{c.name}</div>
                <div className="text-xs text-muted-foreground">
                  {c.passing}/{c.total} passing
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="border-t border-border/60 px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-muted/20">
        <div className="flex flex-wrap gap-2">
          {(data?.frameworks ?? []).slice(0, 4).map((f) => (
            <span
              key={f}
              className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground border border-border/60 rounded-full px-2 py-0.5"
            >
              {f}
            </span>
          ))}
        </div>
        <a
          href="/trust"
          className="text-xs font-mono text-primary hover:underline"
        >
          See full trust model →
        </a>
      </div>
    </motion.div>
  );
}
