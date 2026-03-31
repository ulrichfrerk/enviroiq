import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useListEnergyReadings, useGetEnergyEmailAddress } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Zap, Upload, Mail, FileText, Loader2, Copy, Check, Leaf, Wind, Info } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDropzone } from "react-dropzone";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";

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

  if (isLoading) return null;
  if (error || !data) return null;

  const nzAvg = 97.7;
  const pctOfAvg = Math.round((data.gco2PerKwh / nzAvg) * 100);
  const isLow = data.gco2PerKwh < 60;
  const isMed = data.gco2PerKwh >= 60 && data.gco2PerKwh < 100;

  const intensityColor = isLow
    ? "text-emerald-400"
    : isMed
    ? "text-amber-400"
    : "text-red-400";
  const intensityBg = isLow
    ? "from-emerald-950/40 to-background border-emerald-800/30"
    : isMed
    ? "from-amber-950/40 to-background border-amber-800/30"
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
            <span className="flex items-center gap-1">
              <Wind className="w-3 h-3" />
              {data.renewablePct.toFixed(1)}% renewable
            </span>
            <span>{pctOfAvg}% of NZ yearly avg ({nzAvg} g)</span>
            <span>Updated {formatDistanceToNow(new Date(data.fetchedAt), { addSuffix: true })}</span>
          </div>
        </div>
        <div className="text-right shrink-0 hidden md:block">
          <div className="text-xs text-muted-foreground/60">Source</div>
          <div className="text-xs text-muted-foreground">em6 / EMS · Transpower NZ</div>
        </div>
      </div>
    </Card>
  );
}

