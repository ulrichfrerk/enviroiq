import { useCallback, useState } from "react";
import { fmtCo2e } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useListEnergyReadings, useGetEnergyEmailAddress } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Zap, Upload, Mail, FileText, Loader2, Copy, Check,
  Leaf, Wind, Info, AlertTriangle, CheckCircle2, XCircle,
  Flame, Droplets, Clock, Trash2, Search, ChevronLeft, ChevronRight,
  LineChart,
} from "lucide-react";
import { GridHistoryDialog } from "@/components/grid-history-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDropzone } from "react-dropzone";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";

const MAX_QUEUE = 40;

interface GridIntensityData {
  region: string;
  tradingPeriodStart: string;
  gco2PerKwh: number;
  kgco2PerKwh: number;
  renewablePct: number;
  carbonTonnes: number;
  fetchedAt: string;
  source: string;
}

function GridIntensityBanner() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const { data, isLoading, error } = useQuery<GridIntensityData>({
    queryKey: ["nz-grid-intensity"],
    queryFn: async () => {
      const res = await fetch("/api/grid/nz");
      if (!res.ok) throw new Error("Failed to fetch grid data");
      return res.json() as Promise<GridIntensityData>;
    },
    refetchInterval: 30 * 60 * 1000,
    staleTime: 25 * 60 * 1000,
  });

  if (isLoading || error || !data) return null;

  const nzAvg = 97.7;
  const pctOfAvg = Math.round((data.gco2PerKwh / nzAvg) * 100);
  const isLow = data.gco2PerKwh < 60;
  const isMed = data.gco2PerKwh >= 60 && data.gco2PerKwh < 100;

  const intensityColor = isLow ? "text-emerald-400" : isMed ? "text-amber-400" : "text-red-400";
  const intensityBg = isLow
    ? "from-emerald-950/40 to-background border-emerald-800/30"
    : isMed ? "from-amber-950/40 to-background border-amber-800/30"
    : "from-red-950/40 to-background border-red-800/30";
  const label = isLow ? "Low — great time to use power" : isMed ? "Moderate" : "High — more fossil fuel on grid";

  return (
    <Card className={`p-5 bg-gradient-to-r ${intensityBg} border`}>
      <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
        <div className={`p-3 rounded-xl shrink-0 ${isLow ? "bg-emerald-900/40" : isMed ? "bg-amber-900/40" : "bg-red-900/40"}`}>
          <Leaf className={`w-6 h-6 ${intensityColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm font-medium text-muted-foreground">NZ Live Grid Intensity</span>
            <span className={`text-2xl font-bold tabular-nums ${intensityColor}`}>{data.gco2PerKwh.toFixed(1)}</span>
            <span className="text-sm text-muted-foreground">gCO₂e/kWh</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isLow ? "bg-emerald-900/50 text-emerald-300" : isMed ? "bg-amber-900/50 text-amber-300" : "bg-red-900/50 text-red-300"}`}>
              {label}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Wind className="w-3 h-3" />{data.renewablePct.toFixed(1)}% renewable</span>
            <span>{pctOfAvg}% of NZ yearly avg ({nzAvg} g)</span>
            <span>Updated {formatDistanceToNow(new Date(data.fetchedAt), { addSuffix: true })}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-border/60"
            onClick={() => setHistoryOpen(true)}
            data-testid="grid-history-trigger"
          >
            <LineChart className="w-3.5 h-3.5" />
            View history
          </Button>
          <div className="text-right hidden md:block">
            <div className="text-xs text-muted-foreground/60">Source</div>
            <div className="text-xs text-muted-foreground">em6 / EMS · Transpower NZ</div>
          </div>
        </div>
      </div>
      <GridHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
    </Card>
  );
}

type FileStatus = "pending" | "processing" | "success" | "review" | "error";

interface QueuedFile {
  /** Stable client-generated key — used for result association, never filename */
  id: string;
  file: File;
  status: FileStatus;
  utilityType?: string;
  provider?: string;
  periodStart?: string;
  periodEnd?: string;
  usageKwh?: number;
  co2eKg?: number;
  confidence?: number;
  reviewFlags?: string[];
  error?: string;
  /** DB reading ID returned after upload — used for inline delete */
  readingId?: string;
  /** True when the user deleted this reading from the upload results */
  removed?: boolean;
}

