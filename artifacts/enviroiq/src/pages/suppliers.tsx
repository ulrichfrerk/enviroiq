import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, Send, RefreshCw, FileText, ShieldCheck, AlertTriangle, Building2, Mail, Eye, Loader2, Sliders, History } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Link } from "wouter";

type Supplier = {
  id: string; legalName: string; tradingName?: string; companyNumber?: string;
  country?: string; industry?: string; description?: string;
  primaryContactName?: string; primaryContactEmail?: string; primaryContactPhone?: string;
  secondaryContactName?: string; secondaryContactEmail?: string; seniorResponsibleOfficer?: string;
  shippingMethod?: string; shippingCompanies?: string; regionsSupplied?: string;
  materialType?: string; riskTag: string; isCritical: boolean;
  auditFrequencyMonths: number;
  lastAuditAt?: string; nextAuditDueAt?: string;
  latestEsgScore?: number; latestRiskLevel?: string;
  status: string; notes?: string;
};

type Audit = {
  id: string; supplierId: string; recipientEmail: string; recipientName?: string;
  status: string; dueAt: string; sentAt?: string; submittedAt?: string;
  esgScore?: number; riskLevel?: string;
};

const empty: Record<string, string> = {
  legalName: "", tradingName: "", companyNumber: "", country: "New Zealand",
  industry: "", description: "",
  primaryContactName: "", primaryContactEmail: "", primaryContactPhone: "",
  secondaryContactName: "", secondaryContactEmail: "", seniorResponsibleOfficer: "",
  shippingMethod: "road", shippingCompanies: "", regionsSupplied: "",
  materialType: "", riskTag: "medium", isCritical: "false",
  auditFrequencyMonths: "12", status: "active", notes: "",
};

function riskColor(r?: string) {
  if (r === "low") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40";
  if (r === "medium") return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40";
  if (r === "high") return "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40";
  return "bg-muted text-muted-foreground border-border";
}

function statusColor(s: string) {
  if (s === "submitted" || s === "approved") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (s === "in_progress") return "bg-blue-500/15 text-blue-700 dark:text-blue-300";
  if (s === "sent") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  if (s === "expired") return "bg-rose-500/15 text-rose-700 dark:text-rose-300";
  return "bg-muted text-muted-foreground";
}