export default function Energy() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const { toast } = useToast();
  const qc = useQueryClient();
  
  const { data: readings, isLoading } = useListEnergyReadings(orgId!, undefined, { query: { enabled: !!orgId } });
  const { data: emailInfo } = useGetEnergyEmailAddress(orgId!, { query: { enabled: !!orgId } });

  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [utilityType, setUtilityType] = useState("electricity");
  const [provider, setProvider] = useState("");
  const [supplierRenewablePct, setSupplierRenewablePct] = useState<number | "">("");
  const [periodStartOverride, setPeriodStartOverride] = useState("");
  const [periodEndOverride, setPeriodEndOverride] = useState("");
  const [copied, setCopied] = useState(false);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file || !orgId) return;

    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("utilityType", utilityType);
      if (provider) fd.append("provider", provider);
      if (supplierRenewablePct !== "") fd.append("supplierRenewablePct", String(supplierRenewablePct));
      if (periodStartOverride) fd.append("periodStartOverride", periodStartOverride);
      if (periodEndOverride) fd.append("periodEndOverride", periodEndOverride);

      const res = await fetch(`/api/organisations/${orgId}/energy/upload`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json() as {message?: string}).message ?? "Upload failed");
      const result = await res.json() as { emissionFactorUsed?: { method: string; note: string } };

      await qc.invalidateQueries({ queryKey: ["listEnergyReadings", orgId] });
      toast({
        title: "Bill uploaded",
        description: result.emissionFactorUsed?.note ?? "Data processed successfully.",
      });
      setIsUploadOpen(false);
      setProvider("");
      setSupplierRenewablePct("");
      setPeriodStartOverride("");
      setPeriodEndOverride("");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Upload failed";
      toast({ variant: "destructive", title: "Upload failed", description: message });
    } finally {
      setIsUploading(false);
    }
  }, [orgId, utilityType, provider, supplierRenewablePct, periodStartOverride, periodEndOverride, qc, toast]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, 
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1
  });

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
        
        <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
          <DialogTrigger asChild>
            <Button className="hover-elevate active-elevate-2 shadow-lg shadow-primary/20">
              <Upload className="w-4 h-4 mr-2" /> Upload Bill PDF
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border sm:max-w-[540px]">
            <DialogHeader>
              <DialogTitle>Upload Energy Bill</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-2 block">Utility Type</label>
                  <select 
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={utilityType}
                    onChange={(e) => setUtilityType(e.target.value)}
                  >
                    <option value="electricity">Electricity</option>
                    <option value="gas">Gas</option>
                    <option value="water">Water</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Supplier / Provider</label>
                  <input
                    type="text"
                    placeholder="e.g. Contact Energy"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                  />
                </div>
              </div>

              {utilityType === "electricity" && (
                <div className="rounded-xl border border-emerald-800/30 bg-emerald-950/20 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Leaf className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-medium text-emerald-300">Renewable Source</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">
                        If your supplier sources from solar, wind, or hydro under a renewable tariff or PPA, set the renewable % here. 
                        EnviroIQ applies the GHG Protocol market-based method — a 100% renewable supplier results in 0 kg CO₂e.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={supplierRenewablePct === "" ? 0 : supplierRenewablePct}
                      onChange={(e) => setSupplierRenewablePct(Number(e.target.value))}
                      className="flex-1 accent-emerald-500"
                    />
                    <span className="text-sm font-semibold text-emerald-400 w-12 text-right">
                      {supplierRenewablePct === "" ? "0" : supplierRenewablePct}%
                    </span>
                    {supplierRenewablePct !== "" && Number(supplierRenewablePct) > 0 && (
                      <button onClick={() => setSupplierRenewablePct("")} className="text-xs text-muted-foreground hover:text-foreground">reset</button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {supplierRenewablePct === "" || Number(supplierRenewablePct) === 0
                      ? "Using NZ grid average for this billing period."
                      : Number(supplierRenewablePct) === 100
                      ? "100% renewable → 0 kg CO₂e (market-based method)."
                      : `${supplierRenewablePct}% renewable → ${(100 - Number(supplierRenewablePct))}% at grid average rate.`
                    }
                  </p>
                </div>
              )}

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <label className="text-sm font-medium">Billing Period</label>
                  <span className="text-xs text-muted-foreground">(optional — defaults to last month)</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">From</label>
                    <input
                      type="date"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      value={periodStartOverride}
                      onChange={(e) => setPeriodStartOverride(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">To</label>
                    <input
                      type="date"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      value={periodEndOverride}
                      onChange={(e) => setPeriodEndOverride(e.target.value)}
                    />
                  </div>
                </div>
                {periodStartOverride && (
                  <p className="text-xs text-muted-foreground mt-1.5">
                    EnviroIQ will use the official NZ grid emission factor for {new Date(periodStartOverride).getFullYear()} when calculating emissions.
                  </p>
                )}
              </div>
              
              <div 
                {...getRootProps()} 
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                  isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 bg-secondary/20"
                }`}
              >
                <input {...getInputProps()} />
                <div className="flex justify-center mb-4">
                  <div className="p-4 bg-background rounded-full shadow-sm">
                    <FileText className={`w-8 h-8 ${isDragActive ? "text-primary" : "text-muted-foreground"}`} />
                  </div>
                </div>
                <p className="font-medium text-foreground mb-1">
                  {isDragActive ? "Drop the PDF here" : "Drag & drop PDF bill here"}
                </p>
                <p className="text-xs text-muted-foreground">or click to browse files</p>
                
                {isUploading && (
                  <div className="mt-4 flex items-center justify-center text-sm text-primary">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" /> Uploading & calculating emissions...
                  </div>
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

      <Card className="border-border/50 overflow-hidden">
        <div className="p-6 border-b border-border/50 bg-secondary/20">
          <h3 className="font-semibold text-lg">Reading History</h3>
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
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {readings?.items.map((reading) => {
                const isRenewable = reading.emissionMethod?.includes("renewable");
                const isLive = reading.emissionMethod?.includes("live_em6");
                const isHistorical = reading.emissionMethod?.includes("annual_avg");
                const factorG = reading.gridIntensityKgCo2PerKwh != null
                  ? (reading.gridIntensityKgCo2PerKwh * 1000).toFixed(1) + " g/kWh"
                  : null;

                return (
                <tr key={reading.id} className="hover:bg-secondary/20 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-foreground font-medium">
                    {format(new Date(reading.periodStart), "MMM d")} – {format(new Date(reading.periodEnd), "MMM d, yyyy")}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Zap className={`w-4 h-4 shrink-0 ${reading.utilityType === 'electricity' ? 'text-yellow-500' : 'text-blue-400'}`} />
                      <span className="capitalize">{reading.utilityType}</span>
                      {reading.provider && <span className="text-muted-foreground text-xs">· {reading.provider}</span>}
                    </div>
                  </td>
                  <td className="px-6 py-4 font-medium">{reading.usageKwh ? `${reading.usageKwh.toLocaleString()} kWh` : '-'}</td>
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
                      {reading.co2eKg != null ? `${reading.co2eKg.toLocaleString(undefined, {maximumFractionDigits: 2})} kg` : '—'}
                    </span>
                  </td>
                </tr>
              );})}
              {(!readings?.items || readings.items.length === 0) && (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">No energy readings yet. Upload your first bill.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
