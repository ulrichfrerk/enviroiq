import { useAuth } from "@/hooks/use-auth";
import {
  useGetAdminStats,
  useListOrganisations,
  useCreateOrganisation,
  useUpdateOrganisation,
  useDeleteOrganisation,
  type Organisation,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Building2, Users, Car, CloudRain, Plus, Loader2,
  CheckCircle, XCircle, Pencil, Trash2, Power, PowerOff,
  ExternalLink, RefreshCw, BrainCircuit, FileSignature, Download,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

const EMPTY_FORM = { name: "", industry: "", country: "NZ", adminEmail: "", adminName: "" };

export default function Admin() {
  const { session } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const [editOrg, setEditOrg] = useState<Organisation | null>(null);
  const [editForm, setEditForm] = useState({ name: "", industry: "", country: "" });

  const [deleteOrg, setDeleteOrg] = useState<Organisation | null>(null);
  const [recalcOrg, setRecalcOrg] = useState<Organisation | null>(null);
  const [recalcRunning, setRecalcRunning] = useState(false);
  const [recalcResult, setRecalcResult] = useState<{ updated: number; skipped: number; errors: number; totalEvents: number } | null>(null);

  // Contract / Order Form dialog state.
  const [contractOrg, setContractOrg] = useState<Organisation | null>(null);
  const [contractLoading, setContractLoading] = useState(false);
  const [contractSaving, setContractSaving] = useState(false);
  const [contractHasExisting, setContractHasExisting] = useState(false);
  const todayIso = new Date().toISOString().slice(0, 10);
  // datetime-local input value (YYYY-MM-DDTHH:mm) in the user's local timezone
  const nowLocalIso = (() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();
  const emptyContractForm = {
    planName: "Pro",
    monthlyPriceDollars: "" as string, // user enters dollars, we convert to cents on save
    currency: "NZD",
    billingCadence: "monthly" as "monthly" | "annual",
    termMonths: "12" as string,
    startDate: todayIso,
    customIntegration: false,
    notes: "",
    signerName: "",
    signerEmail: "",
    signerTitle: "",
    signedAt: nowLocalIso,
  };
  const [contractForm, setContractForm] = useState(emptyContractForm);

  const { data: stats, isLoading: loadingStats } = useGetAdminStats({
    query: { enabled: session?.role === "super_admin" },
  });
  const { data: orgs, isLoading: loadingOrgs, refetch } = useListOrganisations(undefined, {
    query: { enabled: session?.role === "super_admin" },
  });

  const createOrg = useCreateOrganisation();
  const updateOrg = useUpdateOrganisation();
  const deleteOrgMut = useDeleteOrganisation();

  if (session?.role !== "super_admin") {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center gap-4">
        <XCircle className="w-12 h-12 text-destructive" />
        <h2 className="text-xl font-semibold">Access Denied</h2>
        <p className="text-muted-foreground">Super Admin privileges required.</p>
        <Button onClick={() => setLocation("/dashboard")}>Return to Dashboard</Button>
      </div>
    );
  }

  const handleCreate = async () => {
    try {
      await createOrg.mutateAsync({ data: form });
      toast({ title: "Organisation created" });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      refetch();
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "Could not create organisation" });
    }
  };

  const handleEdit = async () => {
    if (!editOrg) return;
    try {
      await updateOrg.mutateAsync({ orgId: editOrg.id, data: editForm });
      toast({ title: "Organisation updated" });
      setEditOrg(null);
      refetch();
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "Could not update" });
    }
  };

  const handleToggleActive = async (org: Organisation) => {
    try {
      await updateOrg.mutateAsync({ orgId: org.id, data: { isActive: !org.isActive } });
      toast({ title: org.isActive ? "Organisation deactivated" : "Organisation activated" });
      refetch();
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "Could not update" });
    }
  };

  const handleDelete = async () => {
    if (!deleteOrg) return;
    try {
      await deleteOrgMut.mutateAsync({ orgId: deleteOrg.id });
      toast({ title: "Organisation deleted" });
      setDeleteOrg(null);
      refetch();
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "Could not delete" });
    }
  };

  const openContract = async (org: Organisation) => {
    setContractOrg(org);
    setContractForm(emptyContractForm);
    setContractHasExisting(false);
    setContractLoading(true);
    try {
      const res = await fetch(`/api/organisations/${org.id}/contract`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as {
          contract: null | {
            planName: string; monthlyPriceMinor: number; currency: string;
            billingCadence: "monthly" | "annual"; termMonths: number;
            startDate: string | null; customIntegration: boolean; notes: string | null;
            signerName: string; signerEmail: string; signerTitle: string | null;
            signedAt: string | null;
          };
        };
        if (data.contract) {
          setContractHasExisting(true);
          setContractForm({
            planName: data.contract.planName,
            monthlyPriceDollars: (data.contract.monthlyPriceMinor / 100).toFixed(2),
            currency: data.contract.currency,
            billingCadence: data.contract.billingCadence,
            termMonths: String(data.contract.termMonths),
            startDate: data.contract.startDate ? data.contract.startDate.slice(0, 10) : todayIso,
            customIntegration: data.contract.customIntegration,
            notes: data.contract.notes ?? "",
            signerName: data.contract.signerName,
            signerEmail: data.contract.signerEmail,
            signerTitle: data.contract.signerTitle ?? "",
            signedAt: data.contract.signedAt
              ? (() => {
                  const d = new Date(data.contract!.signedAt as string);
                  const pad = (n: number) => String(n).padStart(2, "0");
                  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                })()
              : nowLocalIso,
          });
        }
      }
    } catch (e) {
      toast({ variant: "destructive", title: "Could not load existing contract", description: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setContractLoading(false);
    }
  };

  const saveContract = async (): Promise<boolean> => {
    if (!contractOrg) return false;
    const priceDollars = parseFloat(contractForm.monthlyPriceDollars);
    if (!Number.isFinite(priceDollars) || priceDollars < 0) {
      toast({ variant: "destructive", title: "Invalid price", description: "Enter the monthly price in dollars (e.g. 499.00)." });
      return false;
    }
    const termMonths = parseInt(contractForm.termMonths, 10);
    if (!Number.isFinite(termMonths) || termMonths < 1 || termMonths > 120) {
      toast({ variant: "destructive", title: "Invalid term", description: "Term must be between 1 and 120 months." });
      return false;
    }
    if (!contractForm.signerName.trim() || !contractForm.signerEmail.trim()) {
      toast({ variant: "destructive", title: "Signer required", description: "Enter the name and email of the person accepting the contract." });
      return false;
    }
    setContractSaving(true);
    try {
      const res = await fetch(`/api/organisations/${contractOrg.id}/contract`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planName: contractForm.planName.trim(),
          monthlyPriceMinor: Math.round(priceDollars * 100),
          currency: contractForm.currency.trim().toUpperCase(),
          billingCadence: contractForm.billingCadence,
          termMonths,
          startDate: new Date(contractForm.startDate).toISOString(),
          customIntegration: contractForm.customIntegration,
          notes: contractForm.notes.trim() || null,
          signerName: contractForm.signerName.trim(),
          signerEmail: contractForm.signerEmail.trim(),
          signerTitle: contractForm.signerTitle.trim() || null,
          signedAt: new Date(contractForm.signedAt).toISOString(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string; problems?: string[] };
        throw new Error(err.problems?.join("; ") || err.message || `HTTP ${res.status}`);
      }
      toast({ title: "Contract recorded", description: "Subscription + acceptance saved." });
      setContractHasExisting(true);
      return true;
    } catch (e) {
      toast({ variant: "destructive", title: "Could not save contract", description: e instanceof Error ? e.message : "Unknown error" });
      return false;
    } finally {
      setContractSaving(false);
    }
  };

  const downloadContractPdf = async () => {
    if (!contractOrg) return;
    try {
      const res = await fetch(`/api/organisations/${contractOrg.id}/contract.pdf`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `enviroiq-contract-${contractOrg.slug}-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ variant: "destructive", title: "Could not download PDF", description: e instanceof Error ? e.message : "Unknown error" });
    }
  };

  const saveAndDownloadContract = async () => {
    const ok = await saveContract();
    if (ok) await downloadContractPdf();
  };

  const handleRecalculate = async () => {
    if (!recalcOrg) return;
    setRecalcRunning(true);
    setRecalcResult(null);
    try {
      const res = await fetch(`/api/admin/organisations/${recalcOrg.id}/recalculate-emissions`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      const result = await res.json() as { updated: number; skipped: number; errors: number; totalEvents: number };
      setRecalcResult(result);
      toast({
        title: "Recalculation complete",
        description: `${result.updated} records updated, ${result.skipped} unchanged, ${result.errors} errors.`,
      });
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "Recalculation failed", description: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setRecalcRunning(false);
    }
  };

  return (
    <div className="space-y-8 pb-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Super Admin Portal</h1>
          <p className="text-muted-foreground mt-1">Manage organisations and platform-wide settings.</p>
        </div>

        <div className="flex gap-2">
          {/* AI-guided setup wizard */}
          <Button variant="outline" onClick={() => setLocation("/onboard-org")} className="gap-2">
            <BrainCircuit className="w-4 h-4" /> AI-Guided Setup
          </Button>

        {/* Create org dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="shadow-lg shadow-primary/20">
              <Plus className="w-4 h-4 mr-2" /> New Organisation
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border sm:max-w-[520px]">
            <DialogHeader><DialogTitle>Create New Organisation</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Organisation Name *</label>
                  <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Acme Corp" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Country</label>
                  <Input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} placeholder="NZ" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Industry</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.industry}
                  onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}
                >
                  <option value="">Select Industry</option>
                  <option value="logistics">Logistics & Transport</option>
                  <option value="manufacturing">Manufacturing</option>
                  <option value="retail">Retail</option>
                  <option value="construction">Construction</option>
                  <option value="agriculture">Agriculture</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="border-t border-border pt-4">
                <p className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wide">Admin User (receives magic link)</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Admin Email *</label>
                    <Input value={form.adminEmail} onChange={e => setForm(f => ({ ...f, adminEmail: e.target.value }))} placeholder="admin@company.com" type="email" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Admin Name</label>
                    <Input value={form.adminName} onChange={e => setForm(f => ({ ...f, adminName: e.target.value }))} placeholder="Jane Doe" />
                  </div>
                </div>
              </div>
              <Button
                className="w-full mt-2"
                onClick={handleCreate}
                disabled={createOrg.isPending || !form.name || !form.adminEmail}
              >
                {createOrg.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Create Organisation
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Stats */}
      {loadingStats ? (
        <div className="flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Total Organisations", value: stats.totalOrganisations, icon: Building2 },
            { label: "Active Orgs", value: stats.activeOrganisations, icon: CheckCircle },
            { label: "Total Users", value: stats.totalUsers, icon: Users },
            { label: "Vehicles Tracked", value: stats.totalVehicles, icon: Car },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label} className="p-5 bg-card border-border/50">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-muted-foreground">{label}</p>
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <p className="text-3xl font-bold font-display text-foreground">{value}</p>
            </Card>
          ))}
        </div>
      )}

      {/* Platform CO2e */}
      {stats && (
        <Card className="p-6 bg-gradient-to-r from-primary/5 to-background border-primary/20">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-primary/10 rounded-2xl">
              <CloudRain className="w-8 h-8 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Platform CO₂e This Month</p>
              <p className="text-4xl font-bold font-display text-foreground mt-1">
                {(stats.totalCo2eKgThisMonth / 1000).toFixed(2)}{" "}
                <span className="text-xl font-normal text-muted-foreground">tonnes</span>
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Organisations Table */}
      <Card className="border-border/50 overflow-hidden">
        <div className="p-6 border-b border-border/50 bg-secondary/20 flex items-center justify-between">
          <h3 className="font-semibold text-lg">All Organisations</h3>
          <p className="text-sm text-muted-foreground">{orgs?.total ?? 0} total</p>
        </div>
        {loadingOrgs ? (
          <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-secondary/30 text-muted-foreground uppercase text-xs font-semibold">
                <tr>
                  <th className="px-6 py-4">Organisation</th>
                  <th className="px-6 py-4">Industry</th>
                  <th className="px-6 py-4">Users</th>
                  <th className="px-6 py-4">Vehicles</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {orgs?.items.map((org: Organisation) => (
                  <tr key={org.id} className="hover:bg-secondary/20 transition-colors">
                    <td className="px-6 py-4">
                      <div>
                        <div className="font-medium text-foreground">{org.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{org.slug}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 capitalize text-muted-foreground">{org.industry || "—"}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Users className="w-3.5 h-3.5" /> {(org as Organisation & { userCount?: number }).userCount || 0}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Car className="w-3.5 h-3.5" /> {(org as Organisation & { vehicleCount?: number }).vehicleCount || 0}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${org.isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-destructive/10 text-destructive"}`}>
                        {org.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-1">
                        {/* Open org dashboard */}
                        <Button
                          variant="ghost" size="icon"
                          title="Open org dashboard"
                          onClick={() => setLocation(`/${org.slug}`)}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Button>

                        {/* Recalculate emissions */}
                        <Button
                          variant="ghost" size="icon"
                          title="Recalculate emissions"
                          onClick={() => { setRecalcOrg(org); setRecalcResult(null); }}
                        >
                          <RefreshCw className="w-4 h-4 text-blue-400" />
                        </Button>

                        {/* Contract / Order Form */}
                        <Button
                          variant="ghost" size="icon"
                          title="Contract & pricing"
                          onClick={() => openContract(org)}
                        >
                          <FileSignature className="w-4 h-4 text-emerald-400" />
                        </Button>

                        {/* Edit */}
                        <Button
                          variant="ghost" size="icon"
                          title="Edit organisation"
                          onClick={() => {
                            setEditOrg(org);
                            setEditForm({ name: org.name, industry: org.industry || "", country: org.country || "NZ" });
                          }}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>

                        {/* Toggle active */}
                        <Button
                          variant="ghost" size="icon"
                          title={org.isActive ? "Deactivate" : "Activate"}
                          onClick={() => handleToggleActive(org)}
                          disabled={updateOrg.isPending}
                        >
                          {org.isActive
                            ? <PowerOff className="w-4 h-4 text-amber-500" />
                            : <Power className="w-4 h-4 text-emerald-500" />}
                        </Button>

                        {/* Delete */}
                        <Button
                          variant="ghost" size="icon"
                          title="Delete organisation"
                          onClick={() => setDeleteOrg(org)}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {(!orgs?.items || orgs.items.length === 0) && (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">
                      No organisations yet. Click <strong>New Organisation</strong> to add one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Edit dialog */}
      <Dialog open={!!editOrg} onOpenChange={(o) => !o && setEditOrg(null)}>
        <DialogContent className="bg-card border-border sm:max-w-[420px]">
          <DialogHeader><DialogTitle>Edit Organisation</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Name</label>
              <Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Industry</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={editForm.industry}
                onChange={e => setEditForm(f => ({ ...f, industry: e.target.value }))}
              >
                <option value="">Select Industry</option>
                <option value="logistics">Logistics & Transport</option>
                <option value="manufacturing">Manufacturing</option>
                <option value="retail">Retail</option>
                <option value="construction">Construction</option>
                <option value="agriculture">Agriculture</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Country</label>
              <Input value={editForm.country} onChange={e => setEditForm(f => ({ ...f, country: e.target.value }))} />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setEditOrg(null)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={updateOrg.isPending || !editForm.name}>
              {updateOrg.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteOrg} onOpenChange={(o) => !o && setDeleteOrg(null)}>
        <DialogContent className="bg-card border-border sm:max-w-[420px]">
          <DialogHeader><DialogTitle className="text-destructive">Delete Organisation</DialogTitle></DialogHeader>
          <p className="text-muted-foreground text-sm pt-2">
            Are you sure you want to permanently delete{" "}
            <strong className="text-foreground">{deleteOrg?.name}</strong>?
            This will remove all associated data and cannot be undone.
          </p>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDeleteOrg(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteOrgMut.isPending}>
              {deleteOrgMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recalculate emissions dialog */}
      <Dialog open={!!recalcOrg} onOpenChange={(o) => { if (!o && !recalcRunning) { setRecalcOrg(null); setRecalcResult(null); } }}>
        <DialogContent className="bg-card border-border sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-blue-400" />
              Recalculate Emissions — {recalcOrg?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2 text-sm text-muted-foreground">
            {!recalcResult ? (
              <>
                <p>
                  This will re-run the current emission factor logic against <strong className="text-foreground">all stored fleet events</strong> for this organisation.
                </p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Vehicle class factors (Hilux, Hiace, Isuzu NPR, Fuso Canter…)</li>
                  <li>Petrol/hybrid/PHEV auto-detection from model strings</li>
                  <li>Any custom per-vehicle emission factor overrides</li>
                  <li>Fuel litres (if available) take priority over distance estimates</li>
                </ul>
                <p className="text-xs">Records that haven't changed are skipped. This is safe to run multiple times.</p>
              </>
            ) : (
              <div className="rounded-lg border border-border p-4 space-y-3">
                <p className="font-semibold text-foreground">Recalculation complete</p>
                <div className="grid grid-cols-3 gap-3 text-center text-xs">
                  <div className="rounded-md bg-emerald-500/10 p-3">
                    <p className="text-2xl font-bold text-emerald-400">{recalcResult.updated}</p>
                    <p className="text-muted-foreground mt-1">Updated</p>
                  </div>
                  <div className="rounded-md bg-secondary/50 p-3">
                    <p className="text-2xl font-bold text-foreground">{recalcResult.skipped}</p>
                    <p className="text-muted-foreground mt-1">Unchanged</p>
                  </div>
                  <div className={`rounded-md p-3 ${recalcResult.errors > 0 ? "bg-destructive/10" : "bg-secondary/50"}`}>
                    <p className={`text-2xl font-bold ${recalcResult.errors > 0 ? "text-destructive" : "text-foreground"}`}>{recalcResult.errors}</p>
                    <p className="text-muted-foreground mt-1">Errors</p>
                  </div>
                </div>
                <p className="text-xs text-center text-muted-foreground">{recalcResult.totalEvents} total fleet events processed</p>
              </div>
            )}
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => { setRecalcOrg(null); setRecalcResult(null); }} disabled={recalcRunning}>
              {recalcResult ? "Close" : "Cancel"}
            </Button>
            {!recalcResult && (
              <Button onClick={handleRecalculate} disabled={recalcRunning} className="gap-2">
                {recalcRunning
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Recalculating…</>
                  : <><RefreshCw className="w-4 h-4" /> Run Recalculation</>
                }
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contract / Order Form dialog */}
      <Dialog open={!!contractOrg} onOpenChange={(o) => { if (!o && !contractSaving) setContractOrg(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSignature className="w-5 h-5 text-emerald-400" />
              Contract &amp; Pricing — {contractOrg?.name}
            </DialogTitle>
          </DialogHeader>

          {contractLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading existing contract…
            </div>
          ) : (
            <div className="space-y-4 py-2 text-sm">
              {contractHasExisting && (
                <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
                  A contract is already on file for this organisation. Saving will record a new version.
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Plan name</Label>
                  <Input value={contractForm.planName} onChange={(e) => setContractForm({ ...contractForm, planName: e.target.value })} placeholder="Pro" />
                </div>
                <div>
                  <Label>Monthly price ({contractForm.currency})</Label>
                  <Input type="number" step="0.01" min="0" value={contractForm.monthlyPriceDollars}
                    onChange={(e) => setContractForm({ ...contractForm, monthlyPriceDollars: e.target.value })}
                    placeholder="499.00" />
                </div>
                <div>
                  <Label>Currency</Label>
                  <Input value={contractForm.currency} maxLength={3}
                    onChange={(e) => setContractForm({ ...contractForm, currency: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <Label>Billing cadence</Label>
                  <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={contractForm.billingCadence}
                    onChange={(e) => setContractForm({ ...contractForm, billingCadence: e.target.value as "monthly" | "annual" })}>
                    <option value="monthly">Monthly in advance</option>
                    <option value="annual">Annual in advance</option>
                  </select>
                </div>
                <div>
                  <Label>Term (months)</Label>
                  <Input type="number" min="1" max="120" value={contractForm.termMonths}
                    onChange={(e) => setContractForm({ ...contractForm, termMonths: e.target.value })} />
                </div>
                <div>
                  <Label>Start date</Label>
                  <Input type="date" value={contractForm.startDate}
                    onChange={(e) => setContractForm({ ...contractForm, startDate: e.target.value })} />
                </div>
              </div>

              <div className="flex items-center justify-between rounded border border-input px-3 py-2">
                <div>
                  <div className="font-medium">Custom integration delivered</div>
                  <div className="text-xs text-muted-foreground">Triggers clause 6 (12-month notice or 80% early-termination charge).</div>
                </div>
                <Switch checked={contractForm.customIntegration}
                  onCheckedChange={(v) => setContractForm({ ...contractForm, customIntegration: Boolean(v) })} />
              </div>

              <div>
                <Label>Order notes (optional)</Label>
                <Textarea rows={2} value={contractForm.notes}
                  onChange={(e) => setContractForm({ ...contractForm, notes: e.target.value })}
                  placeholder="e.g. includes Acme Ltd FuelSaver connector and Microsoft SSO." />
              </div>

              <div className="border-t border-border pt-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Acceptance</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Signer name</Label>
                    <Input value={contractForm.signerName}
                      onChange={(e) => setContractForm({ ...contractForm, signerName: e.target.value })} />
                  </div>
                  <div>
                    <Label>Signer title</Label>
                    <Input value={contractForm.signerTitle}
                      onChange={(e) => setContractForm({ ...contractForm, signerTitle: e.target.value })}
                      placeholder="Managing Director" />
                  </div>
                  <div>
                    <Label>Signer email</Label>
                    <Input type="email" value={contractForm.signerEmail}
                      onChange={(e) => setContractForm({ ...contractForm, signerEmail: e.target.value })} />
                  </div>
                  <div>
                    <Label>Signed on (date &amp; time)</Label>
                    <Input type="datetime-local" value={contractForm.signedAt}
                      onChange={(e) => setContractForm({ ...contractForm, signedAt: e.target.value })} />
                  </div>
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  IP address and browser user agent will be captured automatically and printed on the PDF as part of the acceptance record.
                </div>
              </div>

              {(() => {
                const price = parseFloat(contractForm.monthlyPriceDollars);
                const months = parseInt(contractForm.termMonths, 10);
                if (!Number.isFinite(price) || !Number.isFinite(months) || price < 0 || months <= 0) return null;
                const ccy = contractForm.currency.trim().toUpperCase();
                const amount = price * months;
                // Intl.NumberFormat throws RangeError for invalid currency codes (e.g. partial typing).
                // Guard with the ISO format check, and fall back to a plain numeric string.
                let total: string;
                try {
                  total = /^[A-Z]{3}$/.test(ccy)
                    ? amount.toLocaleString(undefined, { style: "currency", currency: ccy })
                    : `${amount.toFixed(2)} ${ccy || "?"}`;
                } catch {
                  total = `${amount.toFixed(2)} ${ccy || "?"}`;
                }
                return (
                  <div className="rounded border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Total contract value:</span>{" "}
                    <span className="font-semibold text-emerald-300">{total}</span>
                    <span className="text-muted-foreground"> over {months} months (excl. GST)</span>
                  </div>
                );
              })()}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setContractOrg(null)} disabled={contractSaving}>Cancel</Button>
            {contractHasExisting && (
              <Button variant="outline" onClick={downloadContractPdf} disabled={contractSaving} className="gap-2">
                <Download className="w-4 h-4" /> Download current PDF
              </Button>
            )}
            <Button onClick={saveAndDownloadContract} disabled={contractSaving || contractLoading} className="gap-2">
              {contractSaving
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                : <><Download className="w-4 h-4" /> Save &amp; download PDF</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
