import { useCallback, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useListEnergyReadings, useUploadEnergyBill, useGetEnergyEmailAddress, UploadEnergyBillBodyUtilityType } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Zap, Upload, Mail, FileText, Loader2, Copy, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useDropzone } from "react-dropzone";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

export default function Energy() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const { toast } = useToast();
  
  const { data: readings, isLoading } = useListEnergyReadings(orgId!, undefined, { query: { enabled: !!orgId } });
  const { data: emailInfo } = useGetEnergyEmailAddress(orgId!, { query: { enabled: !!orgId } });
  const uploadBill = useUploadEnergyBill();

  const [isUploadOpen, setIsUploadOpen] = useState(false);
  type UtilityTypeKey = keyof typeof UploadEnergyBillBodyUtilityType;
  const [utilityType, setUtilityType] = useState<UtilityTypeKey>("electricity");
  const [copied, setCopied] = useState(false);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    try {
      await uploadBill.mutateAsync({
        orgId: orgId!,
        data: { file, utilityType }
      });
      toast({ title: "Bill uploaded successfully", description: "Data is being processed." });
      setIsUploadOpen(false);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Upload failed";
      toast({ variant: "destructive", title: "Upload failed", description: message });
    }
  }, [orgId, utilityType, uploadBill, toast]);

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
          <DialogContent className="bg-card border-border sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Upload Energy Bill</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Utility Type</label>
                <select 
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={utilityType}
                  onChange={(e) => setUtilityType(e.target.value as UtilityTypeKey)}
                >
                  <option value="electricity">Electricity</option>
                  <option value="gas">Gas</option>
                  <option value="water">Water</option>
                </select>
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
                
                {uploadBill.isPending && (
                  <div className="mt-4 flex items-center justify-center text-sm text-primary">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" /> Uploading & parsing...
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

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
                <th className="px-6 py-4">Cost</th>
                <th className="px-6 py-4">Source</th>
                <th className="px-6 py-4 text-right">CO₂e Impact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {readings?.items.map((reading) => (
                <tr key={reading.id} className="hover:bg-secondary/20 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-foreground font-medium">
                    {format(new Date(reading.periodStart), "MMM d")} - {format(new Date(reading.periodEnd), "MMM d, yyyy")}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Zap className={`w-4 h-4 ${reading.utilityType === 'electricity' ? 'text-yellow-500' : 'text-blue-400'}`} />
                      <span className="capitalize">{reading.utilityType}</span>
                      {reading.provider && <span className="text-muted-foreground text-xs block">• {reading.provider}</span>}
                    </div>
                  </td>
                  <td className="px-6 py-4 font-medium">{reading.usageKwh ? `${reading.usageKwh.toLocaleString()} kWh` : '-'}</td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {reading.costAmount ? `${reading.costAmount} ${reading.costCurrency || 'USD'}` : '-'}
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2.5 py-1 bg-secondary rounded-full text-xs capitalize">
                      {reading.source.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right text-emerald-400 font-medium">
                    {reading.co2eKg ? `${reading.co2eKg.toLocaleString()} kg` : '-'}
                  </td>
                </tr>
              ))}
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
