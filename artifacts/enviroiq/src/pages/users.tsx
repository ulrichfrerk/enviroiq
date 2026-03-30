import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useListUsers, useCreateUser, useDeleteUser } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users as UsersIcon, UserPlus, Trash2, Shield, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function Users() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);

  const { data: users, isLoading } = useListUsers(orgId!, { query: { enabled: !!orgId } });
  const createUser = useCreateUser();
  const deleteUser = useDeleteUser();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("org_viewer");

  const handleInvite = async () => {
    try {
      await createUser.mutateAsync({ orgId: orgId!, data: { email, name, role: role as any } });
      toast({ title: "User invited" });
      setIsOpen(false);
      setEmail(""); setName("");
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  const handleRemove = async (userId: string) => {
    if (!confirm("Remove this user?")) return;
    try {
      await deleteUser.mutateAsync({ orgId: orgId!, userId });
      toast({ title: "User removed" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  if (isLoading) return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Team Management</h1>
          <p className="text-muted-foreground mt-1">Manage who has access to your organisation.</p>
        </div>
        
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="hover-elevate active-elevate-2 shadow-lg shadow-primary/20">
              <UserPlus className="w-4 h-4 mr-2" /> Invite User
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader><DialogTitle>Invite New User</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Email Address</label>
                <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="colleague@company.com" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Full Name</label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Doe" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Role</label>
                <select 
                  value={role} 
                  onChange={e => setRole(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="org_viewer">Viewer (Read Only)</option>
                  <option value="org_admin">Admin (Full Access)</option>
                </select>
              </div>
              <Button className="w-full mt-2" onClick={handleInvite} disabled={createUser.isPending || !email}>
                {createUser.isPending ? "Inviting..." : "Send Invite"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary/30 text-muted-foreground uppercase text-xs font-semibold">
              <tr>
                <th className="px-6 py-4">User</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Last Login</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {users?.items.map((user) => (
                <tr key={user.id} className="hover:bg-secondary/20 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-foreground font-bold font-display">
                        {user.name ? user.name.charAt(0) : user.email.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-foreground">{user.name || "Pending Invite"}</div>
                        <div className="text-xs text-muted-foreground">{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5">
                      {user.role === 'org_admin' ? <Shield className="w-3.5 h-3.5 text-primary" /> : <UsersIcon className="w-3.5 h-3.5 text-muted-foreground" />}
                      <span className="capitalize">{user.role.replace('org_', '')}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs ${user.isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-secondary text-muted-foreground'}`}>
                      {user.isActive ? 'Active' : 'Invited'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {user.lastLoginAt ? format(new Date(user.lastLoginAt), "MMM d, yyyy") : "Never"}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {user.id !== session?.userId && (
                      <Button variant="ghost" size="icon" onClick={() => handleRemove(user.id)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
