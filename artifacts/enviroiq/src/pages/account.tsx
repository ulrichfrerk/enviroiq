import { useMemo, useState } from "react";
import {
  KeyRound,
  ShieldCheck,
  User,
  Mail,
  BadgeCheck,
  Sparkles,
  ArrowRight,
  Link2,
  Trash2,
  Loader2,
  Eye,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useListUsers } from "@workspace/api-client-react";
import { enrollPasskey } from "@/lib/webauthn";

interface PasskeySummary {
  id: string;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
}

interface SsoIdentitySummary {
  id: string;
  provider: "google" | "microsoft" | string;
  providerEmail: string;
  linkedAt: string;
  lastUsedAt: string;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(data.message || data.error || `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

function providerLabel(provider: string): string {
  if (provider === "google") return "Google";
  if (provider === "microsoft") return "Microsoft";
  return provider;
}

export default function Account() {
  const { session } = useAuth();
  const [enrolling, setEnrolling] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  // Read ?userId= and ?setup= from the URL.
  const search = typeof window !== "undefined" ? window.location.search : "";
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const targetUserIdParam = params.get("userId");
  const isPostLogin = params.get("setup") === "passkey";

  const isAdmin = session?.role === "org_admin" || session?.role === "super_admin";
  // Only admins can enter the "viewing-another-user" state; for everyone
  // else we silently fall back to their own account so the URL param can't
  // produce a misleading read-only view that the API would 403 anyway.
  const isViewingOther = !!(
    targetUserIdParam &&
    targetUserIdParam !== session?.userId &&
    isAdmin
  );
  const targetUserId = isViewingOther ? targetUserIdParam : session?.userId ?? null;

  // For admin-viewing-other, fetch the org's user list to show profile fields.
  const { data: orgUsers } = useListUsers(session?.organisationId ?? "", {
    query: { enabled: !!(isViewingOther && isAdmin && session?.organisationId) },
  });
  const targetUser = useMemo(() => {
    if (!isViewingOther) {
      return session
        ? { id: session.userId, email: session.email, name: session.name, role: session.role }
        : null;
    }
    return orgUsers?.items.find((u) => u.id === targetUserId) ?? null;
  }, [isViewingOther, orgUsers, session, targetUserId]);

  const passkeysQuery = useQuery<PasskeySummary[]>({
    queryKey: ["passkeys", targetUserId],
    queryFn: () =>
      jsonFetch<PasskeySummary[]>(
        isViewingOther
          ? `/api/auth/passkeys?userId=${encodeURIComponent(targetUserId!)}`
          : `/api/auth/passkeys`,
      ),
    enabled: !!targetUserId,
  });

  const identitiesQuery = useQuery<SsoIdentitySummary[]>({
    queryKey: ["sso-identities", targetUserId],
    queryFn: () =>
      jsonFetch<SsoIdentitySummary[]>(
        isViewingOther
          ? `/api/auth/sso/identities?userId=${encodeURIComponent(targetUserId!)}`
          : `/api/auth/sso/identities`,
      ),
    enabled: !!targetUserId,
  });

  const unlinkMutation = useMutation({
    mutationFn: (id: string) =>
      jsonFetch(`/api/auth/sso/identities/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Sign-in method unlinked" });
      void qc.invalidateQueries({ queryKey: ["sso-identities", targetUserId] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Could not unlink";
      toast({ variant: "destructive", title: "Unable to unlink", description: message });
    },
  });

