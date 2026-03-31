import { useState, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useListVehicles, useCreateVehicle, useDeleteVehicle, CreateVehicleRequestFuelType, CreateVehicleRequestGpsProvider } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Car, Plus, Trash2, Loader2, Navigation, Server, Upload, Download, CheckCircle2, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";

const CSV_TEMPLATE_HEADER = "name,registration,make,model,fuelType,gpsProvider,gpsDeviceId";
const CSV_TEMPLATE_ROWS = [
  "Truck 01,ABC123,Ford,Ranger,diesel,navman,DEV-001",
  "Van 02,XYZ789,Toyota,HiAce,petrol,none,",
  "EV Fleet 03,EV456,Tesla,Model 3,electric,blackhawk,DEV-003",
];
const CSV_TEMPLATE = [CSV_TEMPLATE_HEADER, ...CSV_TEMPLATE_ROWS].join("\n");

const FUEL_TYPES = ["petrol","diesel","electric","hybrid","lpg","hydrogen","other"];
const GPS_PROVIDERS = ["navman","blackhawk","generic","none"];

function parseVehicleCSV(text: string): { rows: Record<string, string>[]; errors: string[] } {
  const lines = text.trim().split(/\r?\n/);
  const errors: string[] = [];
  if (lines.length < 2) return { rows: [], errors: ["CSV must have a header row and at least one data row."] };

  const header = lines[0].split(",").map(h => h.trim().toLowerCase());
  const required = ["name", "fueltype"];
  for (const r of required) {
    if (!header.includes(r)) errors.push(`Missing required column: "${r}"`);
  }
  if (errors.length) return { rows: [], errors };

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = line.split(",").map(v => v.trim());
    const row: Record<string, string> = {};
    header.forEach((col, idx) => { row[col] = vals[idx] ?? ""; });
    if (!row.name) { errors.push(`Row ${i}: name is required`); continue; }
    const ft = row.fueltype || row.fuelType || "";
    if (!FUEL_TYPES.includes(ft)) { errors.push(`Row ${i}: invalid fuelType "${ft}" — must be one of: ${FUEL_TYPES.join(", ")}`); continue; }
    const gp = row.gpsprovider || row.gpsProvider || "none";
    if (!GPS_PROVIDERS.includes(gp)) { errors.push(`Row ${i}: invalid gpsProvider "${gp}" — must be one of: ${GPS_PROVIDERS.join(", ")}`); continue; }
    rows.push({ ...row, fuelType: ft, gpsProvider: gp });
  }
  return { rows, errors };
}

const vehicleSchema = z.object({
  name: z.string().min(1, "Name is required"),
  registration: z.string().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  fuelType: z.enum(["petrol", "diesel", "electric", "hybrid", "lpg", "hydrogen", "other"]),
  gpsProvider: z.enum(["navman", "blackhawk", "generic", "none"]),
  gpsDeviceId: z.string().optional(),
});

type ImportState = "idle" | "preview" | "importing" | "done";
type ImportRow = Record<string, string>;

