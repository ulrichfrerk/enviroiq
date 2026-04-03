import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Recycle, Droplets, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

type WasteRecord = {
  id: string; recordedAt: string; wasteType: string; quantityKg: number;
  disposalMethod: string; diverted: boolean; siteOrLocation?: string; notes?: string;
};
type EnvIncident = {
  id: string; incidentDate: string; incidentType: string; description: string;
  severity: string; reportedToRegulator: boolean; correctiveAction?: string; closedOut: boolean;
};
type WaterReading = { id: string; readingDate: string; cubicMetres: number; meterRef?: string; notes?: string };
type WasteSummary = { totalKg: number; divertedKg: number; recordCount: number; diversionRate: number; byType: Record<string,unknown>[]; byMethod: Record<string,unknown>[]; waterM3: number };

const WASTE_TYPES = ["general", "construction_debris", "concrete", "timber", "steel", "hazardous", "organic", "recyclable", "cardboard_paper", "glass", "e_waste", "other"];
const DISPOSAL_METHODS = ["landfill", "recycled", "reused", "composted", "hazardous_disposal", "transfer_station"];
const INCIDENT_TYPES = ["chemical_spill", "fuel_spill", "dust_nuisance", "noise_nuisance", "stormwater_contamination", "vegetation_damage", "waste_discharge", "other"];
const SEVERITY = ["minor", "moderate", "serious", "critical"];

function wasteLabel(s: string) { return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }

const emptyWaste = { recordedAt: new Date().toISOString().substring(0, 10), wasteType: "general", quantityKg: "", disposalMethod: "landfill", diverted: "false", siteOrLocation: "", notes: "" };
const emptyIncident = { incidentDate: new Date().toISOString().substring(0, 10), incidentType: "chemical_spill", description: "", severity: "minor", reportedToRegulator: "false", correctiveAction: "", closedOut: "false" };
const emptyWater = { readingDate: new Date().toISOString().substring(0, 10), cubicMetres: "", meterRef: "", notes: "" };

