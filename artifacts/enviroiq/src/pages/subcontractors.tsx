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
import { Plus, ShieldCheck, ShieldX, Users2, Pencil, Trash2, FileCheck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

type Subcontractor = {
  id: string; companyName: string; contactName?: string; contactEmail?: string;
  tradeType?: string; hsPrequalified: boolean; hsExpiryDate?: string;
  supplierCodeSigned: boolean; supplierCodeSignedDate?: string; status: string; notes?: string;
};

const TRADE_TYPES = ["plumbing", "electrical", "hvac", "civil", "concrete", "roofing", "painting", "scaffolding", "demolition", "earthworks", "landscaping", "glazing", "joinery", "structural_steel", "other"];
const empty = { companyName: "", contactName: "", contactEmail: "", tradeType: "other", hsPrequalified: "false", hsExpiryDate: "", supplierCodeSigned: "false", supplierCodeSignedDate: "", status: "active", notes: "" };

function tradeLabel(s: string) { return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }

export default function SubcontractorsPage() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Subcontractor | null>(null);
  const [form, setForm] = useState<Record<string, string>>(empty);
  const [delId, setDelId] = useState<string | null>(null);

  const { data: subs = [], isLoading } = useQuery<Subcontractor[]>({
    queryKey: ["subcontractors", orgId],
    queryFn: () => apiClient(`/organisations/${orgId}/subcontractors`),
    enabled: !!orgId,
  });

  const save = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      editing
        ? apiClient(`/organisations/${orgId}/subcontractors/${editing.id}`, { method: "PATCH", body: d })
        : apiClient(`/organisations/${orgId}/subcontractors`, { method: "POST", body: d }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["subcontractors", orgId] }); setOpen(false); toast.success(editing ? "Updated" : "Subcontractor added"); },
    onError: () => toast.error("Failed to save"),
  });

  const del = useMutation({
    mutationFn: (id: string) => apiClient(`/organisations/${orgId}/subcontractors/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["subcontractors", orgId] }); setDelId(null); toast.success("Removed"); },
  });

  const openAdd = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (s: Subcontractor) => {
    setEditing(s);
    setForm({
      companyName: s.companyName, contactName: s.contactName ?? "", contactEmail: s.contactEmail ?? "",
      tradeType: s.tradeType ?? "other", hsPrequalified: s.hsPrequalified ? "true" : "false",
      hsExpiryDate: s.hsExpiryDate ? s.hsExpiryDate.substring(0, 10) : "",
      supplierCodeSigned: s.supplierCodeSigned ? "true" : "false",
      supplierCodeSignedDate: s.supplierCodeSignedDate ? s.supplierCodeSignedDate.substring(0, 10) : "",
      status: s.status, notes: s.notes ?? "",
    });
    setOpen(true);
  };

  const handleSubmit = () => {
    if (!form.companyName.trim()) { toast.error("Company name required"); return; }
    save.mutate({
      ...form,
      hsPrequalified: form.hsPrequalified === "true",
      supplierCodeSigned: form.supplierCodeSigned === "true",
      hsExpiryDate: form.hsExpiryDate ? new Date(form.hsExpiryDate).toISOString() : null,
      supplierCodeSignedDate: form.supplierCodeSignedDate ? new Date(form.supplierCodeSignedDate).toISOString() : null,
    });
  };

  const prequal = subs.filter(s => s.hsPrequalified).length;
  const codeSigned = subs.filter(s => s.supplierCodeSigned).length;
  const expiringSoon = subs.filter(s => {
    if (!s.hsExpiryDate) return false;
    const exp = new Date(s.hsExpiryDate);
    const in90 = new Date(); in90.setDate(in90.getDate() + 90);
    return exp <= in90 && exp >= new Date();
  }).length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Supply Chain Compliance</h1>
          <p className="text-muted-foreground text-sm mt-1">Track subcontractor H&S prequalification and Supplier Code of Conduct sign-off</p>
        </div>
        <Button onClick={openAdd} className="gap-2"><Plus className="w-4 h-4" />Add Subcontractor</Button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border rounded-xl p-4">
          <div className="text-2xl font-bold text-foreground">{subs.filter(s => s.status === "active").length}</div>
          <div className="text-sm text-muted-foreground mt-1">Active Subcontractors</div>
        </div>
        <div className="bg-card border rounded-xl p-4">
          <div className="text-2xl font-bold text-green-600">{subs.length > 0 ? Math.round((prequal / subs.length) * 100) : 0}%</div>
          <div className="text-sm text-muted-foreground mt-1">H&S Prequalified</div>
        </div>
        <div className="bg-card border rounded-xl p-4">
          <div className="text-2xl font-bold text-blue-600">{subs.length > 0 ? Math.round((codeSigned / subs.length) * 100) : 0}%</div>
          <div className="text-sm text-muted-foreground mt-1">Code Signed</div>
        </div>
        <div className={`border rounded-xl p-4 ${expiringSoon > 0 ? "bg-orange-50 border-orange-200" : "bg-card"}`}>
          <div className={`text-2xl font-bold ${expiringSoon > 0 ? "text-orange-600" : "text-foreground"}`}>{expiringSoon}</div>
          <div className="text-sm text-muted-foreground mt-1">H&S Expiring &lt; 90 days</div>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground">Loading…</div>
      ) : subs.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No subcontractors registered</p>
          <p className="text-sm mt-1">Add your supply chain to track H&S compliance and Supplier Code sign-off</p>
          <Button className="mt-4 gap-2" onClick={openAdd}><Plus className="w-4 h-4" />Add Subcontractor</Button>
        </div>
      ) : (
        <div className="border rounded-xl overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                {["Company", "Trade", "H&S Prequalified", "Expiry", "Supplier Code", "Status", ""].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {subs.map((s, i) => {
                const expired = s.hsExpiryDate && new Date(s.hsExpiryDate) < new Date();
                const expiring = !expired && expiringSoon > 0 && s.hsExpiryDate && new Date(s.hsExpiryDate) <= (() => { const d = new Date(); d.setDate(d.getDate() + 90); return d; })();
                return (
                  <tr key={s.id} className={i % 2 === 0 ? "bg-card" : "bg-muted/20"}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{s.companyName}</div>
                      {s.contactName && <div className="text-xs text-muted-foreground">{s.contactName}{s.contactEmail ? ` · ${s.contactEmail}` : ""}</div>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{s.tradeType ? tradeLabel(s.tradeType) : "—"}</td>
                    <td className="px-4 py-3">
                      {s.hsPrequalified
                        ? <div className="flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-green-600" /><span className="text-green-700 text-xs font-medium">Prequalified</span></div>
                        : <div className="flex items-center gap-1.5"><ShieldX className="w-4 h-4 text-muted-foreground" /><span className="text-muted-foreground text-xs">Not Prequalified</span></div>
                      }
                    </td>
                    <td className="px-4 py-3">
                      {s.hsExpiryDate ? (
                        <span className={`text-xs font-medium ${expired ? "text-red-600" : expiring ? "text-orange-600" : "text-muted-foreground"}`}>
                          {expired && <AlertTriangle className="w-3 h-3 inline mr-1" />}
                          {new Date(s.hsExpiryDate).toLocaleDateString("en-NZ")}
                        </span>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {s.supplierCodeSigned
                        ? <div className="flex items-center gap-1.5"><FileCheck className="w-4 h-4 text-blue-600" /><span className="text-blue-700 text-xs font-medium">Signed</span></div>
                        : <span className="text-muted-foreground text-xs">Not signed</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={`border-0 text-xs ${s.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"}`}>
                        {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => openEdit(s)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => setDelId(s.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Subcontractor" : "Add Subcontractor"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Company Name *</Label><Input value={form.companyName} onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))} placeholder="e.g. ABC Electrical Ltd" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Contact Name</Label><Input value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} /></div>
              <div><Label>Contact Email</Label><Input type="email" value={form.contactEmail} onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Trade Type</Label>
                <Select value={form.tradeType} onValueChange={v => setForm(f => ({ ...f, tradeType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TRADE_TYPES.map(t => <SelectItem key={t} value={t}>{tradeLabel(t)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">H&S Prequalification</p>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Prequalified?</Label>
                  <Select value={form.hsPrequalified} onValueChange={v => setForm(f => ({ ...f, hsPrequalified: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="false">No</SelectItem><SelectItem value="true">Yes</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label>Expiry Date</Label><Input type="date" value={form.hsExpiryDate} onChange={e => setForm(f => ({ ...f, hsExpiryDate: e.target.value }))} /></div>
              </div>
            </div>
            <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Supplier Code of Conduct</p>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Code Signed?</Label>
                  <Select value={form.supplierCodeSigned} onValueChange={v => setForm(f => ({ ...f, supplierCodeSigned: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="false">No</SelectItem><SelectItem value="true">Yes</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label>Date Signed</Label><Input type="date" value={form.supplierCodeSignedDate} onChange={e => setForm(f => ({ ...f, supplierCodeSignedDate: e.target.value }))} /></div>
              </div>
            </div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={save.isPending}>{save.isPending ? "Saving…" : editing ? "Save Changes" : "Add Subcontractor"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!delId} onOpenChange={() => setDelId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Remove Subcontractor?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This will permanently remove this subcontractor and all associated records.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => del.mutate(delId!)} disabled={del.isPending}>{del.isPending ? "Removing…" : "Remove"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
