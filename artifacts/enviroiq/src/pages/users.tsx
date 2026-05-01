import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useListUsers, useCreateUser, useDeleteUser, CreateUserRequestRole } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users as UsersIcon, UserPlus, Trash2, Shield, Loader2, Lock, AlertCircle, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

type SignInMethod = "magic_link" | "passkey" | "google_sso" | "microsoft_sso";
type RequiredProvider = "none" | "google" | "microsoft" | null;

interface UserSignInPolicy {
  userId: string;
  requiredSignInProvider: RequiredProvider;
  allowedSignInMethods: SignInMethod[] | null;
  orgPolicy: {
    googleSsoEnabled: boolean;
    microsoftSsoEnabled: boolean;
    allowedSignInMethods: SignInMethod[];
    requiredSsoProvider: "google" | "microsoft" | null;
  };
}

const METHOD_LABELS: Record<SignInMethod, string> = {
  magic_link: "Email magic link",
  passkey: "Passkey",
  google_sso: "Google SSO",
  microsoft_sso: "Microsoft SSO",
};

function describeOrgRequired(p: "google" | "microsoft" | null): string {
  if (!p) return "None (org default)";
  return p === "google" ? "Google only (org default)" : "Microsoft only (org default)";
}

function SignInRestrictionsDialog({
  orgId,
  user,
  open,
  onOpenChange,
}: {
  orgId: string;
  user: { id: string; name: string; email: string };
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<UserSignInPolicy>({
    queryKey: ["userSignInPolicy", orgId, user.id],
    queryFn: async () => {
      const res = await fetch(`/api/organisations/${orgId}/users/${user.id}/sign-in-policy`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load sign-in policy");
      return res.json();
    },
    enabled: open,
  });

  // Local edit state. We keep the override fields as their stored representation
  // (NULL = inherit). The user-facing form maps these to friendly toggles.
  const [draft, setDraft] = useState<{ required: RequiredProvider; allowed: SignInMethod[] | null } | null>(null);

  useEffect(() => {
    if (data) {
      setDraft({
        required: data.requiredSignInProvider,
        allowed: data.allowedSignInMethods,
      });
    }
  }, [data]);

  const mutate = useMutation({
    mutationFn: async (next: { required: RequiredProvider; allowed: SignInMethod[] | null }) => {
      const res = await fetch(`/api/organisations/${orgId}/users/${user.id}/sign-in-policy`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requiredSignInProvider: next.required,
          allowedSignInMethods: next.allowed,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(err.message || "Failed to save sign-in restrictions");
      }
      return res.json() as Promise<UserSignInPolicy>;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(["userSignInPolicy", orgId, user.id], next);
      toast({ title: "Sign-in restrictions updated" });
      onOpenChange(false);
    },
    onError: (e: unknown) => {
      toast({
        variant: "destructive",
        title: "Could not save",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    },
  });

  const overrideAllowed = draft?.allowed !== null && draft?.allowed !== undefined;
  const validationError = overrideAllowed && (draft?.allowed?.length ?? 0) === 0
    ? "If you set a custom allow list, it must include at least one method."
    : null;

  const toggleMethod = (m: SignInMethod) => {
    setDraft((d) => {
      if (!d) return d;
      const list = d.allowed ?? [];
      const has = list.includes(m);
      return { ...d, allowed: has ? list.filter((x) => x !== m) : [...list, m] };
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-primary" />
            Sign-in restrictions for {user.name || user.email}
          </DialogTitle>
        </DialogHeader>

        {isLoading || !data || !draft ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-6 pt-2">
            <p className="text-xs text-muted-foreground">
              These overrides apply <strong>only to this user</strong> and supersede the
              organisation-wide sign-in policy. Leave blank to inherit the org default.
            </p>

            {/* Required provider override */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Required SSO provider for this user
              </label>
              <select
                value={draft.required ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    required: (e.target.value || null) as RequiredProvider,
                  })
                }
                className="w-full h-10 px-3 rounded-md bg-background border border-input text-sm"
                data-testid="select-user-required-provider"
              >
                <option value="">Inherit org default — {describeOrgRequired(data.orgPolicy.requiredSsoProvider)}</option>
                <option value="none">No requirement (override org)</option>
                <option value="google">Must use Google</option>
                <option value="microsoft">Must use Microsoft</option>
              </select>
            </div>

            {/* Allowed methods override */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Allowed sign-in methods
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={overrideAllowed}
                    onChange={(e) => {
                      setDraft({
                        ...draft,
                        allowed: e.target.checked
                          ? (draft.allowed ?? data.orgPolicy.allowedSignInMethods ?? [])
                          : null,
                      });
                    }}
                    className="h-3.5 w-3.5 accent-primary"
                    data-testid="checkbox-override-allowed-methods"
                  />
                  Override org default
                </label>
              </div>

              {!overrideAllowed ? (
                <div className="text-xs text-muted-foreground rounded-md border border-border bg-secondary/20 px-3 py-2">
                  Inheriting org default:{" "}
                  {data.orgPolicy.allowedSignInMethods.length === 0
                    ? "(none)"
                    : data.orgPolicy.allowedSignInMethods.map((m) => METHOD_LABELS[m]).join(", ")}
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-2">
                  {(Object.keys(METHOD_LABELS) as SignInMethod[]).map((m) => (
                    <label
                      key={m}
                      className="flex items-center gap-3 px-3 py-2 rounded-md border border-border bg-background cursor-pointer text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={(draft.allowed ?? []).includes(m)}
                        onChange={() => toggleMethod(m)}
                        className="h-4 w-4 accent-primary"
                        data-testid={`checkbox-user-method-${m}`}
                      />
                      <span className="text-foreground">{METHOD_LABELS[m]}</span>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Org admins always retain a magic-link break-glass path even if magic-link is removed here.
              </p>
            </div>

            {validationError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 flex gap-2 items-start">
                <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                <p className="text-sm text-destructive-foreground">{validationError}</p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutate.isPending}>
                Cancel
              </Button>
              <Button
                disabled={!!validationError || mutate.isPending}
                onClick={() => draft && mutate.mutate(draft)}
                data-testid="button-save-user-sign-in-policy"
              >
                {mutate.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Save restrictions
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Users() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  // Currently-edited user for the Sign-in restrictions dialog.
  const [restrictionsUser, setRestrictionsUser] = useState<{ id: string; name: string; email: string } | null>(null);
  const isAdmin = session?.role === "org_admin" || session?.role === "super_admin";

  const { data: users, isLoading } = useListUsers(orgId!, { query: { enabled: !!orgId } });
  const createUser = useCreateUser();
  const deleteUser = useDeleteUser();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<keyof typeof CreateUserRequestRole>("org_viewer");

  const handleInvite = async () => {
    try {
      await createUser.mutateAsync({ orgId: orgId!, data: { email, name, role: CreateUserRequestRole[role] } });
      toast({ title: "User invited" });
      setIsOpen(false);
      setEmail(""); setName("");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Could not invite user";
      toast({ variant: "destructive", title: "Error", description: message });
    }
  };

  const handleRemove = async (userId: string) => {
    if (!confirm("Remove this user?")) return;
    try {
      await deleteUser.mutateAsync({ orgId: orgId!, userId });
      toast({ title: "User removed" });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Could not remove user";
      toast({ variant: "destructive", title: "Error", description: message });
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
                  onChange={e => setRole(e.target.value as keyof typeof CreateUserRequestRole)}
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
                    <div className="flex items-center justify-end gap-1">
                      {isAdmin && user.id !== session?.userId && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setLocation(`/account?userId=${encodeURIComponent(user.id)}`)}
                          className="text-muted-foreground hover:text-foreground"
                          title="View sign-in methods"
                          data-testid={`button-view-${user.id}`}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      )}
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRestrictionsUser({ id: user.id, name: user.name ?? "", email: user.email })}
                          className="text-muted-foreground hover:text-foreground gap-1.5"
                          data-testid={`button-sign-in-restrictions-${user.id}`}
                          title="Sign-in restrictions"
                        >
                          <Lock className="w-3.5 h-3.5" />
                          <span className="hidden md:inline text-xs">Sign-in</span>
                        </Button>
                      )}
                      {user.id !== session?.userId && (
                        <Button variant="ghost" size="icon" onClick={() => handleRemove(user.id)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {orgId && restrictionsUser && (
        <SignInRestrictionsDialog
          orgId={orgId}
          user={restrictionsUser}
          open={!!restrictionsUser}
          onOpenChange={(v) => { if (!v) setRestrictionsUser(null); }}
        />
      )}
    </div>
  );
}