interface UploadResult {
  parsedFields: {
    utilityType?: string;
    provider?: string;
    usageKwh?: number;
    periodStart?: string | Date;
    periodEnd?: string | Date;
  };
  reading: { id: string; co2eKg?: number };
  confidence?: number;
  reviewFlags?: string[];
  requiresReview?: boolean;
}

function UtilityIcon({ type, className }: { type?: string; className?: string }) {
  if (type === "gas") return <Flame className={className ?? "w-4 h-4 text-orange-400"} />;
  if (type === "water") return <Droplets className={className ?? "w-4 h-4 text-blue-400"} />;
  return <Zap className={className ?? "w-4 h-4 text-yellow-400"} />;
}

function StatusIcon({ status }: { status: FileStatus }) {
  if (status === "pending") return <Clock className="w-4 h-4 text-muted-foreground/50" />;
  if (status === "processing") return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
  if (status === "success") return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
  if (status === "review") return <AlertTriangle className="w-4 h-4 text-amber-400" />;
  return <XCircle className="w-4 h-4 text-red-400" />;
}

export default function Energy() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: readings, isLoading } = useListEnergyReadings(orgId!, { limit: 500 }, { query: { enabled: !!orgId } });
  const { data: emailInfo } = useGetEnergyEmailAddress(orgId!, { query: { enabled: !!orgId } });

  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [batchRenewablePct, setBatchRenewablePct] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const BILL_PAGE_SIZE = 15;
  const [billSearch, setBillSearch] = useState("");
  const [billDateFrom, setBillDateFrom] = useState("");
  const [billDateTo, setBillDateTo] = useState("");
  const [billPage, setBillPage] = useState(1);

  const deleteReading = async (id: string) => {
    if (!orgId) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/organisations/${orgId}/energy/readings/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await qc.invalidateQueries({ queryKey: [`/api/organisations/${orgId}/energy/readings`] });
      toast({ title: "Reading deleted" });
    } catch {
      toast({ variant: "destructive", title: "Delete failed", description: "Could not delete this reading." });
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  const doneCount   = queue.filter(f => ["success", "review", "error"].includes(f.status)).length;
  const successCount = queue.filter(f => f.status === "success").length;
  const reviewCount  = queue.filter(f => f.status === "review").length;
  const errorCount   = queue.filter(f => f.status === "error").length;
  const totalKwh     = queue.filter(f => f.usageKwh != null).reduce((s, f) => s + (f.usageKwh ?? 0), 0);
  const totalCo2e    = queue.filter(f => f.co2eKg != null).reduce((s, f) => s + (f.co2eKg ?? 0), 0);
  const pendingCount = queue.filter(f => f.status === "pending").length;

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    setQueue(prev => {
      const remaining = MAX_QUEUE - prev.length;
      if (remaining <= 0) {
        toast({ variant: "destructive", title: "Queue full", description: `Maximum ${MAX_QUEUE} files per upload.` });
        return prev;
      }
      const toAdd = acceptedFiles.slice(0, remaining);
      if (toAdd.length < acceptedFiles.length) {
        toast({ title: "Some files skipped", description: `Only ${toAdd.length} of ${acceptedFiles.length} files added — ${MAX_QUEUE} file limit reached.` });
      }
      const newItems: QueuedFile[] = toAdd.map(f => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file: f,
        status: "pending",
      }));
      return [...prev, ...newItems];
    });
    setIsDone(false);
  }, [toast]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    disabled: isProcessing,
  });

  // Process files sequentially one-at-a-time so each row transitions live:
  //   Pending → Processing → Success / Review / Error
  // After each file resolves, the reading history refreshes incrementally.
  const processQueue = useCallback(async () => {
    if (!orgId || isProcessing) return;

    // Snapshot pending items at this moment — stable IDs used for row association
    const pendingSnapshot = queue.filter(f => f.status === "pending");
    if (pendingSnapshot.length === 0) return;

    setIsProcessing(true);

    for (const item of pendingSnapshot) {
      // Mark only this row as processing — prior rows keep their final state
      setQueue(prev => prev.map(f => f.id === item.id ? { ...f, status: "processing" as FileStatus } : f));

      try {
        const fd = new FormData();
        fd.append("file", item.file);
        if (batchRenewablePct > 0) fd.append("supplierRenewablePct", String(batchRenewablePct));

        const res = await fetch(`/api/organisations/${orgId}/energy/upload`, {
          method: "POST",
          body: fd,
          credentials: "include",
        });

        if (!res.ok) {
          const errBody = await res.json() as { message?: string };
          throw new Error(errBody.message ?? `HTTP ${res.status}`);
        }

        const data = await res.json() as UploadResult;
        const pf = data.parsedFields;

        setQueue(prev => prev.map(f => f.id === item.id ? {
          ...f,
          status: ((data.reviewFlags?.length ?? 0) > 0 ? "review" : "success") as FileStatus,
          utilityType: pf.utilityType,
          provider: pf.provider,
          periodStart: pf.periodStart ? new Date(pf.periodStart).toISOString() : undefined,
          periodEnd:   pf.periodEnd   ? new Date(pf.periodEnd).toISOString()   : undefined,
          usageKwh:    pf.usageKwh,
          co2eKg:      data.reading.co2eKg,
          confidence:  data.confidence,
          reviewFlags: data.reviewFlags,
          readingId:   data.reading.id,
        } : f));

        // Refresh history immediately so the new row appears as soon as each file is done
        // Key must match the Orval-generated hook: `/api/organisations/${orgId}/energy/readings`
        await qc.invalidateQueries({ queryKey: [`/api/organisations/${orgId}/energy/readings`] });

      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Upload failed";
        setQueue(prev => prev.map(f => f.id === item.id ? { ...f, status: "error" as FileStatus, error: message } : f));
      }
    }

    setIsProcessing(false);
    setIsDone(true);
  }, [orgId, queue, batchRenewablePct, isProcessing, qc]);

  const resetUpload = () => {
    setQueue([]);
    setIsDone(false);
    setBatchRenewablePct(0);
  };

  const handleDeleteUploaded = useCallback(async (item: QueuedFile) => {
    if (!orgId || !item.readingId) return;
    try {
      await fetch(`/api/organisations/${orgId}/energy/readings/${item.readingId}`, {
        method: "DELETE",
        credentials: "include",
      });
      setQueue(prev => prev.map(f => f.id === item.id ? { ...f, removed: true } : f));
      await qc.invalidateQueries({ queryKey: [`/api/organisations/${orgId}/energy/readings`] });
    } catch {
      // silently ignore — reading can be deleted from the main table
    }
  }, [orgId, qc]);

  const handleOpenChange = (open: boolean) => {
    if (!open && !isProcessing) resetUpload();
    setIsUploadOpen(open);
  };

  const copyEmail = () => {
    if (emailInfo?.emailAddress) {
      navigator.clipboard.writeText(emailInfo.emailAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Email copied!" });
    }
  };

  if (isLoading) return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Energy Consumption</h1>
          <p className="text-muted-foreground mt-1">Track power bills and calculate stationary emissions.</p>
        </div>

        <Dialog open={isUploadOpen} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button className="hover-elevate active-elevate-2 shadow-lg shadow-primary/20">
              <Upload className="w-4 h-4 mr-2" /> Upload Bills
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border sm:max-w-[680px] max-h-[90vh] flex flex-col">
            <DialogHeader className="shrink-0">
              <DialogTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                Bulk Bill Upload
              </DialogTitle>
              <p className="text-sm text-muted-foreground pt-1">
                Drop up to {MAX_QUEUE} PDFs at once. Utility type, provider, billing period and usage are auto-detected from each bill.
              </p>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1 py-2 min-h-0">

              {/* Renewable override */}
              <div className="rounded-xl border border-emerald-800/30 bg-emerald-950/20 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Leaf className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm font-medium text-emerald-300">Renewable source override</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      If your organisation is on a renewable tariff, set the % here — it applies to all electricity bills in this batch.
                      GHG Protocol market-based method: 100% renewable = 0 kg CO₂e.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range" min={0} max={100} step={5}
                    value={batchRenewablePct}
                    onChange={(e) => setBatchRenewablePct(Number(e.target.value))}
                    className="flex-1 accent-emerald-500"
                    disabled={isProcessing}
                  />
                  <span className="text-sm font-semibold text-emerald-400 w-12 text-right">{batchRenewablePct}%</span>
                  {batchRenewablePct > 0 && !isProcessing && (
                    <button onClick={() => setBatchRenewablePct(0)} className="text-xs text-muted-foreground hover:text-foreground">reset</button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {batchRenewablePct === 0
                    ? "Using NZ grid average for each billing period."
                    : batchRenewablePct === 100
                    ? "100% renewable → 0 kg CO₂e for all electricity bills."
                    : `${batchRenewablePct}% renewable applied to all electricity bills.`}
                </p>
              </div>

              {/* Summary banner — shown after all done */}
              {isDone && queue.length > 0 && (
                <div className={`rounded-xl border p-4 flex flex-wrap gap-x-6 gap-y-2 text-sm ${
                  errorCount > 0 ? "bg-amber-950/20 border-amber-800/30" : "bg-emerald-950/20 border-emerald-800/30"
                }`}>
                  <span className="font-semibold text-foreground">
                    {doneCount} of {queue.length} processed
                  </span>
                  {totalKwh > 0 && (
                    <span className="text-muted-foreground">{totalKwh.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh total</span>
                  )}
                  {totalCo2e > 0 && (
                    <span className="text-muted-foreground">{fmtCo2e(totalCo2e)} CO₂e total</span>
                  )}
                  {reviewCount > 0 && <span className="text-amber-400">{reviewCount} need review</span>}
                  {errorCount > 0 && <span className="text-red-400">{errorCount} failed</span>}
                  {successCount > 0 && errorCount === 0 && reviewCount === 0 && (
                    <span className="text-emerald-400">All parsed successfully</span>
                  )}
                </div>
              )}

              {/* Dropzone — hide once all files are done */}
              {!isDone && (
                <div
                  {...getRootProps()}
                  className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                    isProcessing ? "opacity-50 cursor-not-allowed pointer-events-none" : "cursor-pointer"
                  } ${isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 bg-secondary/20"}`}
                >
                  <input {...getInputProps()} />
                  <div className="flex justify-center mb-3">
                    <div className="p-4 bg-background rounded-full shadow-sm">
                      <FileText className={`w-8 h-8 ${isDragActive ? "text-primary" : "text-muted-foreground"}`} />
                    </div>
                  </div>
                  <p className="font-medium text-foreground mb-1">
                    {isDragActive ? "Drop PDFs here" : "Drag & drop PDF bills here"}
                  </p>
                  <p className="text-xs text-muted-foreground">or click to browse · up to {MAX_QUEUE} files total</p>
                  {queue.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1 opacity-60">{MAX_QUEUE - queue.length} slots remaining</p>
                  )}
                </div>
              )}

              {/* File queue list */}
              {queue.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-muted-foreground">
                      {queue.length} file{queue.length !== 1 ? "s" : ""}
                      {isProcessing && pendingCount > 0 && ` · ${pendingCount} remaining`}
                    </span>
                    {isDone && (
                      <button
                        onClick={resetUpload}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Clear &amp; upload more
                      </button>
                    )}
                  </div>
                  <div className="rounded-xl border border-border/50 divide-y divide-border/50 overflow-hidden max-h-[300px] overflow-y-auto">
                    {queue.map((item) => (
                      <div key={item.id} className="flex items-start gap-3 px-4 py-3 hover:bg-secondary/20 transition-colors">
                        <div className="mt-0.5 shrink-0">
                          <StatusIcon status={item.status} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-foreground truncate max-w-[200px]" title={item.file.name}>
                              {item.file.name}
                            </span>
                            {item.utilityType && (
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <UtilityIcon type={item.utilityType} className="w-3 h-3" />
                                <span className="capitalize">{item.utilityType}</span>
                              </span>
                            )}
                            {item.provider && (
                              <span className="text-xs text-muted-foreground">· {item.provider}</span>
                            )}
                          </div>

                          {(item.periodStart || item.usageKwh != null) && (
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                              {item.periodStart && item.periodEnd && (
                                <span>
                                  {format(new Date(item.periodStart), "d MMM")} – {format(new Date(item.periodEnd), "d MMM yyyy")}
                                </span>
                              )}
                              {item.usageKwh != null && (
                                <span>{item.usageKwh.toLocaleString(undefined, { maximumFractionDigits: 0 })} kWh</span>
                              )}
                              {item.co2eKg != null && (
                                <span className={item.co2eKg === 0 ? "text-emerald-400" : ""}>
                                  {fmtCo2e(item.co2eKg)} CO₂e
                                </span>
                              )}
                            </div>
                          )}

                          {item.reviewFlags && item.reviewFlags.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {item.reviewFlags.map((flag, i) => (
                                <p key={i} className="text-xs text-amber-400/80">⚠ {flag}</p>
                              ))}
                            </div>
                          )}

                          {item.status === "error" && item.error && (
                            <p className="mt-1 text-xs text-red-400">{item.error}</p>
                          )}

                          {item.status === "pending" && (
                            <p className="mt-1 text-xs text-muted-foreground/50">Waiting…</p>
                          )}
                        </div>

                        {/* Delete button — shown after upload completes, lets user remove a bad reading */}
                        {isDone && item.readingId && !item.removed && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => handleDeleteUploaded(item)}
                                className="p-1 text-muted-foreground/40 hover:text-red-400 transition-colors shrink-0"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="text-xs">Remove this reading</TooltipContent>
                          </Tooltip>
                        )}

                        {item.removed && (
                          <span className="text-xs text-muted-foreground/40 line-through shrink-0">removed</span>
                        )}

                        {item.confidence != null && item.status !== "error" && !item.removed && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 cursor-help ${
                                item.confidence >= 0.7 ? "bg-emerald-900/40 text-emerald-300" :
                                item.confidence >= 0.4 ? "bg-amber-900/40 text-amber-300" :
                                "bg-red-900/40 text-red-300"
                              }`}>
                                {Math.round(item.confidence * 100)}%
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="text-xs">Parse confidence score</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="shrink-0 pt-3 border-t border-border/50 flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                {isProcessing
                  ? `Processing… ${pendingCount} file${pendingCount !== 1 ? "s" : ""} remaining`
                  : isDone
                  ? "Upload complete"
                  : pendingCount > 0
                  ? `${pendingCount} file${pendingCount !== 1 ? "s" : ""} ready`
                  : "Add PDFs above to start"}
              </span>
              <div className="flex gap-2">
                {isDone && (
                  <Button variant="outline" size="sm" onClick={() => setIsUploadOpen(false)}>
                    Done
                  </Button>
                )}
                {!isDone && pendingCount > 0 && (
                  <Button
                    size="sm"
                    onClick={processQueue}
                    disabled={isProcessing || pendingCount === 0}
                    className="shadow-sm shadow-primary/20"
                  >
                    {isProcessing ? (
                      <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />Processing…</>
                    ) : (
                      <><Upload className="w-3.5 h-3.5 mr-2" />Process {pendingCount} Bill{pendingCount !== 1 ? "s" : ""}</>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <GridIntensityBanner />

      <Card className="p-6 bg-gradient-to-r from-secondary/40 to-background border-border">
        <div className="flex flex-col md:flex-row items-center gap-6">
          <div className="p-4 bg-primary/10 rounded-2xl shrink-0"><Mail className="w-8 h-8 text-primary" /></div>
          <div className="flex-1">
            <h3 className="font-semibold text-lg text-foreground">Email Bills Directly</h3>
            <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
              Ask your accountant or utility provider to auto-forward PDF bills to your unique secure address. EnviroIQ will automatically parse them and calculate emissions.
            </p>
            {emailInfo ? (
              <div className="mt-4 flex items-center gap-2 max-w-md">
                <div className="flex-1 bg-background border border-border rounded-lg px-4 py-3 font-mono text-sm text-foreground overflow-hidden text-ellipsis">
                  {emailInfo.emailAddress}
                </div>
                <Button variant="outline" size="icon" onClick={copyEmail} className="shrink-0 h-[46px] w-[46px]">
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            ) : <Loader2 className="w-4 h-4 animate-spin mt-4" />}
          </div>
        </div>
      </Card>

      {(() => {
        const allReadings = readings?.items ?? [];
        const q = billSearch.trim().toLowerCase();
        const filtered = allReadings.filter(r => {
          if (q && !`${r.provider ?? ""} ${r.utilityType ?? ""}`.toLowerCase().includes(q)) return false;
          if (billDateFrom && r.periodEnd < billDateFrom) return false;
          if (billDateTo && r.periodStart > billDateTo) return false;
          return true;
        });
        const totalPages = Math.max(1, Math.ceil(filtered.length / BILL_PAGE_SIZE));
        const safePage = Math.min(billPage, totalPages);
        const pageItems = filtered.slice((safePage - 1) * BILL_PAGE_SIZE, safePage * BILL_PAGE_SIZE);

        return (
      <Card className="border-border/50 overflow-hidden">
        <div className="p-6 border-b border-border/50 bg-secondary/20 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-lg">Reading History</h3>
            <span className="text-xs text-muted-foreground">{filtered.length} of {allReadings.length} bill{allReadings.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={billSearch}
                onChange={e => { setBillSearch(e.target.value); setBillPage(1); }}
                placeholder="Search provider or utility…"
                className="pl-9 h-8 text-sm bg-background"
              />
            </div>
            <Input
              type="date"
              value={billDateFrom}
              onChange={e => { setBillDateFrom(e.target.value); setBillPage(1); }}
              className="h-8 text-sm bg-background w-36"
              title="From date"
            />
            <Input
              type="date"
              value={billDateTo}
              onChange={e => { setBillDateTo(e.target.value); setBillPage(1); }}
              className="h-8 text-sm bg-background w-36"
              title="To date"
            />
            {(billSearch || billDateFrom || billDateTo) && (
              <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground"
                onClick={() => { setBillSearch(""); setBillDateFrom(""); setBillDateTo(""); setBillPage(1); }}>
                Clear
              </Button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary/30 text-muted-foreground uppercase text-xs font-semibold">
              <tr>
                <th className="px-6 py-4">Period</th>
                <th className="px-6 py-4">Utility / Provider</th>
                <th className="px-6 py-4">Usage</th>
                <th className="px-6 py-4">Emission Factor</th>
                <th className="px-6 py-4 text-right">CO₂e</th>
                <th className="px-4 py-4 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {pageItems.map((reading) => {
                const isRenewable = reading.emissionMethod?.includes("renewable");
                const isLive      = reading.emissionMethod?.includes("live_em6");
                const isHistorical = reading.emissionMethod?.includes("annual_avg");
                const factorG = reading.gridIntensityKgCo2PerKwh != null
                  ? (reading.gridIntensityKgCo2PerKwh * 1000).toFixed(1) + " g/kWh"
                  : null;

                return (
                  <tr key={reading.id} className="group hover:bg-secondary/20 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-foreground font-medium">
                      {format(new Date(reading.periodStart), "MMM d")} – {format(new Date(reading.periodEnd), "MMM d, yyyy")}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <UtilityIcon type={reading.utilityType} />
                        <span className="capitalize">{reading.utilityType}</span>
                        {reading.provider && <span className="text-muted-foreground text-xs">· {reading.provider}</span>}
                      </div>
                    </td>
                    <td className="px-6 py-4 font-medium">{reading.usageKwh ? `${reading.usageKwh.toLocaleString()} kWh` : "—"}</td>
                    <td className="px-6 py-4">
                      {reading.utilityType === "electricity" && reading.emissionNote ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium cursor-help ${
                              isRenewable ? "bg-emerald-900/40 text-emerald-300" :
                              isLive ? "bg-blue-900/40 text-blue-300" :
                              isHistorical ? "bg-violet-900/40 text-violet-300" :
                              "bg-secondary text-muted-foreground"
                            }`}>
                              {isRenewable && <Leaf className="w-3 h-3" />}
                              {factorG ?? (isRenewable ? "0 g/kWh" : "—")}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">{reading.emissionNote}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className={`font-medium ${reading.co2eKg === 0 ? "text-emerald-400" : reading.co2eKg ? "text-foreground" : "text-muted-foreground"}`}>
                        {reading.co2eKg != null ? `${reading.co2eKg.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg` : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      {confirmDeleteId === reading.id ? (
                        <span className="flex items-center justify-end gap-1 text-xs">
                          <button
                            onClick={() => deleteReading(reading.id)}
                            disabled={deletingId === reading.id}
                            className="px-2 py-1 rounded bg-red-900/50 text-red-300 hover:bg-red-800/60 transition-colors disabled:opacity-50"
                          >
                            {deletingId === reading.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Yes"}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1 rounded bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(reading.id)}
                          className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-red-900/30 text-muted-foreground hover:text-red-400 transition-all"
                          title="Delete reading"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {pageItems.length === 0 && (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                  {allReadings.length === 0 ? "No energy readings yet. Upload your first bill." : "No bills match your search."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-border/50 bg-secondary/10">
            <span className="text-xs text-muted-foreground">
              Page {safePage} of {totalPages} · {filtered.length} bill{filtered.length !== 1 ? "s" : ""}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7"
                disabled={safePage <= 1}
                onClick={() => setBillPage(p => Math.max(1, p - 1))}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7"
                disabled={safePage >= totalPages}
                onClick={() => setBillPage(p => Math.min(totalPages, p + 1))}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
        );
      })()}
    </div>
  );
}
