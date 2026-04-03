import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Users, Heart, GraduationCap, Plus, Trash2, Loader2, Save,
  CheckCircle2, AlertTriangle, Clock, X, ChevronDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkforceSnapshot {
  id?: string;
  periodYear: number;
  headcount?: number | null;
  fteCount?: number | null;
  contractorCount?: number | null;
  turnoverPct?: number | null;
  femalePct?: number | null;
  femaleLeadershipPct?: number | null;
  payEquityGapPct?: number | null;
  livingWageAccredited?: boolean;
  localSupplierPct?: number | null;
  volunteerHours?: number | null;
  charityDonationNzd?: number | null;
  modernSlaveryCompliant?: boolean;
  supplierCodeOfConduct?: boolean;
  notes?: string | null;
}

interface HsIncident {
  id: string;
  incidentDate: string;
  incidentType: string;
  description?: string | null;
  daysLost?: number | null;
  hoursWorkedAtTime?: number | null;
  reportedBy?: string | null;
  closedOut?: boolean;
}

interface TrainingRecord {
  id: string;
  employeeName: string;
  trainingDate: string;
  topic: string;
  hours: number;
  provider?: string | null;
  category?: string | null;
}

const INCIDENT_TYPES = [
  { value: "near_miss", label: "Near Miss", color: "bg-yellow-100 text-yellow-800" },
  { value: "first_aid", label: "First Aid", color: "bg-blue-100 text-blue-800" },
  { value: "medical_treatment", label: "Medical Treatment", color: "bg-orange-100 text-orange-800" },
  { value: "lost_time", label: "Lost Time Injury", color: "bg-red-100 text-red-800" },
  { value: "fatality", label: "Fatality", color: "bg-red-900 text-white" },
];

