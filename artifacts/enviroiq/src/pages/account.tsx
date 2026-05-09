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
  AlertTriangle,
  Pencil,
  Check,
  X,
  BellRing,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format, differenceInCalendarDays } from "date-fns";
import { useListUsers } from "@workspace/api-client-react";
import { enrollPasskey } from "@/lib/webauthn";

interface PasskeySummary {
  id: string;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  label: string | null;
}

// Mirrors the server-side cap in `PATCH /auth/passkeys/:id`. Kept in sync by
// hand because the api-spec layer doesn't surface this endpoint yet.
const PASSKEY_LABEL_MAX = 64;

/** Default name when the user hasn't given the device a friendly label. */
function defaultPasskeyName(pk: Pick<PasskeySummary, "deviceType">): string {
  return pk.deviceType === "multiDevice" ? "Synced passkey" : "Device passkey";
}

interface PasskeyPolicy {
  ok: boolean;
  source: "user" | "org" | null;
}

interface PasskeysResponse {
  passkeys: PasskeySummary[];
  policy: PasskeyPolicy;
}

/**
 * Inline copy shown on each passkey row when the user's effective sign-in
 * policy now forbids `passkey` (task #42). Wording matches the sign-in page
 * restriction callout (task #19): a per-user override says "your account",
 * an org-wide policy says "your organisation".
 */
function passkeyBlockedMessage(source: PasskeyPolicy["source"]): string {
  if (source === "user") {
    return "Disabled by your administrator — your account's sign-in policy doesn't allow passkeys.";
  }
  return "Disabled by your administrator — your organisation's sign-in policy doesn't allow passkeys.";
}

interface SsoIdentitySummary {
  id: string;
  provider: "google" | "microsoft" | string;
  providerEmail: string;
  linkedAt: string;
  lastUsedAt: string | null;
}

// Sign-in methods that haven't been touched in this many days are flagged as
// stale on the Account page so the user notices and can remove them. 90 days
// is the same threshold used by industry guidance (NIST 800-63B "infrequently
// used") and matches what other security dashboards show.
const STALE_THRESHOLD_DAYS = 90;

/**
 * Returns the number of whole days since `iso` (or null if `iso` is null).
 * We use calendar days rather than exact 24h windows so "today" is always 0.
 */
function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return differenceInCalendarDays(new Date(), d);
}

/**
 * "Last used Mar 14, 2026" / "Never used". Takes the last-used timestamp and
 * the row's creation timestamp so we can hint that brand-new methods that
 * haven't been signed in with yet are merely fresh, not abandoned.
 */
function lastUsedLabel(lastUsedAt: string | null): string {
  if (!lastUsedAt) return "Never used";
  return `Last used ${format(new Date(lastUsedAt), "MMM d, yyyy")}`;
}

/**
 * Stale = last-used is at least STALE_THRESHOLD_DAYS old. Methods that have
 * never been used count as stale only once the row itself is older than the
 * threshold — that way a freshly-enrolled passkey isn't yelled at on day 1.
 */