  const handleEnrollPasskey = async () => {
    setEnrolling(true);
    try {
      await enrollPasskey();
      toast({ title: "Passkey added" });
      void qc.invalidateQueries({ queryKey: ["passkeys", targetUserId] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not add passkey";
      toast({ variant: "destructive", title: "Passkey setup failed", description: msg });
    } finally {
      setEnrolling(false);
    }
  };

  const handleUnlink = (identity: SsoIdentitySummary) => {
    if (!confirm(`Unlink ${providerLabel(identity.provider)} (${identity.providerEmail})?`)) return;
    unlinkMutation.mutate(identity.id);
  };

  const roleLabel = (role: string) =>
    role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const passkeys = passkeysQuery.data ?? [];
  const identities = identitiesQuery.data ?? [];

  // "Last sign-in path" guard mirrors the server: an unlink would strand the
  // user only if they have zero passkeys AND only one SSO identity remaining.
  const isLastSignInPath = (i: SsoIdentitySummary) =>
    !isViewingOther && passkeys.length === 0 && identities.length <= 1;

  return (
    <div className="space-y-8 pb-10 max-w-2xl">
      {/* Admin viewing-other banner */}
      {isViewingOther && (
        <div className="rounded-xl border border-border/60 bg-muted/30 p-4 flex items-start gap-3">
          <Eye className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
          <div className="flex-1 text-sm">
            <div className="font-semibold text-foreground">Read-only admin view</div>
            <div className="text-muted-foreground">
              You're viewing another user's account. You can see their sign-in methods but cannot
              change them.
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setLocation("/users")}>
            Back to team
          </Button>
        </div>
      )}

      {/* Post-login passkey setup prompt */}
      {isPostLogin && !isViewingOther && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 flex items-start gap-4">
          <Sparkles className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-foreground">You're signed in — set up a passkey next</p>
            <p className="text-sm text-muted-foreground mt-1">
              Passkeys let you log in with Face ID or Touch ID — no magic link needed next time.
              Hit <strong>Add a Passkey</strong> below, then go to your dashboard.
            </p>
          </div>
        </div>
      )}

      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {isViewingOther ? `${targetUser?.name ?? "User"}'s Account` : "My Account"}
        </h1>
        <p className="text-muted-foreground mt-1">
          {isViewingOther
            ? "Profile and sign-in methods for this team member."
            : "Manage your profile and security settings."}
        </p>
      </div>

      {/* Profile */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="w-5 h-5 text-primary" /> Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3 text-muted-foreground">
              <User className="w-4 h-4" />
              <span className="text-sm">Name</span>
            </div>
            <span className="text-sm font-medium text-foreground">{targetUser?.name || "—"}</span>
          </div>
          <Separator className="border-border/50" />
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3 text-muted-foreground">
              <Mail className="w-4 h-4" />
              <span className="text-sm">Email</span>
            </div>
            <span className="text-sm font-medium text-foreground">{targetUser?.email || "—"}</span>
          </div>
          <Separator className="border-border/50" />
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3 text-muted-foreground">
              <BadgeCheck className="w-4 h-4" />
              <span className="text-sm">Role</span>
            </div>
            <Badge variant="secondary" className="capitalize">
              {roleLabel(targetUser?.role || "")}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Sign-in methods — Passkeys */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <KeyRound className="w-5 h-5 text-primary" /> Passkeys
          </CardTitle>
          <CardDescription>
            {isViewingOther
              ? "Devices this user can sign in from with Face ID, Touch ID, or device PIN."
              : "Sign in instantly with Face ID, Touch ID, or device PIN — no password needed."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {passkeysQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading passkeys…
            </div>
          ) : passkeys.length === 0 ? (
            <div className="rounded-lg bg-muted/30 border border-border/50 p-4 text-sm text-muted-foreground">
              No passkeys enrolled{isViewingOther ? " for this user." : " yet."}
            </div>
          ) : (
            <ul className="space-y-2">
              {passkeys.map((pk) => (
                <li
                  key={pk.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/10 px-4 py-3"
                  data-testid={`passkey-${pk.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <KeyRound className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">
                        {pk.deviceType === "multiDevice" ? "Synced passkey" : "Device passkey"}
                        {pk.backedUp && (
                          <Badge variant="secondary" className="ml-2 text-[10px] py-0">
                            Cloud-synced
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Added {format(new Date(pk.createdAt), "MMM d, yyyy")}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!isViewingOther && (
            <div className="space-y-2 pt-2">
              <Button
                onClick={handleEnrollPasskey}
                disabled={enrolling}
                className="w-full sm:w-auto gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                data-testid="button-add-passkey"
              >
                <KeyRound className="w-4 h-4" />
                {enrolling ? "Setting up passkey…" : "Add a Passkey"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Your browser will prompt you to use Face ID, Touch ID, or your device PIN.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sign-in methods — Linked SSO identities */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Link2 className="w-5 h-5 text-primary" /> Linked sign-in accounts
          </CardTitle>
          <CardDescription>
            {isViewingOther
              ? "Google or Microsoft accounts this user has signed in with."
              : "Google or Microsoft accounts you can use to sign in to EnviroIQ."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {identitiesQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading linked accounts…
            </div>
          ) : identities.length === 0 ? (
            <div className="rounded-lg bg-muted/30 border border-border/50 p-4 text-sm text-muted-foreground">
              No SSO accounts linked
              {isViewingOther
                ? "."
                : " yet. Sign in with Google or Microsoft to link one."}
            </div>
          ) : (
            <ul className="space-y-2">
              {identities.map((id) => {
                const lastBlock = isLastSignInPath(id);
                return (
                  <li
                    key={id.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/10 px-4 py-3"
                    data-testid={`sso-identity-${id.id}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <ShieldCheck className="w-4 h-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">
                          {providerLabel(id.provider)} · {id.providerEmail}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Linked {format(new Date(id.linkedAt), "MMM d, yyyy")}
                          {id.lastUsedAt && (
                            <> · Last used {format(new Date(id.lastUsedAt), "MMM d, yyyy")}</>
                          )}
                        </div>
                      </div>
                    </div>
                    {!isViewingOther && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive flex-shrink-0 gap-1.5"
                        disabled={lastBlock || unlinkMutation.isPending}
                        onClick={() => handleUnlink(id)}
                        title={
                          lastBlock
                            ? "This is your only sign-in method — add a passkey or link another account first."
                            : "Unlink this account"
                        }
                        data-testid={`button-unlink-${id.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                        Unlink
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {!isViewingOther && passkeys.length === 0 && identities.length === 1 && (
            <p className="text-xs text-muted-foreground">
              Add a passkey or link another account before unlinking your last sign-in method.
            </p>
          )}

          {!isViewingOther && (
            <div className="flex flex-wrap gap-2 pt-2">
              <a
                href="/api/auth/sso/google/start?returnTo=/app/account"
                className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded-md border border-border bg-background hover:bg-muted/50"
                data-testid="link-link-google"
              >
                <ArrowRight className="w-3.5 h-3.5" /> Link a Google account
              </a>
              <a
                href="/api/auth/sso/microsoft/start?returnTo=/app/account"
                className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded-md border border-border bg-background hover:bg-muted/50"
                data-testid="link-link-microsoft"
              >
                <ArrowRight className="w-3.5 h-3.5" /> Link a Microsoft account
              </a>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