const TRAINING_CATEGORIES = [
  "Health & Safety",
  "Leadership",
  "Technical / Trade",
  "Compliance",
  "Environmental",
  "Diversity & Inclusion",
  "Other",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function numField(val: number | null | undefined): string {
  return val == null ? "" : String(val);
}

function parseNum(val: string): number | null {
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function parseIntOrNull(val: string): number | null {
  const n = parseInt(val);
  return isNaN(n) ? null : n;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Social() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const { toast } = useToast();
  const qc = useQueryClient();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  // ── Workforce ──────────────────────────────────────────────────────────────

  const { data: workforce, isLoading: wfLoading } = useQuery<WorkforceSnapshot | null>({
    queryKey: ["social-workforce", orgId, year],
    queryFn: async () => {
      const r = await fetch(`/api/organisations/${orgId}/social/workforce?year=${year}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!orgId,
  });

  const [wfDraft, setWfDraft] = useState<WorkforceSnapshot | null>(null);
  const activeDraft: WorkforceSnapshot = wfDraft ?? (workforce ?? { periodYear: year });

  const saveWorkforce = useMutation({
    mutationFn: async (data: WorkforceSnapshot) => {
      const r = await fetch(`/api/organisations/${orgId}/social/workforce`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, periodYear: year }),
      });
      if (!r.ok) throw new Error("Failed to save");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["social-workforce", orgId, year] });
      setWfDraft(null);
      toast({ title: "Workforce data saved" });
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  function wfSet(field: keyof WorkforceSnapshot, value: unknown) {
    setWfDraft((prev) => ({ ...(prev ?? activeDraft), [field]: value }));
  }

  // ── H&S Incidents ──────────────────────────────────────────────────────────

  const { data: incidents = [], isLoading: incLoading } = useQuery<HsIncident[]>({
    queryKey: ["hs-incidents", orgId],
    queryFn: async () => {
      const r = await fetch(`/api/organisations/${orgId}/social/incidents`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!orgId,
  });

  const [incDialog, setIncDialog] = useState(false);
  const [incForm, setIncForm] = useState({
    incidentDate: format(new Date(), "yyyy-MM-dd"),
    incidentType: "near_miss",
    description: "",
    daysLost: "",
    hoursWorkedAtTime: "",
    reportedBy: "",
    closedOut: false,
  });

  const addIncident = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/organisations/${orgId}/social/incidents`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...incForm,
          daysLost: parseIntOrNull(incForm.daysLost) ?? 0,
          hoursWorkedAtTime: parseNum(incForm.hoursWorkedAtTime),
        }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hs-incidents", orgId] });
      setIncDialog(false);
      setIncForm({ incidentDate: format(new Date(), "yyyy-MM-dd"), incidentType: "near_miss", description: "", daysLost: "", hoursWorkedAtTime: "", reportedBy: "", closedOut: false });
      toast({ title: "Incident recorded" });
    },
    onError: () => toast({ title: "Failed to add incident", variant: "destructive" }),
  });

  const deleteIncident = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/organisations/${orgId}/social/incidents/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hs-incidents", orgId] }),
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const closeIncident = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/organisations/${orgId}/social/incidents/${id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closedOut: true }),
      });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hs-incidents", orgId] }),
  });

  // ── Training ──────────────────────────────────────────────────────────────

  const { data: training = [], isLoading: trLoading } = useQuery<TrainingRecord[]>({
    queryKey: ["training-records", orgId],
    queryFn: async () => {
      const r = await fetch(`/api/organisations/${orgId}/social/training`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!orgId,
  });

  const [trDialog, setTrDialog] = useState(false);
  const [trForm, setTrForm] = useState({
    employeeName: "",
    trainingDate: format(new Date(), "yyyy-MM-dd"),
    topic: "",
    hours: "",
    provider: "",
    category: "Health & Safety",
  });

  const addTraining = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/organisations/${orgId}/social/training`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...trForm, hours: parseFloat(trForm.hours) || 0 }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["training-records", orgId] });
      setTrDialog(false);
      setTrForm({ employeeName: "", trainingDate: format(new Date(), "yyyy-MM-dd"), topic: "", hours: "", provider: "", category: "Health & Safety" });
      toast({ title: "Training record added" });
    },
    onError: () => toast({ title: "Failed to add record", variant: "destructive" }),
  });

  const deleteTraining = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/organisations/${orgId}/social/training/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["training-records", orgId] }),
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  // ── Computed stats ─────────────────────────────────────────────────────────

  const currentYearIncidents = incidents.filter(
    (i) => new Date(i.incidentDate).getFullYear() === year
  );
  const ltiCount = currentYearIncidents.filter((i) => i.incidentType === "lost_time").length;
  const totalDaysLost = currentYearIncidents.reduce((s, i) => s + (i.daysLost || 0), 0);
  const openCount = currentYearIncidents.filter((i) => !i.closedOut).length;

  const currentYearTraining = training.filter(
    (t) => new Date(t.trainingDate).getFullYear() === year
  );
  const totalTrainingHours = currentYearTraining.reduce((s, t) => s + (t.hours || 0), 0);
  const avgHrs =
    activeDraft.headcount && activeDraft.headcount > 0
      ? (totalTrainingHours / activeDraft.headcount).toFixed(1)
      : null;

  const incidentTypeMeta = (type: string) =>
    INCIDENT_TYPES.find((t) => t.value === type) ?? { label: type, color: "bg-gray-100 text-gray-800" };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" /> Social
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Workforce metrics, health &amp; safety, and training records
          </p>
        </div>
        <Select value={String(year)} onValueChange={(v) => { setYear(parseInt(v)); setWfDraft(null); }}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 5 }, (_, i) => currentYear - i).map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="workforce">
        <TabsList className="mb-4">
          <TabsTrigger value="workforce"><Users className="w-4 h-4 mr-2" />Workforce</TabsTrigger>
          <TabsTrigger value="hs">
            <Heart className="w-4 h-4 mr-2" />Health &amp; Safety
            {openCount > 0 && (
              <Badge variant="destructive" className="ml-2 h-5 min-w-5 text-xs">{openCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="training"><GraduationCap className="w-4 h-4 mr-2" />Training</TabsTrigger>
        </TabsList>

        {/* ── Workforce Tab ─────────────────────────────────────────────── */}
        <TabsContent value="workforce">
          {wfLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="animate-spin w-4 h-4" />Loading…</div>
          ) : (
            <div className="space-y-4">
              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Headcount", value: activeDraft.headcount ?? "—" },
                  { label: "Turnover", value: activeDraft.turnoverPct != null ? `${activeDraft.turnoverPct}%` : "—" },
                  { label: "% Female", value: activeDraft.femalePct != null ? `${activeDraft.femalePct}%` : "—" },
                  { label: "Living Wage", value: activeDraft.livingWageAccredited ? "Yes ✓" : "No" },
                ].map((c) => (
                  <Card key={c.label}>
                    <CardContent className="pt-4 pb-3">
                      <p className="text-xs text-muted-foreground">{c.label}</p>
                      <p className="text-2xl font-bold text-foreground mt-1">{c.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Staff */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Staff</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {[
                      { label: "Total headcount", field: "headcount" as const, isInt: true },
                      { label: "FTEs", field: "fteCount" as const },
                      { label: "Contractors", field: "contractorCount" as const, isInt: true },
                      { label: "Annual turnover (%)", field: "turnoverPct" as const },
                    ].map(({ label, field, isInt }) => (
                      <div key={field} className="grid grid-cols-2 items-center gap-2">
                        <Label className="text-sm">{label}</Label>
                        <Input
                          type="number"
                          step={isInt ? "1" : "0.1"}
                          value={numField(activeDraft[field] as number | null | undefined)}
                          onChange={(e) => wfSet(field, isInt ? parseIntOrNull(e.target.value) : parseNum(e.target.value))}
                          placeholder="—"
                        />
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Diversity */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Diversity &amp; Inclusion</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {[
                      { label: "Female workforce (%)", field: "femalePct" as const },
                      { label: "Female leadership (%)", field: "femaleLeadershipPct" as const },
                      { label: "Pay equity gap (%)", field: "payEquityGapPct" as const },
                    ].map(({ label, field }) => (
                      <div key={field} className="grid grid-cols-2 items-center gap-2">
                        <Label className="text-sm">{label}</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={numField(activeDraft[field] as number | null | undefined)}
                          onChange={(e) => wfSet(field, parseNum(e.target.value))}
                          placeholder="—"
                        />
                      </div>
                    ))}
                    <div className="grid grid-cols-2 items-center gap-2">
                      <Label className="text-sm">Living Wage accredited</Label>
                      <Switch
                        checked={activeDraft.livingWageAccredited ?? false}
                        onCheckedChange={(v) => wfSet("livingWageAccredited", v)}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Community */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Community &amp; Supply Chain</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {[
                      { label: "NZ-based supplier spend (%)", field: "localSupplierPct" as const },
                      { label: "Volunteer hours (year)", field: "volunteerHours" as const },
                      { label: "Charitable giving (NZD)", field: "charityDonationNzd" as const },
                    ].map(({ label, field }) => (
                      <div key={field} className="grid grid-cols-2 items-center gap-2">
                        <Label className="text-sm">{label}</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={numField(activeDraft[field] as number | null | undefined)}
                          onChange={(e) => wfSet(field, parseNum(e.target.value))}
                          placeholder="—"
                        />
                      </div>
                    ))}
                    <div className="grid grid-cols-2 items-center gap-2">
                      <Label className="text-sm">Modern Slavery Act compliant</Label>
                      <Switch
                        checked={activeDraft.modernSlaveryCompliant ?? false}
                        onCheckedChange={(v) => wfSet("modernSlaveryCompliant", v)}
                      />
                    </div>
                    <div className="grid grid-cols-2 items-center gap-2">
                      <Label className="text-sm">Supplier code of conduct</Label>
                      <Switch
                        checked={activeDraft.supplierCodeOfConduct ?? false}
                        onCheckedChange={(v) => wfSet("supplierCodeOfConduct", v)}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Notes */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Notes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      className="min-h-[120px]"
                      placeholder="Any additional social context for the reporting period…"
                      value={activeDraft.notes ?? ""}
                      onChange={(e) => wfSet("notes", e.target.value)}
                    />
                  </CardContent>
                </Card>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={() => saveWorkforce.mutate(activeDraft)}
                  disabled={saveWorkforce.isPending || !wfDraft}
                >
                  {saveWorkforce.isPending ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                  Save Workforce Data
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── H&S Tab ────────────────────────────────────────────────────── */}
        <TabsContent value="hs">
          <div className="space-y-4">
            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: `Incidents (${year})`, value: currentYearIncidents.length },
                { label: "Lost-Time Injuries", value: ltiCount },
                { label: "Days Lost", value: totalDaysLost },
                { label: "Open / Unresolved", value: openCount },
              ].map((c) => (
                <Card key={c.label} className={c.label === "Open / Unresolved" && openCount > 0 ? "border-destructive/50" : ""}>
                  <CardContent className="pt-4 pb-3">
                    <p className="text-xs text-muted-foreground">{c.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${c.label === "Open / Unresolved" && openCount > 0 ? "text-destructive" : "text-foreground"}`}>{c.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* LTIFR note */}
            {ltiCount > 0 && activeDraft.headcount && (
              <Card className="bg-muted/30">
                <CardContent className="pt-3 pb-3 text-sm text-muted-foreground">
                  <strong>LTIFR:</strong> {((ltiCount / (activeDraft.headcount * 2000)) * 1_000_000).toFixed(2)} per million hours worked
                  <span className="ml-2 text-xs">(based on {activeDraft.headcount} staff × 2,000 hrs)</span>
                </CardContent>
              </Card>
            )}

            <div className="flex justify-end">
              <Button onClick={() => setIncDialog(true)}>
                <Plus className="w-4 h-4 mr-2" />Record Incident
              </Button>
            </div>

            {incLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground py-6"><Loader2 className="animate-spin w-4 h-4" />Loading…</div>
            ) : incidents.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Heart className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="font-medium">No incidents recorded</p>
                  <p className="text-sm">That's great news — keep it up.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {incidents.map((inc) => {
                  const meta = incidentTypeMeta(inc.incidentType);
                  return (
                    <Card key={inc.id} className={`${inc.closedOut ? "opacity-60" : ""}`}>
                      <CardContent className="py-3 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge className={`text-xs ${meta.color}`}>{meta.label}</Badge>
                            <span className="text-xs text-muted-foreground">{format(new Date(inc.incidentDate), "d MMM yyyy")}</span>
                            {inc.closedOut && (
                              <Badge variant="outline" className="text-xs text-green-700 border-green-300">
                                <CheckCircle2 className="w-3 h-3 mr-1" />Closed
                              </Badge>
                            )}
                            {!inc.closedOut && (
                              <Badge variant="outline" className="text-xs text-orange-700 border-orange-300">
                                <Clock className="w-3 h-3 mr-1" />Open
                              </Badge>
                            )}
                          </div>
                          {inc.description && (
                            <p className="text-sm text-foreground mt-1">{inc.description}</p>
                          )}
                          <div className="text-xs text-muted-foreground mt-1 flex gap-3 flex-wrap">
                            {inc.daysLost != null && inc.daysLost > 0 && <span>{inc.daysLost} day{inc.daysLost !== 1 ? "s" : ""} lost</span>}
                            {inc.reportedBy && <span>Reported by: {inc.reportedBy}</span>}
                          </div>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          {!inc.closedOut && (
                            <Button variant="outline" size="sm" className="text-xs h-7"
                              onClick={() => closeIncident.mutate(inc.id)}>
                              <CheckCircle2 className="w-3 h-3 mr-1" />Close
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteIncident.mutate(inc.id)}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Training Tab ────────────────────────────────────────────────── */}
        <TabsContent value="training">
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { label: `Records (${year})`, value: currentYearTraining.length },
                { label: "Total Hours", value: totalTrainingHours.toFixed(0) },
                { label: "Avg hrs / employee", value: avgHrs ? `${avgHrs} hrs` : "—" },
              ].map((c) => (
                <Card key={c.label}>
                  <CardContent className="pt-4 pb-3">
                    <p className="text-xs text-muted-foreground">{c.label}</p>
                    <p className="text-2xl font-bold text-foreground mt-1">{c.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex justify-end">
              <Button onClick={() => setTrDialog(true)}>
                <Plus className="w-4 h-4 mr-2" />Add Training Record
              </Button>
            </div>

            {trLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground py-6"><Loader2 className="animate-spin w-4 h-4" />Loading…</div>
            ) : training.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <GraduationCap className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="font-medium">No training records yet</p>
                  <p className="text-sm">Start logging training sessions to track hours per employee.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {training.map((tr) => (
                  <Card key={tr.id}>
                    <CardContent className="py-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-foreground">{tr.employeeName}</span>
                          {tr.category && <Badge variant="secondary" className="text-xs">{tr.category}</Badge>}
                          <span className="text-xs text-muted-foreground">{format(new Date(tr.trainingDate), "d MMM yyyy")}</span>
                        </div>
                        <p className="text-sm text-foreground mt-0.5">{tr.topic}</p>
                        <div className="text-xs text-muted-foreground mt-0.5 flex gap-3 flex-wrap">
                          <span>{tr.hours} hr{tr.hours !== 1 ? "s" : ""}</span>
                          {tr.provider && <span>Provider: {tr.provider}</span>}
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteTraining.mutate(tr.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Add Incident Dialog ─────────────────────────────────────────────── */}
      <Dialog open={incDialog} onOpenChange={setIncDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Health &amp; Safety Incident</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" value={incForm.incidentDate} onChange={(e) => setIncForm((f) => ({ ...f, incidentDate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Incident Type</Label>
              <Select value={incForm.incidentType} onValueChange={(v) => setIncForm((f) => ({ ...f, incidentType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INCIDENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea placeholder="Brief description of what happened…" value={incForm.description} onChange={(e) => setIncForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Days Lost</Label>
                <Input type="number" min="0" value={incForm.daysLost} onChange={(e) => setIncForm((f) => ({ ...f, daysLost: e.target.value }))} placeholder="0" />
              </div>
              <div className="space-y-1">
                <Label>Hours Worked (period)</Label>
                <Input type="number" value={incForm.hoursWorkedAtTime} onChange={(e) => setIncForm((f) => ({ ...f, hoursWorkedAtTime: e.target.value }))} placeholder="optional" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Reported By</Label>
              <Input value={incForm.reportedBy} onChange={(e) => setIncForm((f) => ({ ...f, reportedBy: e.target.value }))} placeholder="Name or role" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setIncDialog(false)}>Cancel</Button>
              <Button onClick={() => addIncident.mutate()} disabled={addIncident.isPending}>
                {addIncident.isPending && <Loader2 className="animate-spin w-4 h-4 mr-2" />}
                Record Incident
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Add Training Dialog ─────────────────────────────────────────────── */}
      <Dialog open={trDialog} onOpenChange={setTrDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Training Record</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Employee Name</Label>
              <Input value={trForm.employeeName} onChange={(e) => setTrForm((f) => ({ ...f, employeeName: e.target.value }))} placeholder="Full name" />
            </div>
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" value={trForm.trainingDate} onChange={(e) => setTrForm((f) => ({ ...f, trainingDate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Topic / Course Name</Label>
              <Input value={trForm.topic} onChange={(e) => setTrForm((f) => ({ ...f, topic: e.target.value }))} placeholder="e.g. Manual Handling" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Hours</Label>
                <Input type="number" step="0.5" min="0" value={trForm.hours} onChange={(e) => setTrForm((f) => ({ ...f, hours: e.target.value }))} placeholder="2" />
              </div>
              <div className="space-y-1">
                <Label>Category</Label>
                <Select value={trForm.category} onValueChange={(v) => setTrForm((f) => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TRAINING_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Provider (optional)</Label>
              <Input value={trForm.provider} onChange={(e) => setTrForm((f) => ({ ...f, provider: e.target.value }))} placeholder="e.g. Site Safe NZ" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setTrDialog(false)}>Cancel</Button>
              <Button onClick={() => addTraining.mutate()} disabled={addTraining.isPending || !trForm.employeeName || !trForm.topic || !trForm.hours}>
                {addTraining.isPending && <Loader2 className="animate-spin w-4 h-4 mr-2" />}
                Add Record
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
