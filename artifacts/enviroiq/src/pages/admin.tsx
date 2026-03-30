import { useAuth } from "@/hooks/use-auth";
import { useGetAdminStats, useListOrganisations, useCreateOrganisation } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2, Users, Car, CloudRain, Plus, Loader2, CheckCircle, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

export default function Admin() {
  const { session } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);

  const { data: stats, isLoading: loadingStats } = useGetAdminStats({ query: { enabled: session?.role === "super_admin" } });
  const { data: orgs, isLoading: loadingOrgs, refetch } = useListOrganisations(undefined, { query: { enabled: session?.role === "super_admin" } });
  const createOrg = useCreateOrganisation();

  const [form, setForm] = useState({ name: "", industry: "", country: "NZ", adminEmail: "", adminName: "" });

  if (session?.role !== "super_admin") {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center gap-4">
        <XCircle className="w-12 h-12 text-destructive" />
        <h2 className="text-xl font-semibold">Access Denied</h2>
        <p className="text-muted-foreground">You need Super Admin privileges to access this area.</p>
        <Button onClick={() => setLocation("/dashboard")}>Return to Dashboard</Button>
      </div>
    );
  }

  const handleCreate = async () => {
    try {
      await createOrg.mutateAsync({ data: form as any });
      toast({ title: "Organisation created" });
      setIsOpen(false);
      setForm({ name: "", industry: "", country: "NZ", adminEmail: "", adminName: "" });
      refetch();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Super Admin Portal</h1>
          <p className="text-muted-foreground mt-1">Manage organisations and platform-wide settings.</p>
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
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
                  <label className="text-sm font-medium mb-1 block">Organisation Name</label>
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
                <p className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wide">Admin User</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Admin Email</label>
                    <Input value={form.adminEmail} onChange={e => setForm(f => ({ ...f, adminEmail: e.target.value }))} placeholder="admin@company.com" type="email" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Admin Name</label>
                    <Input value={form.adminName} onChange={e => setForm(f => ({ ...f, adminName: e.target.value }))} placeholder="Jane Doe" />
                  </div>
                </div>
              </div>
              <Button className="w-full mt-2" onClick={handleCreate} disabled={createOrg.isPending || !form.name || !form.adminEmail}>
                {createOrg.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Create Organisation
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Platform Stats */}
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
                {(stats.totalCo2eKgThisMonth / 1000).toFixed(2)} <span className="text-xl font-normal text-muted-foreground">tonnes</span>
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Organisations Table */}
      <Card className="border-border/50 overflow-hidden">
        <div className="p-6 border-b border-border/50 bg-secondary/20">
          <h3 className="font-semibold text-lg">All Organisations</h3>
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
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {orgs?.items.map((org: any) => (
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
                        <Users className="w-3.5 h-3.5" /> {org.userCount || 0}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Car className="w-3.5 h-3.5" /> {org.vehicleCount || 0}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs ${org.isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-destructive/10 text-destructive'}`}>
                        {org.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
                {(!orgs?.items || orgs.items.length === 0) && (
                  <tr><td colSpan={5} className="px-6 py-10 text-center text-muted-foreground">No organisations yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