export default function WastePage() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const qc = useQueryClient();
  const [wasteOpen, setWasteOpen] = useState(false);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [waterOpen, setWaterOpen] = useState(false);
  const [wasteForm, setWF] = useState<Record<string, string>>(emptyWaste);
  const [incidentForm, setIF] = useState<Record<string, string>>(emptyIncident);
  const [waterForm, setWtF] = useState<Record<string, string>>(emptyWater);

  const { data: records = [] } = useQuery<WasteRecord[]>({ queryKey: ["waste", orgId], queryFn: () => apiClient(`/organisations/${orgId}/waste/records`), enabled: !!orgId });
  const { data: incidents = [] } = useQuery<EnvIncident[]>({ queryKey: ["env-incidents", orgId], queryFn: () => apiClient(`/organisations/${orgId}/waste/incidents`), enabled: !!orgId });
  const { data: waterReadings = [] } = useQuery<WaterReading[]>({ queryKey: ["water", orgId], queryFn: () => apiClient(`/organisations/${orgId}/waste/water`), enabled: !!orgId });
  const { data: summary } = useQuery<WasteSummary>({ queryKey: ["waste-summary", orgId], queryFn: () => apiClient(`/organisations/${orgId}/waste/summary`), enabled: !!orgId });

  const addWaste = useMutation({
    mutationFn: (d: Record<string, unknown>) => apiClient(`/organisations/${orgId}/waste/records`, { method: "POST", body: d }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["waste", orgId] }); qc.invalidateQueries({ queryKey: ["waste-summary", orgId] }); setWasteOpen(false); toast.success("Waste record added"); },
    onError: () => toast.error("Failed to add record"),
  });
  const delWaste = useMutation({
    mutationFn: (id: string) => apiClient(`/organisations/${orgId}/waste/records/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["waste", orgId] }); qc.invalidateQueries({ queryKey: ["waste-summary", orgId] }); toast.success("Deleted"); },
  });
  const addIncident = useMutation({
    mutationFn: (d: Record<string, unknown>) => apiClient(`/organisations/${orgId}/waste/incidents`, { method: "POST", body: d }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["env-incidents", orgId] }); setIncidentOpen(false); toast.success("Incident logged"); },
    onError: () => toast.error("Failed to log incident"),
  });
  const addWater = useMutation({
    mutationFn: (d: Record<string, unknown>) => apiClient(`/organisations/${orgId}/waste/water`, { method: "POST", body: d }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["water", orgId] }); setWaterOpen(false); toast.success("Water reading added"); },
    onError: () => toast.error("Failed to save"),
  });

  const sev: Record<string, string> = { minor: "bg-yellow-100 text-yellow-800", moderate: "bg-orange-100 text-orange-800", serious: "bg-red-100 text-red-800", critical: "bg-red-900 text-white" };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Waste & Environmental</h1>
        <p className="text-muted-foreground text-sm mt-1">Track waste diversion, environmental incidents, and water consumption for tender reporting</p>
      </div>

      {/* KPI strip */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-card border rounded-xl p-4">
            <div className="text-2xl font-bold text-foreground">{(summary.totalKg / 1000).toFixed(2)}</div>
            <div className="text-sm text-muted-foreground mt-1">Total Waste (tonnes)</div>
          </div>
          <div className="bg-card border rounded-xl p-4">
            <div className="text-2xl font-bold text-green-600">{summary.diversionRate.toFixed(1)}%</div>
            <div className="text-sm text-muted-foreground mt-1">Diversion Rate</div>
          </div>
          <div className="bg-card border rounded-xl p-4">
            <div className="text-2xl font-bold text-blue-600">{summary.waterM3.toLocaleString("en-NZ", { maximumFractionDigits: 1 })}</div>
            <div className="text-sm text-muted-foreground mt-1">Water Used (m³)</div>
          </div>
          <div className="bg-card border rounded-xl p-4">
            <div className="text-2xl font-bold text-orange-600">{incidents.filter(i => !i.closedOut).length}</div>
            <div className="text-sm text-muted-foreground mt-1">Open Env. Incidents</div>
          </div>
        </div>
      )}

      <Tabs defaultValue="waste">
        <TabsList>
          <TabsTrigger value="waste" className="gap-2"><Recycle className="w-3.5 h-3.5" />Waste Records</TabsTrigger>
          <TabsTrigger value="incidents" className="gap-2"><AlertTriangle className="w-3.5 h-3.5" />Environmental Incidents</TabsTrigger>
          <TabsTrigger value="water" className="gap-2"><Droplets className="w-3.5 h-3.5" />Water Use</TabsTrigger>
        </TabsList>

        {/* ── Waste Records ── */}
        <TabsContent value="waste" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => { setWF(emptyWaste); setWasteOpen(true); }} className="gap-2"><Plus className="w-4 h-4" />Add Waste Record</Button>
          </div>
          {records.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground"><Recycle className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>No waste records yet</p></div>
          ) : (
            <div className="border rounded-xl overflow-hidden bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>{["Date", "Type", "Qty (kg)", "Disposal Method", "Diverted", "Site", ""].map(h => <th key={h} className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {records.map((r, i) => (
                    <tr key={r.id} className={i % 2 === 0 ? "bg-card" : "bg-muted/20"}>
                      <td className="px-4 py-2.5">{new Date(r.recordedAt).toLocaleDateString("en-NZ")}</td>
                      <td className="px-4 py-2.5 font-medium">{wasteLabel(r.wasteType)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{r.quantityKg.toLocaleString("en-NZ")}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{wasteLabel(r.disposalMethod)}</td>
                      <td className="px-4 py-2.5">{r.diverted ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 py-2.5 text-muted-foreground text-xs">{r.siteOrLocation ?? "—"}</td>
                      <td className="px-4 py-2.5"><Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => delWaste.mutate(r.id)}><Trash2 className="w-3.5 h-3.5" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ── Environmental Incidents ── */}
        <TabsContent value="incidents" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => { setIF(emptyIncident); setIncidentOpen(true); }} className="gap-2"><Plus className="w-4 h-4" />Log Incident</Button>
          </div>
          {incidents.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground"><AlertTriangle className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>No environmental incidents logged</p></div>
          ) : (
            <div className="space-y-3">
              {incidents.map(i => (
                <div key={i.id} className="border rounded-xl p-4 bg-card flex items-start justify-between gap-4">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{wasteLabel(i.incidentType)}</span>
                      <Badge className={`${sev[i.severity] ?? "bg-gray-100 text-gray-700"} border-0 text-xs`}>{wasteLabel(i.severity)}</Badge>
                      {i.closedOut && <Badge className="bg-green-100 text-green-800 border-0 text-xs">Closed Out</Badge>}
                      {i.reportedToRegulator && <Badge className="bg-blue-100 text-blue-800 border-0 text-xs">Reported to Regulator</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">{i.description}</p>
                    {i.correctiveAction && <p className="text-xs text-muted-foreground italic">Corrective action: {i.correctiveAction}</p>}
                    <p className="text-xs text-muted-foreground">{new Date(i.incidentDate).toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" })}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Water ── */}
        <TabsContent value="water" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => { setWtF(emptyWater); setWaterOpen(true); }} className="gap-2"><Plus className="w-4 h-4" />Add Reading</Button>
          </div>
          {waterReadings.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground"><Droplets className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>No water readings yet</p></div>
          ) : (
            <div className="border rounded-xl overflow-hidden bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>{["Date", "Volume (m³)", "Meter Ref", "Notes"].map(h => <th key={h} className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {waterReadings.map((r, i) => (
                    <tr key={r.id} className={i % 2 === 0 ? "bg-card" : "bg-muted/20"}>
                      <td className="px-4 py-2.5">{new Date(r.readingDate).toLocaleDateString("en-NZ")}</td>
                      <td className="px-4 py-2.5 font-mono text-right">{r.cubicMetres.toLocaleString("en-NZ", { maximumFractionDigits: 2 })}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r.meterRef ?? "—"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground text-xs">{r.notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Waste dialog */}
      <Dialog open={wasteOpen} onOpenChange={setWasteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Waste Record</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Date</Label><Input type="date" value={wasteForm.recordedAt} onChange={e => setWF(f => ({ ...f, recordedAt: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Waste Type</Label>
                <Select value={wasteForm.wasteType} onValueChange={v => setWF(f => ({ ...f, wasteType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{WASTE_TYPES.map(t => <SelectItem key={t} value={t}>{wasteLabel(t)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Quantity (kg)</Label><Input type="number" value={wasteForm.quantityKg} onChange={e => setWF(f => ({ ...f, quantityKg: e.target.value }))} /></div>
            </div>
            <div><Label>Disposal Method</Label>
              <Select value={wasteForm.disposalMethod} onValueChange={v => setWF(f => ({ ...f, disposalMethod: v, diverted: ["recycled", "reused", "composted"].includes(v) ? "true" : f.diverted }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DISPOSAL_METHODS.map(m => <SelectItem key={m} value={m}>{wasteLabel(m)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Diverted from Landfill?</Label>
              <Select value={wasteForm.diverted} onValueChange={v => setWF(f => ({ ...f, diverted: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="true">Yes</SelectItem><SelectItem value="false">No</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>Site / Location</Label><Input value={wasteForm.siteOrLocation} onChange={e => setWF(f => ({ ...f, siteOrLocation: e.target.value }))} placeholder="e.g. Mt Eden site" /></div>
            <div><Label>Notes</Label><Textarea value={wasteForm.notes} onChange={e => setWF(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWasteOpen(false)}>Cancel</Button>
            <Button onClick={() => addWaste.mutate({ ...wasteForm, quantityKg: Number(wasteForm.quantityKg), diverted: wasteForm.diverted === "true", recordedAt: new Date(wasteForm.recordedAt).toISOString() })} disabled={addWaste.isPending}>{addWaste.isPending ? "Saving…" : "Add Record"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Incident dialog */}
      <Dialog open={incidentOpen} onOpenChange={setIncidentOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Log Environmental Incident</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date</Label><Input type="date" value={incidentForm.incidentDate} onChange={e => setIF(f => ({ ...f, incidentDate: e.target.value }))} /></div>
              <div><Label>Severity</Label>
                <Select value={incidentForm.severity} onValueChange={v => setIF(f => ({ ...f, severity: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SEVERITY.map(s => <SelectItem key={s} value={s}>{wasteLabel(s)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Incident Type</Label>
              <Select value={incidentForm.incidentType} onValueChange={v => setIF(f => ({ ...f, incidentType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{INCIDENT_TYPES.map(t => <SelectItem key={t} value={t}>{wasteLabel(t)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Description *</Label><Textarea value={incidentForm.description} onChange={e => setIF(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Describe what happened, where, and immediate response" /></div>
            <div><Label>Corrective Action</Label><Textarea value={incidentForm.correctiveAction} onChange={e => setIF(f => ({ ...f, correctiveAction: e.target.value }))} rows={2} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Reported to Regulator?</Label>
                <Select value={incidentForm.reportedToRegulator} onValueChange={v => setIF(f => ({ ...f, reportedToRegulator: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="false">No</SelectItem><SelectItem value="true">Yes</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>Closed Out?</Label>
                <Select value={incidentForm.closedOut} onValueChange={v => setIF(f => ({ ...f, closedOut: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="false">No</SelectItem><SelectItem value="true">Yes</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIncidentOpen(false)}>Cancel</Button>
            <Button onClick={() => { if (!incidentForm.description.trim()) { toast.error("Description required"); return; } addIncident.mutate({ ...incidentForm, reportedToRegulator: incidentForm.reportedToRegulator === "true", closedOut: incidentForm.closedOut === "true", incidentDate: new Date(incidentForm.incidentDate).toISOString() }); }} disabled={addIncident.isPending}>{addIncident.isPending ? "Saving…" : "Log Incident"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Water dialog */}
      <Dialog open={waterOpen} onOpenChange={setWaterOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Water Reading</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Date</Label><Input type="date" value={waterForm.readingDate} onChange={e => setWtF(f => ({ ...f, readingDate: e.target.value }))} /></div>
            <div><Label>Volume (m³)</Label><Input type="number" step="0.01" value={waterForm.cubicMetres} onChange={e => setWtF(f => ({ ...f, cubicMetres: e.target.value }))} /></div>
            <div><Label>Meter Reference</Label><Input value={waterForm.meterRef} onChange={e => setWtF(f => ({ ...f, meterRef: e.target.value }))} placeholder="e.g. WN-001" /></div>
            <div><Label>Notes</Label><Textarea value={waterForm.notes} onChange={e => setWtF(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaterOpen(false)}>Cancel</Button>
            <Button onClick={() => addWater.mutate({ ...waterForm, cubicMetres: Number(waterForm.cubicMetres), readingDate: new Date(waterForm.readingDate).toISOString() })} disabled={addWater.isPending}>{addWater.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
