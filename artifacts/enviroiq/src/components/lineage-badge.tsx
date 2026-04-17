import { useState, useEffect } from "react";
import { FileSearch, X, Hash, GitBranch, Database, User, Calendar, ExternalLink } from "lucide-react";
import { apiClient } from "@/lib/api";

type EmissionFactor = {
  id: string;
  factorKey: string;
  version: string;
  value: number;
  unit: string;
  source: string;
  methodology: string;
  effectiveFrom: string;
  notes?: string | null;
};

export type LineageInfo = {
  metricLabel: string;            // e.g. "Fleet emissions Q1 2026"
  metricValue: string;            // e.g. "107.3 t CO₂e"
  emissionFactorId?: string | null;
  importBatchId?: string | null;
  ingestedByUserId?: string | null;
  source?: string | null;
  sourceRowCount?: number | null;
  recordedAt?: string | null;
  rawPayload?: string | null;
};

export function LineageBadge({ info, compact = false }: { info: LineageInfo; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [factor, setFactor] = useState<EmissionFactor | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !info.emissionFactorId || factor) return;
    setLoading(true);
    apiClient(`/emission-factors/${info.emissionFactorId}`)
      .then((d) => setFactor(d as EmissionFactor))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, info.emissionFactorId, factor]);

  if (compact) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="View data lineage"
        className="inline-flex items-center gap-1 text-[10px] font-mono text-primary/70 hover:text-primary border border-primary/30 hover:border-primary/60 rounded px-1.5 py-0.5 transition-colors"
      >
        <FileSearch className="w-2.5 h-2.5" />
        lineage
      </button>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs font-mono text-primary hover:text-primary/80 bg-primary/8 hover:bg-primary/15 border border-primary/20 rounded-md px-2 py-1 transition-colors"
      >
        <FileSearch className="w-3 h-3" />
        [lineage]
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setOpen(false)}>
          <div
            className="bg-card border border-border rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-border flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-mono uppercase text-primary mb-1">Data Lineage</div>
                <h3 className="text-lg font-bold text-foreground">{info.metricLabel}</h3>
                <div className="text-2xl font-bold text-primary mt-1 font-mono">{info.metricValue}</div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Source */}
              <Section icon={Database} label="Source" value={info.source ?? "—"} subValue={info.sourceRowCount ? `${info.sourceRowCount} source rows` : undefined} />

              {/* Emission Factor */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <GitBranch className="w-4 h-4 text-primary" />
                  <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground font-semibold">Emission Factor Applied</span>
                </div>
                {loading && <div className="text-sm text-muted-foreground">Loading factor…</div>}
                {!info.emissionFactorId && <div className="text-sm text-muted-foreground italic">No factor recorded for this row.</div>}
                {factor && (
                  <div className="bg-muted/30 border border-border rounded-lg p-4 space-y-2 text-sm">
                    <Row k="Factor key" v={<span className="font-mono text-xs">{factor.factorKey}</span>} />
                    <Row k="Version" v={<span className="font-mono text-xs bg-primary/15 text-primary px-2 py-0.5 rounded">{factor.version}</span>} />
                    <Row k="Value" v={<span className="font-mono">{factor.value} {factor.unit}</span>} />
                    <Row k="Source" v={factor.source} />
                    <Row k="Effective from" v={new Date(factor.effectiveFrom).toLocaleDateString()} />
                    <Row k="Methodology" v={<span className="text-xs text-muted-foreground italic">{factor.methodology}</span>} />
                  </div>
                )}
              </div>

              {/* Import batch */}
              {info.importBatchId && (
                <Section icon={Hash} label="Import Batch ID" value={<span className="font-mono text-xs">{info.importBatchId}</span>} />
              )}

              {/* User */}
              {info.ingestedByUserId && (
                <Section icon={User} label="Ingested By" value={<span className="font-mono text-xs">{info.ingestedByUserId}</span>} />
              )}

              {/* Recorded At */}
              {info.recordedAt && (
                <Section icon={Calendar} label="Recorded At" value={new Date(info.recordedAt).toLocaleString()} />
              )}

              {/* Raw payload */}
              {info.rawPayload && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <ExternalLink className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground font-semibold">Raw Payload</span>
                  </div>
                  <pre className="bg-muted/30 border border-border rounded-lg p-3 text-xs font-mono text-muted-foreground overflow-x-auto max-h-48">
                    {info.rawPayload}
                  </pre>
                </div>
              )}

              <div className="text-xs text-muted-foreground italic border-t border-border pt-4">
                Every metric in EnviroIQ is recorded as an immutable, append-only event with the emission factor version applied.
                To export full evidence for an external audit, use the <span className="font-semibold text-foreground">Compliance & Evidence</span> page.
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Section({ icon: Icon, label, value, subValue }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; subValue?: string }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
      </div>
      <div className="text-sm text-foreground">{value}</div>
      {subValue && <div className="text-xs text-muted-foreground mt-0.5">{subValue}</div>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-muted-foreground shrink-0 w-28">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}