function isStale(lastUsedAt: string | null, createdAt: string): boolean {
  const reference = lastUsedAt ?? createdAt;
  const age = daysSince(reference);
  return age !== null && age >= STALE_THRESHOLD_DAYS;
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

  const passkeysQuery = useQuery<PasskeysResponse>({
    queryKey: ["passkeys", targetUserId],
    queryFn: () =>
      jsonFetch<PasskeysResponse>(
        isViewingOther
          ? `/api/auth/passkeys?userId=${encodeURIComponent(targetUserId!)}`
          : `/api/auth/passkeys`,
      ),
    enabled: !!targetUserId,
  });
  const passkeyPolicy: PasskeyPolicy = passkeysQuery.data?.policy ?? { ok: true, source: null };

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

  const unlinkPasskeyMutation = useMutation({
    mutationFn: (id: string) =>
      jsonFetch(`/api/auth/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Passkey removed" });
      void qc.invalidateQueries({ queryKey: ["passkeys", targetUserId] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Could not remove passkey";
      toast({ variant: "destructive", title: "Unable to remove passkey", description: message });
    },
  });

  // Inline rename state — only one passkey is editable at a time. Storing the
  // id (not a boolean) lets us close the previous editor automatically when
  // the user clicks Rename on a different row.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");

  const renameMutation = useMutation({
    mutationFn: (vars: { id: string; label: string | null }) =>
      jsonFetch<PasskeySummary>(`/api/auth/passkeys/${encodeURIComponent(vars.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ label: vars.label }),
      }),
    onSuccess: () => {
      toast({ title: "Passkey renamed" });
      setRenamingId(null);
      setLabelDraft("");
      void qc.invalidateQueries({ queryKey: ["passkeys", targetUserId] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Could not rename passkey";
      toast({ variant: "destructive", title: "Rename failed", description: message });
    },
  });

  const startRename = (pk: PasskeySummary) => {
    setRenamingId(pk.id);
    setLabelDraft(pk.label ?? "");
  };
  const cancelRename = () => {
    setRenamingId(null);
    setLabelDraft("");
  };
  const submitRename = (pk: PasskeySummary) => {
    const trimmed = labelDraft.trim();
    // Avoid a no-op round-trip: if the trimmed value matches what's already
    // stored (treating "" and null as equivalent), just close the editor.
    const current = pk.label ?? "";
    if (trimmed === current) {
      cancelRename();
      return;
    }
    renameMutation.mutate({ id: pk.id, label: trimmed.length === 0 ? null : trimmed });
  };

  // Per-user opt-in for system-generated email notifications. Default OFF on
  // the server; this toggle is the only way to turn them on. Only relevant
  // for the user themselves — admins viewing another user's account see the
  // current state but the toggle is disabled (only the user can change it).
  const emailOptIn = session?.emailNotificationsEnabled ?? false;
  const notifPrefMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      jsonFetch<{ emailNotificationsEnabled: boolean }>(
        `/api/auth/me/notification-preferences`,
        { method: "PATCH", body: JSON.stringify({ emailNotificationsEnabled: enabled }) },
      ),
    onSuccess: (data) => {
      toast({
        title: data.emailNotificationsEnabled ? "Email notifications turned on" : "Email notifications turned off",
        description: data.emailNotificationsEnabled
          ? "You'll receive the daily ESG data quality digest and other alerts at your account email."
          : "You'll still see notifications in the bell icon — emails are paused.",
      });
      void qc.invalidateQueries({ queryKey: ["auth", "session"] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Could not update preference";
      toast({ variant: "destructive", title: "Update failed", description: message });
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

  const handleUnlinkPasskey = (pk: PasskeySummary) => {
    const name = pk.label?.trim() || defaultPasskeyName(pk);
    if (!confirm(`Remove passkey "${name}"? You won't be able to sign in from this device until you re-enrol.`)) return;
    unlinkPasskeyMutation.mutate(pk.id);
  };

  const roleLabel = (role: string) =>
    role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // Stale items are surfaced first so users see what to deal with without
  // hunting. Within a group we keep the oldest-used at the top so the worst
  // offenders are the most prominent.
  const passkeys = useMemo(() => {
    const list = [...(passkeysQuery.data?.passkeys ?? [])];
    list.sort((a, b) => {
      const aStale = isStale(a.lastUsedAt, a.createdAt) ? 0 : 1;
      const bStale = isStale(b.lastUsedAt, b.createdAt) ? 0 : 1;
      if (aStale !== bStale) return aStale - bStale;
      const aRef = a.lastUsedAt ?? a.createdAt;
      const bRef = b.lastUsedAt ?? b.createdAt;
      return new Date(aRef).getTime() - new Date(bRef).getTime();
    });
    return list;
  }, [passkeysQuery.data]);

  const identities = useMemo(() => {
    const list = [...(identitiesQuery.data ?? [])];
    list.sort((a, b) => {
      const aStale = isStale(a.lastUsedAt, a.linkedAt) ? 0 : 1;
      const bStale = isStale(b.lastUsedAt, b.linkedAt) ? 0 : 1;
      if (aStale !== bStale) return aStale - bStale;
      const aRef = a.lastUsedAt ?? a.linkedAt;
      const bRef = b.lastUsedAt ?? b.linkedAt;
      return new Date(aRef).getTime() - new Date(bRef).getTime();
    });
    return list;
  }, [identitiesQuery.data]);

  // "Last sign-in path" guard mirrors the server: an unlink would strand the
  // user only if they have zero passkeys AND only one SSO identity remaining.
  const isLastSignInPath = (_i: SsoIdentitySummary) =>
    !isViewingOther && passkeys.length === 0 && identities.length <= 1;

  // Mirror of the server-side guard in `DELETE /auth/passkeys/:id`: removing
  // this passkey would strand the user when it's their only passkey and they
  // also have no SSO identities linked.
  const isLastPasskeySignInPath = (_pk: PasskeySummary) =>
    !isViewingOther && passkeys.length <= 1 && identities.length === 0;

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

      {/* Email notifications opt-in (only meaningful for the user themselves) */}
      {!isViewingOther && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <BellRing className="w-5 h-5 text-primary" /> Email notifications
            </CardTitle>
            <CardDescription>
              Get the daily ESG data quality digest and important alerts at your account email. You'll always see notifications in the bell icon — this only controls whether we email you too.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-4 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Send notifications to {targetUser?.email}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Off by default. Turn on when you want EnviroIQ to email you about data-quality issues, fleet imports, audit reminders and security alerts.
                </p>
              </div>
              <Switch
                checked={emailOptIn}
                disabled={notifPrefMutation.isPending}
                onCheckedChange={(checked) => notifPrefMutation.mutate(checked)}
                aria-label="Toggle email notifications"
              />
            </div>
          </CardContent>
        </Card>
      )}

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
              {passkeys.map((pk) => {
                const stale = isStale(pk.lastUsedAt, pk.createdAt);
                const isEditing = renamingId === pk.id;
                const displayName = pk.label?.trim() || defaultPasskeyName(pk);
                const isRenamePending =
                  renameMutation.isPending && renameMutation.variables?.id === pk.id;
                const lastBlockPk = isLastPasskeySignInPath(pk);
                const isUnlinkPending =
                  unlinkPasskeyMutation.isPending &&
                  unlinkPasskeyMutation.variables === pk.id;
                return (
                  <li
                    key={pk.id}
                    className={
                      stale
                        ? "flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3"
                        : "flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/10 px-4 py-3"
                    }
                    data-testid={`passkey-${pk.id}`}
                    data-stale={stale ? "true" : "false"}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div
                        className={
                          stale
                            ? "w-9 h-9 rounded-md bg-amber-500/20 flex items-center justify-center flex-shrink-0"
                            : "w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0"
                        }
                      >
                        {stale ? (
                          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        ) : (
                          <KeyRound className="w-4 h-4 text-primary" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <div className="flex flex-col gap-1.5">
                            <Input
                              autoFocus
                              value={labelDraft}
                              onChange={(e) => setLabelDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  submitRename(pk);
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  cancelRename();
                                }
                              }}
                              maxLength={PASSKEY_LABEL_MAX}
                              placeholder={defaultPasskeyName(pk)}
                              className="h-8 text-sm"
                              disabled={isRenamePending}
                              data-testid={`input-passkey-label-${pk.id}`}
                            />
                            <p className="text-[11px] text-muted-foreground">
                              Give this device a name like "MacBook Pro" or "iPhone 15".
                              Leave blank to clear.
                            </p>
                          </div>
                        ) : (
                          <>
                            <div className="text-sm font-medium text-foreground truncate">
                              <span data-testid={`passkey-name-${pk.id}`}>{displayName}</span>
                              {pk.backedUp && (
                                <Badge variant="secondary" className="ml-2 text-[10px] py-0">
                                  Cloud-synced
                                </Badge>
                              )}
                              {stale && (
                                <Badge
                                  variant="outline"
                                  className="ml-2 text-[10px] py-0 border-amber-500/50 text-amber-700 dark:text-amber-300"
                                  data-testid={`passkey-stale-${pk.id}`}
                                >
                                  Stale
                                </Badge>
                              )}
                              {!passkeyPolicy.ok && (
                                <Badge
                                  variant="outline"
                                  className="ml-2 text-[10px] py-0 border-amber-500/60 text-amber-700 dark:text-amber-300"
                                  data-testid={`passkey-blocked-${pk.id}`}
                                >
                                  Blocked by policy
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Added {format(new Date(pk.createdAt), "MMM d, yyyy")} ·{" "}
                              <span data-testid={`passkey-last-used-${pk.id}`}>
                                {lastUsedLabel(pk.lastUsedAt)}
                              </span>
                            </div>
                            {!passkeyPolicy.ok && (
                              <div
                                className="text-xs text-amber-700 dark:text-amber-300 mt-1"
                                data-testid={`passkey-blocked-message-${pk.id}`}
                              >
                                {passkeyBlockedMessage(passkeyPolicy.source)}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    {!isViewingOther && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {isEditing ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-foreground gap-1"
                              onClick={() => submitRename(pk)}
                              disabled={isRenamePending}
                              data-testid={`button-passkey-save-${pk.id}`}
                              title="Save name"
                            >
                              {isRenamePending ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Check className="w-4 h-4" />
                              )}
                              Save
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={cancelRename}
                              disabled={isRenamePending}
                              data-testid={`button-passkey-cancel-${pk.id}`}
                              title="Cancel"
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-foreground gap-1.5"
                              onClick={() => startRename(pk)}
                              disabled={renameMutation.isPending || isUnlinkPending}
                              data-testid={`button-passkey-rename-${pk.id}`}
                              title="Rename this passkey"
                            >
                              <Pencil className="w-4 h-4" />
                              Rename
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-destructive gap-1.5"
                              onClick={() => handleUnlinkPasskey(pk)}
                              disabled={
                                lastBlockPk ||
                                isUnlinkPending ||
                                renameMutation.isPending
                              }
                              title={
                                lastBlockPk
                                  ? "This is your only sign-in method — add another passkey or link an SSO account first."
                                  : "Remove this passkey"
                              }
                              data-testid={`button-passkey-unlink-${pk.id}`}
                            >
                              {isUnlinkPending ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                              Unlink
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {!isViewingOther && passkeys.length === 1 && identities.length === 0 && (
            <p className="text-xs text-muted-foreground" data-testid="text-last-passkey-hint">
              Add another passkey or link an SSO account before removing your last sign-in method.
            </p>
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
                const stale = isStale(id.lastUsedAt, id.linkedAt);
                return (
                  <li
                    key={id.id}
                    className={
                      stale
                        ? "flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3"
                        : "flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/10 px-4 py-3"
                    }
                    data-testid={`sso-identity-${id.id}`}
                    data-stale={stale ? "true" : "false"}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={
                          stale
                            ? "w-9 h-9 rounded-md bg-amber-500/20 flex items-center justify-center flex-shrink-0"
                            : "w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0"
                        }
                      >
                        {stale ? (
                          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        ) : (
                          <ShieldCheck className="w-4 h-4 text-primary" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">
                          {providerLabel(id.provider)} · {id.providerEmail}
                          {stale && (
                            <Badge
                              variant="outline"
                              className="ml-2 text-[10px] py-0 border-amber-500/50 text-amber-700 dark:text-amber-300"
                              data-testid={`sso-identity-stale-${id.id}`}
                            >
                              Stale
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Linked {format(new Date(id.linkedAt), "MMM d, yyyy")} ·{" "}
                          <span data-testid={`sso-identity-last-used-${id.id}`}>
                            {lastUsedLabel(id.lastUsedAt)}
                          </span>
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