export default function Fleet() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importState, setImportState] = useState<ImportState>("idle");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<{ ok: number; failed: number }>({ ok: 0, failed: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: vehicles, isLoading, refetch } = useListVehicles(orgId!, { query: { enabled: !!orgId } });
  const createVehicle = useCreateVehicle();
  const deleteVehicle = useDeleteVehicle();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { rows, errors } = parseVehicleCSV(text);
      setImportRows(rows);
      setImportErrors(errors);
      setImportState("preview");
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!orgId || !importRows.length) return;
    setImportState("importing");
    let ok = 0, failed = 0;
    for (let i = 0; i < importRows.length; i++) {
      const row = importRows[i];
      try {
        await createVehicle.mutateAsync({
          orgId,
          data: {
            name: row.name,
            registration: row.registration || undefined,
            make: row.make || undefined,
            model: row.model || undefined,
            fuelType: row.fuelType as CreateVehicleRequestFuelType,
            gpsProvider: (row.gpsProvider || "none") as CreateVehicleRequestGpsProvider,
            gpsDeviceId: row.gpsdeviceid || row.gpsDeviceId || undefined,
          },
        });
        ok++;
      } catch {
        failed++;
      }
      setImportProgress(Math.round(((i + 1) / importRows.length) * 100));
    }
    setImportResults({ ok, failed });
    setImportState("done");
    refetch();
  };

  const resetImport = () => {
    setImportState("idle");
    setImportRows([]);
    setImportErrors([]);
    setImportProgress(0);
    setImportResults({ ok: 0, failed: 0 });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "vehicles-template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const form = useForm<z.infer<typeof vehicleSchema>>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: {
      name: "",
      fuelType: "diesel",
      gpsProvider: "none",
    }
  });

  const onSubmit = async (data: z.infer<typeof vehicleSchema>) => {
    try {
      await createVehicle.mutateAsync({
        orgId: orgId!,
        data: {
          ...data,
          fuelType: data.fuelType as CreateVehicleRequestFuelType,
          gpsProvider: data.gpsProvider as CreateVehicleRequestGpsProvider,
        },
      });
      toast({ title: "Vehicle added" });
      setIsDialogOpen(false);
      form.reset();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Could not add vehicle";
      toast({ variant: "destructive", title: "Error", description: message });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this vehicle?")) return;
    try {
      await deleteVehicle.mutateAsync({ orgId: orgId!, vehicleId: id });
      toast({ title: "Vehicle removed" });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Could not remove vehicle";
      toast({ variant: "destructive", title: "Error", description: message });
    }
  };

  if (isLoading) return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Fleet Management</h1>
          <p className="text-muted-foreground mt-1">Manage vehicles and GPS integrations.</p>
        </div>
        
        <div className="flex gap-2">
          {/* Bulk CSV Import */}
          <Dialog open={isImportOpen} onOpenChange={(open) => { setIsImportOpen(open); if (!open) resetImport(); }}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Upload className="w-4 h-4" /> Import CSV
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>Bulk Import Vehicles</DialogTitle>
              </DialogHeader>

              {importState === "idle" && (
                <div className="space-y-4 pt-2">
                  <p className="text-sm text-muted-foreground">
                    Upload a CSV file to add multiple vehicles at once. Download the template to get started.
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground bg-secondary/20 rounded-lg p-4 font-mono">
                    <div><span className="text-foreground font-semibold">name</span> — required</div>
                    <div><span className="text-foreground font-semibold">registration</span> — optional</div>
                    <div><span className="text-foreground font-semibold">make</span> — optional</div>
                    <div><span className="text-foreground font-semibold">model</span> — optional</div>
                    <div><span className="text-foreground font-semibold">fuelType</span> — petrol, diesel, electric…</div>
                    <div><span className="text-foreground font-semibold">gpsProvider</span> — navman, blackhawk, none</div>
                  </div>
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1 gap-2" onClick={downloadTemplate}>
                      <Download className="w-4 h-4" /> Download Template
                    </Button>
                    <Button className="flex-1 gap-2" onClick={() => fileInputRef.current?.click()}>
                      <Upload className="w-4 h-4" /> Choose File
                    </Button>
                  </div>
                  <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileSelect} />
                </div>
              )}

              {importState === "preview" && (
                <div className="space-y-4 pt-2">
                  {importErrors.length > 0 && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-1">
                      <p className="text-sm font-semibold text-destructive mb-2">Validation errors — fix these in your CSV:</p>
                      {importErrors.map((e, i) => <p key={i} className="text-xs text-destructive">{e}</p>)}
                    </div>
                  )}
                  {importRows.length > 0 && (
                    <>
                      <p className="text-sm text-muted-foreground"><span className="font-semibold text-foreground">{importRows.length}</span> vehicle{importRows.length !== 1 ? "s" : ""} ready to import.</p>
                      <div className="max-h-48 overflow-y-auto rounded-lg border border-border text-xs">
                        <table className="w-full text-left">
                          <thead className="bg-secondary/40 sticky top-0">
                            <tr>
                              {["name","registration","fuelType","gpsProvider"].map(h => (
                                <th key={h} className="px-3 py-2 font-semibold text-muted-foreground uppercase">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/50">
                            {importRows.map((row, i) => (
                              <tr key={i} className="hover:bg-secondary/20">
                                <td className="px-3 py-2">{row.name}</td>
                                <td className="px-3 py-2 text-muted-foreground">{row.registration || "—"}</td>
                                <td className="px-3 py-2">{row.fuelType}</td>
                                <td className="px-3 py-2">{row.gpsProvider}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex gap-3">
                        <Button variant="outline" className="flex-1" onClick={resetImport}>Choose Different File</Button>
                        <Button className="flex-1 gap-2" onClick={handleImport}>
                          <Upload className="w-4 h-4" /> Import {importRows.length} Vehicle{importRows.length !== 1 ? "s" : ""}
                        </Button>
                      </div>
                    </>
                  )}
                  {importRows.length === 0 && importErrors.length > 0 && (
                    <Button variant="outline" className="w-full" onClick={resetImport}>Try Again</Button>
                  )}
                </div>
              )}

              {importState === "importing" && (
                <div className="space-y-4 pt-4 pb-2">
                  <p className="text-sm text-muted-foreground">Importing vehicles, please wait…</p>
                  <Progress value={importProgress} className="h-2" />
                  <p className="text-xs text-muted-foreground text-center">{importProgress}%</p>
                </div>
              )}

              {importState === "done" && (
                <div className="space-y-4 pt-4 pb-2">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-6 h-6 text-emerald-500 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-foreground">Import complete</p>
                      <p className="text-sm text-muted-foreground">
                        {importResults.ok} imported successfully
                        {importResults.failed > 0 && <>, <span className="text-destructive">{importResults.failed} failed</span></>}.
                      </p>
                    </div>
                  </div>
                  <Button className="w-full" onClick={() => { setIsImportOpen(false); resetImport(); }}>Done</Button>
                </div>
              )}
            </DialogContent>
          </Dialog>

          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="hover-elevate active-elevate-2 shadow-lg shadow-primary/20">
                <Plus className="w-4 h-4 mr-2" /> Add Vehicle
              </Button>
            </DialogTrigger>
          <DialogContent className="bg-card border-border sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Register New Vehicle</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem><FormLabel>Internal Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="registration" render={({ field }) => (
                    <FormItem><FormLabel>Registration Plate</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="fuelType" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fuel Type</FormLabel>
                      <FormControl>
                        <select 
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                          {...field}
                        >
                          <option value="diesel">Diesel</option>
                          <option value="petrol">Petrol</option>
                          <option value="electric">Electric</option>
                          <option value="hybrid">Hybrid</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="gpsProvider" render={({ field }) => (
                    <FormItem>
                      <FormLabel>GPS Provider</FormLabel>
                      <FormControl>
                        <select 
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                          {...field}
                        >
                          <option value="none">None</option>
                          <option value="navman">Navman</option>
                          <option value="blackhawk">Blackhawk</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="gpsDeviceId" render={({ field }) => (
                    <FormItem><FormLabel>Device ID (if applicable)</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
                <Button type="submit" className="w-full mt-4" disabled={createVehicle.isPending}>
                  {createVehicle.isPending ? "Saving..." : "Save Vehicle"}
                </Button>
              </form>
            </Form>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Webhook Info Card */}
      <Card className="p-6 bg-secondary/10 border-primary/20">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-primary/10 rounded-xl mt-1"><Server className="w-6 h-6 text-primary" /></div>
          <div className="flex-1">
            <h3 className="font-semibold text-lg">GPS Webhook Integration</h3>
            <p className="text-muted-foreground text-sm mt-1 mb-4">Configure your fleet provider to push data to these endpoints.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-3 bg-background rounded-lg border border-border">
                <p className="text-xs text-muted-foreground mb-1 uppercase font-semibold">Navman Endpoint</p>
                <code className="text-xs text-primary font-mono">{window.location.origin}/api/webhooks/fleet/navman</code>
              </div>
              <div className="p-3 bg-background rounded-lg border border-border">
                <p className="text-xs text-muted-foreground mb-1 uppercase font-semibold">Blackhawk Endpoint</p>
                <code className="text-xs text-primary font-mono">{window.location.origin}/api/webhooks/fleet/blackhawk</code>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card className="border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary/30 text-muted-foreground uppercase text-xs font-semibold">
              <tr>
                <th className="px-6 py-4">Vehicle Info</th>
                <th className="px-6 py-4">Fuel</th>
                <th className="px-6 py-4">GPS Integration</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {vehicles?.items.map((vehicle) => (
                <tr key={vehicle.id} className="hover:bg-secondary/20 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-secondary rounded-lg"><Car className="w-4 h-4 text-muted-foreground" /></div>
                      <div>
                        <div className="font-medium text-foreground">{vehicle.name}</div>
                        <div className="text-xs text-muted-foreground">{vehicle.registration || "No Reg"} • {vehicle.make}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 capitalize"><span className="px-2.5 py-1 bg-secondary rounded-full text-xs">{vehicle.fuelType}</span></td>
                  <td className="px-6 py-4">
                    {vehicle.gpsProvider !== 'none' ? (
                      <div className="flex items-center text-xs text-emerald-400 gap-1"><Navigation className="w-3 h-3" /> {vehicle.gpsProvider}</div>
                    ) : <span className="text-xs text-muted-foreground">None</span>}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs ${vehicle.isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-destructive/10 text-destructive'}`}>
                      {vehicle.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(vehicle.id)} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
              {(!vehicles?.items || vehicles.items.length === 0) && (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">No vehicles registered. Add your first vehicle above.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