export default function SuppliersPage() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<Record<string, string>>(empty);

  const [sendOpen, setSendOpen] = useState(false);
  const [sendFor, setSendFor] = useState<Supplier | null>(null);
  const [sendForm, setSendForm] = useState<{ recipientEmail: string; recipientName: string; dueInDays: string }>({
    recipientEmail: "", recipientName: "", dueInDays: "30",
  });

  const [detailFor, setDetailFor] = useState<Supplier | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);

  const { data: suppliers = [], isLoading } = useQuery<Supplier[]>({
    queryKey: ["suppliers", orgId],
    queryFn: () => apiClient(`/organisations/${orgId}/suppliers`),
    enabled: !!orgId,
  });

  const { data: audits = [] } = useQuery<Audit[]>({
    queryKey: ["supplier-audits", orgId],
    queryFn: () => apiClient(`/organisations/${orgId}/supplier-audits`),
    enabled: !!orgId,
  });

  const { data: templates = [] } = useQuery<Array<{ id: string; name: string; isDefault: boolean; weightEnvironmental: number; weightSocial: number; weightGovernance: number; weightSupplyChain: number; }>>({
    queryKey: ["supplier-audit-templates", orgId],
    queryFn: () => apiClient(`/organisations/${orgId}/supplier-audit-templates`),
    enabled: !!orgId,
  });

  const defaultTemplateId = templates.find((t) => t.isDefault)?.id;

  const { data: defaultTemplate } = useQuery<{
    id: string; name: string; description: string;
    weightEnvironmental: number; weightSocial: number; weightGovernance: number; weightSupplyChain: number;
    schema: { intro: string; sections: Array<{ id: string; title: string; description: string; weight: number; questions: Array<{ id: string; text: string; type: string; weight: number }> }> };
  }>({
    queryKey: ["supplier-audit-template", orgId, defaultTemplateId],
    queryFn: () => apiClient(`/organisations/${orgId}/supplier-audit-templates/${defaultTemplateId}`),
    enabled: !!orgId && !!defaultTemplateId && templateOpen,
  });

  const save = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      editing
        ? apiClient(`/organisations/${orgId}/suppliers/${editing.id}`, { method: "PATCH", body: d })
        : apiClient(`/organisations/${orgId}/suppliers`, { method: "POST", body: d }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["suppliers", orgId] }); setOpen(false); toast.success(editing ? "Supplier updated" : "Supplier added"); },
    onError: () => toast.error("Failed to save supplier"),
  });

  const del = useMutation({
    mutationFn: (id: string) => apiClient(`/organisations/${orgId}/suppliers/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["suppliers", orgId] }); toast.success("Supplier removed"); },
    onError: () => toast.error("Delete failed"),
  });

  const sendAudit = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiClient(`/organisations/${orgId}/supplier-audits`, { method: "POST", body }),
    onSuccess: (data: { auditUrl?: string; emailSent: boolean }) => {
      qc.invalidateQueries({ queryKey: ["supplier-audits", orgId] });
      setSendOpen(false);
      if (data.auditUrl) {
        toast.success("Audit created. Dev mode link copied to clipboard.");
        navigator.clipboard?.writeText(data.auditUrl).catch(() => {});
      } else if (data.emailSent) {
        toast.success("Audit sent to supplier");
      } else {
        toast.success("Audit created (email could not be sent)");
      }
    },
    onError: (err: Error) => toast.error(err.message || "Failed to send audit"),
  });

  const openAdd = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({
      legalName: s.legalName, tradingName: s.tradingName ?? "", companyNumber: s.companyNumber ?? "",
      country: s.country ?? "", industry: s.industry ?? "", description: s.description ?? "",
      primaryContactName: s.primaryContactName ?? "", primaryContactEmail: s.primaryContactEmail ?? "",
      primaryContactPhone: s.primaryContactPhone ?? "",
      secondaryContactName: s.secondaryContactName ?? "", secondaryContactEmail: s.secondaryContactEmail ?? "",
      seniorResponsibleOfficer: s.seniorResponsibleOfficer ?? "",
      shippingMethod: s.shippingMethod ?? "road", shippingCompanies: s.shippingCompanies ?? "",
      regionsSupplied: s.regionsSupplied ?? "", materialType: s.materialType ?? "",
      riskTag: s.riskTag, isCritical: s.isCritical ? "true" : "false",
      auditFrequencyMonths: String(s.auditFrequencyMonths || 12),
      status: s.status, notes: s.notes ?? "",
    });
    setOpen(true);
  };
  const openSend = (s: Supplier) => {
    setSendFor(s);
    setSendForm({
      recipientEmail: s.primaryContactEmail ?? "",
      recipientName: s.primaryContactName ?? s.legalName,
      dueInDays: "30",
    });
    setSendOpen(true);
  };

  const handleSubmit = () => {
    if (!form.legalName.trim()) { toast.error("Legal name required"); return; }
    save.mutate({
      ...form,
      isCritical: form.isCritical === "true",
      auditFrequencyMonths: Number(form.auditFrequencyMonths) || 12,
    });
  };

  const handleSend = () => {
    if (!sendFor) return;
    if (!sendForm.recipientEmail.includes("@")) { toast.error("Valid email required"); return; }
    sendAudit.mutate({
      supplierId: sendFor.id,
      recipientEmail: sendForm.recipientEmail,
      recipientName: sendForm.recipientName,
      dueInDays: Number(sendForm.dueInDays) || 30,
    });
  };

  // KPIs
  const total = suppliers.length;
  const critical = suppliers.filter((s) => s.isCritical).length;
  const scored = suppliers.filter((s) => typeof s.latestEsgScore === "number");
  const avgScore = scored.length ? Math.round(scored.reduce((sum, s) => sum + (s.latestEsgScore ?? 0), 0) / scored.length) : 0;
  const compliantPct = total ? Math.round((scored.filter((s) => (s.latestEsgScore ?? 0) >= 80).length / total) * 100) : 0;
  const openAuditCount = audits.filter((a) => ["sent", "in_progress"].includes(a.status)).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Suppliers</h1>
          <p className="text-muted-foreground mt-1">Register, audit and assure your supply chain ESG performance.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setTemplateOpen(true)} data-testid="button-view-template">
            <FileText className="h-4 w-4 mr-2" /> Audit template
          </Button>
          <Button onClick={openAdd} data-testid="button-add-supplier">
            <Plus className="h-4 w-4 mr-2" /> Add supplier
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi icon={<Building2 className="h-5 w-5 text-primary" />} label="Suppliers" value={total} />
        <Kpi icon={<AlertTriangle className="h-5 w-5 text-rose-500" />} label="Critical" value={critical} />
        <Kpi icon={<ShieldCheck className="h-5 w-5 text-emerald-500" />} label="Avg ESG" value={scored.length ? `${avgScore}` : "—"} />
        <Kpi icon={<ShieldCheck className="h-5 w-5 text-emerald-500" />} label="≥ 80 score" value={`${compliantPct}%`} />
        <Kpi icon={<Send className="h-5 w-5 text-amber-500" />} label="Audits open" value={openAuditCount} />
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="text-left px-4 py-3">Supplier</th>
                <th className="text-left px-4 py-3">Industry</th>
                <th className="text-left px-4 py-3">Risk</th>
                <th className="text-left px-4 py-3">ESG score</th>
                <th className="text-left px-4 py-3">Last audit</th>
                <th className="text-left px-4 py-3">Next due</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && suppliers.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  No suppliers yet. <button onClick={openAdd} className="text-primary underline">Add one</button>.
                </td></tr>
              )}
              {suppliers.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`row-supplier-${s.id}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{s.legalName}</div>
                    {s.tradingName && <div className="text-xs text-muted-foreground">{s.tradingName}</div>}
                    {s.isCritical && <Badge className="mt-1 bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40">Critical</Badge>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{s.industry || "—"}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={`capitalize ${riskColor(s.riskTag)}`}>{s.riskTag}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {typeof s.latestEsgScore === "number" ? (
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{s.latestEsgScore}</span>
                        <Badge variant="outline" className={`capitalize text-xs ${riskColor(s.latestRiskLevel)}`}>{s.latestRiskLevel}</Badge>
                      </div>
                    ) : <span className="text-muted-foreground text-xs">No data</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {s.lastAuditAt ? new Date(s.lastAuditAt).toLocaleDateString("en-NZ") : "Never"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {s.nextAuditDueAt ? new Date(s.nextAuditDueAt).toLocaleDateString("en-NZ") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setDetailFor(s)} title="View" data-testid={`button-view-${s.id}`}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => openSend(s)} title="Send audit" data-testid={`button-send-${s.id}`}>
                        <Send className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => openEdit(s)} title="Edit" data-testid={`button-edit-${s.id}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Remove ${s.legalName}?`)) del.mutate(s.id); }} title="Delete" data-testid={`button-delete-${s.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Need supply-chain insights, risk heatmaps and a board-ready PDF? Open the{" "}
        <Link href="/supplier-reports" className="text-primary underline">Supplier ESG Report</Link>.
      </p>

      {/* ─── Add / Edit dialog ─── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit supplier" : "Add supplier"}</DialogTitle>
            <DialogDescription>Capture every field needed to audit and report on this relationship.</DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="company">
            <TabsList className="grid grid-cols-4">
              <TabsTrigger value="company">Company</TabsTrigger>
              <TabsTrigger value="contacts">Contacts</TabsTrigger>
              <TabsTrigger value="logistics">Logistics</TabsTrigger>
              <TabsTrigger value="risk">Risk &amp; cycle</TabsTrigger>
            </TabsList>

            <TabsContent value="company" className="space-y-4 pt-4">
              <Field label="Legal company name *">
                <Input value={form.legalName} onChange={(e) => setForm((f) => ({ ...f, legalName: e.target.value }))} data-testid="input-legalName" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Trading name"><Input value={form.tradingName} onChange={(e) => setForm((f) => ({ ...f, tradingName: e.target.value }))} /></Field>
                <Field label="Company number"><Input value={form.companyNumber} onChange={(e) => setForm((f) => ({ ...f, companyNumber: e.target.value }))} /></Field>
                <Field label="Country"><Input value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} /></Field>
                <Field label="Industry"><Input value={form.industry} onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))} /></Field>
              </div>
              <Field label="Goods or services supplied">
                <Textarea rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </Field>
            </TabsContent>

            <TabsContent value="contacts" className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Primary ESG contact"><Input value={form.primaryContactName} onChange={(e) => setForm((f) => ({ ...f, primaryContactName: e.target.value }))} /></Field>
                <Field label="Primary email"><Input type="email" value={form.primaryContactEmail} onChange={(e) => setForm((f) => ({ ...f, primaryContactEmail: e.target.value }))} data-testid="input-primaryContactEmail" /></Field>
                <Field label="Primary phone"><Input value={form.primaryContactPhone} onChange={(e) => setForm((f) => ({ ...f, primaryContactPhone: e.target.value }))} /></Field>
                <Field label="Senior responsible officer"><Input value={form.seniorResponsibleOfficer} onChange={(e) => setForm((f) => ({ ...f, seniorResponsibleOfficer: e.target.value }))} /></Field>
                <Field label="Secondary contact"><Input value={form.secondaryContactName} onChange={(e) => setForm((f) => ({ ...f, secondaryContactName: e.target.value }))} /></Field>
                <Field label="Secondary email"><Input type="email" value={form.secondaryContactEmail} onChange={(e) => setForm((f) => ({ ...f, secondaryContactEmail: e.target.value }))} /></Field>
              </div>
            </TabsContent>

            <TabsContent value="logistics" className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Primary shipping method">
                  <Select value={form.shippingMethod} onValueChange={(v) => setForm((f) => ({ ...f, shippingMethod: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="road">Road</SelectItem>
                      <SelectItem value="sea">Sea</SelectItem>
                      <SelectItem value="air">Air</SelectItem>
                      <SelectItem value="mixed">Mixed</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Material type"><Input value={form.materialType} onChange={(e) => setForm((f) => ({ ...f, materialType: e.target.value }))} /></Field>
                <Field label="Shipping companies"><Input value={form.shippingCompanies} onChange={(e) => setForm((f) => ({ ...f, shippingCompanies: e.target.value }))} /></Field>
                <Field label="Regions supplied"><Input value={form.regionsSupplied} onChange={(e) => setForm((f) => ({ ...f, regionsSupplied: e.target.value }))} /></Field>
              </div>
            </TabsContent>

            <TabsContent value="risk" className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Risk tag">
                  <Select value={form.riskTag} onValueChange={(v) => setForm((f) => ({ ...f, riskTag: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Critical to operations?">
                  <Select value={form.isCritical} onValueChange={(v) => setForm((f) => ({ ...f, isCritical: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="false">No</SelectItem>
                      <SelectItem value="true">Yes</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Audit cycle (months)"><Input type="number" min="1" max="60" value={form.auditFrequencyMonths} onChange={(e) => setForm((f) => ({ ...f, auditFrequencyMonths: e.target.value }))} /></Field>
                <Field label="Status">
                  <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="offboarded">Offboarded</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label="Notes"><Textarea rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></Field>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={save.isPending} data-testid="button-save-supplier">
              {save.isPending ? "Saving…" : editing ? "Save changes" : "Add supplier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Send audit dialog ─── */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send ESG audit</DialogTitle>
            <DialogDescription>{sendFor?.legalName} will receive a secure questionnaire link.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Recipient email *"><Input type="email" value={sendForm.recipientEmail} onChange={(e) => setSendForm((f) => ({ ...f, recipientEmail: e.target.value }))} data-testid="input-send-email" /></Field>
            <Field label="Recipient name"><Input value={sendForm.recipientName} onChange={(e) => setSendForm((f) => ({ ...f, recipientName: e.target.value }))} /></Field>
            <Field label="Due in (days)"><Input type="number" min="1" max="365" value={sendForm.dueInDays} onChange={(e) => setSendForm((f) => ({ ...f, dueInDays: e.target.value }))} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendOpen(false)}>Cancel</Button>
            <Button onClick={handleSend} disabled={sendAudit.isPending} data-testid="button-send-audit">
              <Send className="h-4 w-4 mr-2" />
              {sendAudit.isPending ? "Sending…" : "Send audit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Detail (audits for supplier) ─── */}
      <Dialog open={!!detailFor} onOpenChange={(o) => { if (!o) setDetailFor(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detailFor?.legalName}</DialogTitle>
            <DialogDescription>{detailFor?.industry || "—"} · risk tag {detailFor?.riskTag}</DialogDescription>
          </DialogHeader>
          {detailFor && <SupplierDetail supplier={detailFor} audits={audits.filter((a) => a.supplierId === detailFor.id)} orgId={orgId!} onSend={() => openSend(detailFor)} />}
        </DialogContent>
      </Dialog>

      {/* ─── Template viewer ─── */}
      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{defaultTemplate?.name || "EnviroIQ Supplier ESG Audit"}</DialogTitle>
            <DialogDescription>{defaultTemplate?.description || "Loading…"}</DialogDescription>
          </DialogHeader>
          {defaultTemplate ? (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-2 text-xs">
                {[
                  ["Environmental", defaultTemplate.weightEnvironmental],
                  ["Social", defaultTemplate.weightSocial],
                  ["Governance", defaultTemplate.weightGovernance],
                  ["Supply chain", defaultTemplate.weightSupplyChain],
                ].map(([l, v]) => (
                  <div key={String(l)} className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{l}</div>
                    <div className="text-xl font-bold">{v}%</div>
                  </div>
                ))}
              </div>
              {defaultTemplate.schema?.sections?.map((sec) => (
                <div key={sec.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-semibold text-foreground">{sec.title}</h3>
                    <Badge variant="outline" className="text-xs">{sec.weight === 0 ? "Insight (not scored)" : `weight ${sec.weight}`}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">{sec.description}</p>
                  <ol className="space-y-1.5 text-sm list-decimal list-inside text-foreground/90">
                    {sec.questions.map((q) => (
                      <li key={q.id}><span className="text-muted-foreground text-xs ml-1">[{q.type}]</span> {q.text}</li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">Loading template…</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">{label}</Label>
      {children}
    </div>
  );
}

function SupplierDetail({ supplier, audits, orgId, onSend }: { supplier: Supplier; audits: Audit[]; orgId: string; onSend: () => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Info label="Primary contact" value={`${supplier.primaryContactName ?? "—"}${supplier.primaryContactEmail ? ` · ${supplier.primaryContactEmail}` : ""}`} />
        <Info label="Senior responsible officer" value={supplier.seniorResponsibleOfficer ?? "—"} />
        <Info label="Material" value={supplier.materialType ?? "—"} />
        <Info label="Shipping" value={`${supplier.shippingMethod ?? "—"}${supplier.regionsSupplied ? ` · ${supplier.regionsSupplied}` : ""}`} />
        <Info label="Audit cycle" value={`${supplier.auditFrequencyMonths} months`} />
        <Info label="Next audit due" value={supplier.nextAuditDueAt ? new Date(supplier.nextAuditDueAt).toLocaleDateString("en-NZ") : "—"} />
      </div>
      <SupplierOverridesPanel supplier={supplier} orgId={orgId} />
      <div className="rounded-lg border border-border">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
          <h4 className="font-semibold text-sm">Audit history</h4>
          <Button size="sm" onClick={onSend}><Send className="h-3.5 w-3.5 mr-1.5" /> Send new audit</Button>
        </div>
        {audits.length === 0 ? (
          <div className="px-4 py-6 text-sm text-center text-muted-foreground">No audits yet for this supplier.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr><th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Sent</th><th className="text-left px-3 py-2">Due</th><th className="text-left px-3 py-2">Submitted</th><th className="text-left px-3 py-2">Score</th></tr>
            </thead>
            <tbody>
              {audits.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-3 py-2"><Badge variant="outline" className={`capitalize ${statusColor(a.status)}`}>{a.status.replace("_", " ")}</Badge></td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{a.sentAt ? new Date(a.sentAt).toLocaleDateString("en-NZ") : "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(a.dueAt).toLocaleDateString("en-NZ")}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{a.submittedAt ? new Date(a.submittedAt).toLocaleDateString("en-NZ") : "—"}</td>
                  <td className="px-3 py-2">{typeof a.esgScore === "number" ? <span className="font-semibold">{a.esgScore}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div className="text-sm text-foreground">{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-supplier audit question overrides. Shown inside the supplier detail
// dialog. Mirrors org-level customisation but scoped to one supplier — and
// per-supplier decisions win over org-level ones.
// ─────────────────────────────────────────────────────────────────────────────

interface OverrideRow {
  id: string; questionId: string; supplierId: string | null;
  enabled: boolean; reason: string; rationaleSnapshot: string;
  createdByEmail: string | null; updatedAt: string;
}
interface TplQ { id: string; text: string; type: string; rationale: string; weight: number }
interface TplSection { id: string; title: string; weight: number; questions: TplQ[] }

function SupplierOverridesPanel({ supplier, orgId }: { supplier: Supplier; orgId: string }) {
  const { session } = useAuth();
  const isAdmin = session?.role === "org_admin" || session?.role === "super_admin";
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: tplListData } = useQuery({
    queryKey: ["supplier-audit-templates", orgId],
    queryFn: () => apiClient<Array<{ id: string; isDefault: boolean }>>(
      `/organisations/${orgId}/supplier-audit-templates`,
    ),
  });
  const tplId = tplListData?.find((t) => t.isDefault)?.id;
  const { data: tpl } = useQuery({
    queryKey: ["supplier-audit-template", orgId, tplId],
    queryFn: () => apiClient<{ schema: { sections: TplSection[] } }>(`/organisations/${orgId}/supplier-audit-templates/${tplId}`),
    enabled: !!tplId,
  });
  const { data: ovData, isLoading: ovLoading } = useQuery({
    queryKey: ["audit-overrides", orgId, tplId, supplier.id],
    queryFn: () => apiClient<{ overrides: OverrideRow[] }>(
      `/organisations/${orgId}/audit-overrides?templateId=${tplId}&supplierId=${supplier.id}`,
    ),
    enabled: !!tplId,
  });

  const orgOverrides = new Map<string, OverrideRow>();
  const supplierOverrides = new Map<string, OverrideRow>();
  for (const o of ovData?.overrides ?? []) {
    if (o.supplierId === null) orgOverrides.set(o.questionId, o);
    else if (o.supplierId === supplier.id) supplierOverrides.set(o.questionId, o);
  }

  const upsert = useMutation({
    mutationFn: async (vars: { questionId: string; enabled: boolean; reason: string }) => {
      return apiClient(`/organisations/${orgId}/audit-overrides`, {
        method: "PUT",
        body: { templateId: tplId, questionId: vars.questionId, supplierId: supplier.id, enabled: vars.enabled, reason: vars.reason },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audit-overrides", orgId, tplId, supplier.id] });
      toast.success("Override saved", { description: "Recorded in the audit log." });
    },
    onError: (e: unknown) => toast.error("Could not save", { description: e instanceof Error ? e.message : "Try again" }),
  });
  const remove = useMutation({
    mutationFn: async (questionId: string) =>
      apiClient(`/organisations/${orgId}/audit-overrides/${encodeURIComponent(questionId)}?templateId=${tplId}&supplierId=${supplier.id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audit-overrides", orgId, tplId, supplier.id] });
      toast.success("Override removed", { description: "This question now follows the org-wide setting." });
    },
  });

  const [confirmFor, setConfirmFor] = useState<{ q: TplQ; intendEnable: boolean } | null>(null);
  const [reason, setReason] = useState("");

  // Compute counts for the summary line
  const counts = (() => {
    let disabledForThisSupplier = 0;
    let exceptionsHere = 0;
    if (!tpl) return { disabledForThisSupplier, exceptionsHere };
    for (const s of tpl.schema.sections) for (const q of s.questions) {
      const sup = supplierOverrides.get(q.id);
      const org = orgOverrides.get(q.id);
      const enabled = sup ? sup.enabled : org ? org.enabled : true;
      if (!enabled) disabledForThisSupplier += 1;
      if (sup) exceptionsHere += 1;
    }
    return { disabledForThisSupplier, exceptionsHere };
  })();

  const onToggle = (q: TplQ, currentEnabled: boolean, hasSupplierOverride: boolean) => {
    if (!isAdmin) return;
    if (hasSupplierOverride) {
      // Tapping the toggle on an existing per-supplier override → remove it (revert to inherit)
      remove.mutate(q.id);
      return;
    }
    // No per-supplier override yet — open the modal to capture a reason for the new exception.
    setConfirmFor({ q, intendEnable: !currentEnabled });
    setReason("");
  };

  const submitException = () => {
    if (!confirmFor) return;
    if (reason.trim().length < 10) {
      toast.error("Reason required", { description: "Min 10 characters — gets recorded in the audit log." });
      return;
    }
    upsert.mutate(
      { questionId: confirmFor.q.id, enabled: confirmFor.intendEnable, reason: reason.trim() },
      { onSuccess: () => setConfirmFor(null) },
    );
  };

  return (
    <div className="rounded-lg border border-border">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30 hover:bg-muted/50 transition"
        data-testid={`overrides-toggle-${supplier.id}`}
      >
        <div className="flex items-center gap-2">
          <Sliders className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-semibold text-sm">Per-supplier audit overrides</span>
          {counts.exceptionsHere > 0 && <Badge variant="outline" className="text-[10px]">{counts.exceptionsHere} exception{counts.exceptionsHere === 1 ? "" : "s"}</Badge>}
          {counts.disabledForThisSupplier > 0 && <Badge variant="outline" className="text-[10px]">{counts.disabledForThisSupplier} off</Badge>}
        </div>
        <span className="text-xs text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="p-3 space-y-3 max-h-[60vh] overflow-y-auto">
          {ovLoading || !tpl ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-muted-foreground flex-1">
                  Per-supplier exceptions win over the org-wide setting. Only changes to <em>this</em> supplier get a per-supplier exception; everything else follows org-wide.
                </p>
                <Link href="/audit?action=supplier_audit_question_override">
                  <Button variant="ghost" size="sm" className="text-xs h-7 shrink-0">
                    <History className="h-3 w-3 mr-1" /> Change history
                  </Button>
                </Link>
              </div>
              {tpl.schema.sections.map((sec) => (
                <div key={sec.id} className="rounded-md border border-border/50">
                  <div className="px-3 py-2 bg-secondary/30 text-xs font-semibold text-foreground/90 flex items-center justify-between">
                    <span>{sec.title}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{sec.weight === 0 ? "Insight" : `weight ${sec.weight}`}</span>
                  </div>
                  <div className="divide-y divide-border/40">
                    {sec.questions.map((q) => {
                      const sup = supplierOverrides.get(q.id);
                      const org = orgOverrides.get(q.id);
                      const enabled = sup ? sup.enabled : org ? org.enabled : true;
                      const inheritedFromOrg = !sup && org && !org.enabled;
                      return (
                        <div key={q.id} className="px-3 py-2 flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-foreground">{q.text}</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">{q.rationale}</div>
                            {sup && (
                              <div className="text-[10px] mt-1">
                                <span className={sup.enabled ? "text-emerald-400" : "text-amber-400"}>
                                  {sup.enabled ? "Forced ON for this supplier" : "OFF for this supplier"} ·
                                </span>{" "}
                                <span className="text-muted-foreground">{sup.reason}</span>
                              </div>
                            )}
                            {inheritedFromOrg && !sup && (
                              <div className="text-[10px] text-muted-foreground mt-1">Inherits org-wide OFF — toggle to force ON for this supplier.</div>
                            )}
                          </div>
                          <Switch
                            checked={enabled}
                            disabled={!isAdmin || upsert.isPending || remove.isPending}
                            onCheckedChange={() => onToggle(q, enabled, !!sup)}
                            data-testid={`supplier-q-toggle-${q.id}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      <Dialog open={!!confirmFor} onOpenChange={(o) => { if (!o) setConfirmFor(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmFor?.intendEnable ? "Force this question ON" : "Disable this question"} for {supplier.legalName}?</DialogTitle>
            <DialogDescription>{confirmFor?.q.text}</DialogDescription>
          </DialogHeader>
          {confirmFor && (
            <div className="space-y-3">
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
                <div className="font-medium text-foreground mb-1">Why we ask this</div>
                <p className="text-muted-foreground leading-relaxed">{confirmFor.q.rationale}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Reason (audit-logged)</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why is this exception justified for this supplier?" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmFor(null)}>Cancel</Button>
            <Button onClick={submitException} disabled={upsert.isPending}>
              {upsert.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save exception
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
