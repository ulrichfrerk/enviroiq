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
import {
  Building2, Users, Car, CloudRain, Plus, Loader2,
  CheckCircle, XCircle, Pencil, Trash2, Power, PowerOff,
  ExternalLink, RefreshCw, BrainCircuit,
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
    </div>
  );
}
