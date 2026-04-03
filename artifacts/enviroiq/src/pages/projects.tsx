import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, FolderOpen, Pencil, Trash2, Building2, MapPin, CalendarDays, DollarSign } from "lucide-react";
import { toast } from "sonner";

type Project = {
  id: string; name: string; contractNumber?: string; clientName?: string;
  siteAddress?: string; contractValueNzd?: number; status: string;
  startDate?: string; endDate?: string; description?: string; notes?: string;
  createdAt: string;
};

const STATUS_OPTS = ["tendering", "active", "completed", "on_hold"] as const;
const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  tendering: { label: "Tendering", color: "bg-blue-100 text-blue-800" },
  active: { label: "Active", color: "bg-green-100 text-green-800" },
  completed: { label: "Completed", color: "bg-gray-100 text-gray-700" },
  on_hold: { label: "On Hold", color: "bg-yellow-100 text-yellow-800" },
};

const empty = { name: "", contractNumber: "", clientName: "", siteAddress: "", contractValueNzd: "", status: "active", startDate: "", endDate: "", description: "", notes: "" };

export default function ProjectsPage() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [form, setForm] = useState<Record<string, string>>(empty);
  const [delId, setDelId] = useState<string | null>(null);

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["projects", orgId],
    queryFn: () => apiClient(`/organisations/${orgId}/projects`),
    enabled: !!orgId,
  });

  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      editing
        ? apiClient(`/organisations/${orgId}/projects/${editing.id}`, { method: "PATCH", body: data })
        : apiClient(`/organisations/${orgId}/projects`, { method: "POST", body: data }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projects", orgId] }); setOpen(false); toast.success(editing ? "Project updated" : "Project added"); },
    onError: () => toast.error("Failed to save project"),
  });

  const del = useMutation({
    mutationFn: (id: string) => apiClient(`/organisations/${orgId}/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projects", orgId] }); setDelId(null); toast.success("Project deleted"); },
  });

  const openAdd = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (p: Project) => {
    setEditing(p);
    setForm({
      name: p.name, contractNumber: p.contractNumber ?? "", clientName: p.clientName ?? "",
      siteAddress: p.siteAddress ?? "", contractValueNzd: p.contractValueNzd?.toString() ?? "",
      status: p.status, startDate: p.startDate ? p.startDate.substring(0, 10) : "",
      endDate: p.endDate ? p.endDate.substring(0, 10) : "",
      description: p.description ?? "", notes: p.notes ?? "",
    });
    setOpen(true);
  };

  const handleSubmit = () => {
    if (!form.name.trim()) { toast.error("Project name is required"); return; }
    save.mutate({
      ...form,
      contractValueNzd: form.contractValueNzd ? Number(form.contractValueNzd) : null,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
    });
  };

  const counts = { tendering: 0, active: 0, completed: 0, on_hold: 0 };
  projects.forEach(p => { counts[p.status as keyof typeof counts] = (counts[p.status as keyof typeof counts] ?? 0) + 1; });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Projects & Contracts</h1>
          <p className="text-muted-foreground text-sm mt-1">Track contract-level ESG performance for tender reporting</p>
        </div>
        <Button onClick={openAdd} className="gap-2"><Plus className="w-4 h-4" /> Add Project</Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {STATUS_OPTS.map(s => {
          const info = STATUS_LABELS[s];
          return (
            <div key={s} className="bg-card border rounded-xl p-4">
              <div className="text-2xl font-bold text-foreground">{counts[s]}</div>
              <div className="text-sm text-muted-foreground mt-1">{info.label}</div>
            </div>
          );
        })}
      </div>

      {/* Project list */}
      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground">Loading…</div>
      ) : projects.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No projects yet</p>
          <p className="text-sm mt-1">Add your first project or contract to start tracking contract-level ESG data</p>
          <Button className="mt-4 gap-2" onClick={openAdd}><Plus className="w-4 h-4" /> Add Project</Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map(p => {
            const si = STATUS_LABELS[p.status] ?? { label: p.status, color: "bg-gray-100 text-gray-700" };
            return (
              <div key={p.id} className="bg-card border rounded-xl p-5 space-y-3 hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-foreground leading-tight">{p.name}</h3>
                  <Badge className={`${si.color} border-0 shrink-0 text-xs`}>{si.label}</Badge>
                </div>
                <div className="space-y-1.5 text-sm text-muted-foreground">
                  {p.contractNumber && <div className="flex items-center gap-2"><span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{p.contractNumber}</span></div>}
                  {p.clientName && <div className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5 shrink-0" />{p.clientName}</div>}
                  {p.siteAddress && <div className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 shrink-0" />{p.siteAddress}</div>}
                  {(p.startDate || p.endDate) && (
                    <div className="flex items-center gap-1.5">
                      <CalendarDays className="w-3.5 h-3.5 shrink-0" />
                      {p.startDate ? new Date(p.startDate).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                      {" → "}
                      {p.endDate ? new Date(p.endDate).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : "ongoing"}
                    </div>
                  )}
                  {p.contractValueNzd && (
                    <div className="flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5 shrink-0" />NZD {p.contractValueNzd.toLocaleString("en-NZ")}</div>
                  )}
                </div>
                {p.description && <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>}
                <div className="flex items-center gap-2 pt-1">
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => openEdit(p)}><Pencil className="w-3 h-3" />Edit</Button>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs text-destructive hover:text-destructive" onClick={() => setDelId(p.id)}><Trash2 className="w-3 h-3" />Delete</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Project" : "Add Project / Contract"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Project Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Mt Eden Prison Plumbing" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Contract Number</Label><Input value={form.contractNumber} onChange={e => setForm(f => ({ ...f, contractNumber: e.target.value }))} placeholder="e.g. MJ-2024-047" /></div>
              <div><Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUS_OPTS.map(s => <SelectItem key={s} value={s}>{STATUS_LABELS[s]?.label ?? s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Client / Principal</Label><Input value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} placeholder="e.g. Department of Corrections" /></div>
            <div><Label>Site Address</Label><Input value={form.siteAddress} onChange={e => setForm(f => ({ ...f, siteAddress: e.target.value }))} placeholder="e.g. 1 Prison Rd, Auckland" /></div>
            <div><Label>Contract Value (NZD)</Label><Input type="number" value={form.contractValueNzd} onChange={e => setForm(f => ({ ...f, contractValueNzd: e.target.value }))} placeholder="e.g. 850000" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start Date</Label><Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} /></div>
              <div><Label>End Date</Label><Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} /></div>
            </div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="Brief project description" /></div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Internal notes" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={save.isPending}>{save.isPending ? "Saving…" : editing ? "Save Changes" : "Add Project"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!delId} onOpenChange={() => setDelId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Project?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This will permanently remove the project record. This cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => del.mutate(delId!)} disabled={del.isPending}>{del.isPending ? "Deleting…" : "Delete"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
