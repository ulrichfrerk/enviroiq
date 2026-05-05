import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useListUsers, useCreateUser, useDeleteUser, CreateUserRequestRole, getListUsersQueryKey } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users as UsersIcon, UserPlus, Trash2, Shield, Loader2, Lock, AlertCircle, Eye, X, CheckCircle2, History } from "lucide-react";
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

interface SignInPolicyHistoryEntry {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorType: string | null;
  previousValue: {
    requiredSignInProvider?: RequiredProvider;
    allowedSignInMethods?: SignInMethod[] | null;
  } | null;
  newValue: {
    requiredSignInProvider?: RequiredProvider;
    allowedSignInMethods?: SignInMethod[] | null;
  } | null;
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

function describeRequired(v: RequiredProvider | undefined): string {
  if (v === undefined || v === null) return "inherit org";
  if (v === "none") return "no requirement";
  if (v === "google") return "Google";
  if (v === "microsoft") return "Microsoft";
  return String(v);
}

function describeAllowed(v: SignInMethod[] | null | undefined): string {
  if (v === undefined || v === null) return "inherit org";
  if (v.length === 0) return "(none)";
  return v.map((m) => METHOD_LABELS[m] ?? m).join(", ");
}

function diffSignInPolicy(entry: SignInPolicyHistoryEntry): string[] {
  const lines: string[] = [];
  const prev = entry.previousValue ?? {};
  const next = entry.newValue ?? {};
  const prevReq = prev.requiredSignInProvider ?? null;
  const nextReq = next.requiredSignInProvider ?? null;
  if (prevReq !== nextReq) {
    lines.push(
      `Required provider: ${describeRequired(prevReq)} → ${describeRequired(nextReq)}`,
    );
  }
  const prevAllowed = prev.allowedSignInMethods ?? null;
  const nextAllowed = next.allowedSignInMethods ?? null;
  const sameAllowed =
    (prevAllowed === null && nextAllowed === null) ||
    (Array.isArray(prevAllowed) &&
      Array.isArray(nextAllowed) &&
      prevAllowed.length === nextAllowed.length &&
      prevAllowed.every((m) => nextAllowed.includes(m)));
  if (!sameAllowed) {
    lines.push(
      `Allowed methods: ${describeAllowed(prevAllowed)} → ${describeAllowed(nextAllowed)}`,
    );
  }
  if (lines.length === 0) lines.push("No effective change");
  return lines;
}

function describeActor(entry: SignInPolicyHistoryEntry): string {
  if (entry.actorEmail) return entry.actorEmail;
  if (entry.actorType === "system") return "System";
  if (entry.actorType === "scheduler") return "Scheduler";
  if (entry.actorType === "api_key") return "API key";
  if (entry.actorType === "webhook") return "Webhook";
  // Legacy or system entries may have a user id but no captured email —
  // fall back to the id so the row is still useful for auditing.
  if (entry.actorUserId) return `User ${entry.actorUserId}`;
  return "Unknown";
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

  const historyQuery = useQuery<{ items: SignInPolicyHistoryEntry[] }>({
    queryKey: ["userSignInPolicyHistory", orgId, user.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/organisations/${orgId}/users/${user.id}/sign-in-policy/history`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load sign-in policy history");
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
      // Make sure the history list reflects the change next time the dialog opens.
      queryClient.invalidateQueries({ queryKey: ["userSignInPolicyHistory", orgId, user.id] });
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
      <DialogContent className="bg-card border-border max-w-lg max-h-[90vh] overflow-y-auto">
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

            {/* Change history — answers "why is this user restricted?" without
                forcing the admin to leave the page for the audit log. */}
            <div className="space-y-2 pt-2 border-t border-border" data-testid="sign-in-policy-history">
              <div className="flex items-center gap-2">
                <History className="w-3.5 h-3.5 text-muted-foreground" />
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  History
                </h3>
              </div>
              {historyQuery.isLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading history…
                </div>
              ) : historyQuery.isError ? (
                <p className="text-xs text-destructive">Could not load history.</p>
              ) : (historyQuery.data?.items?.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No restriction changes recorded for this user yet.
                </p>
              ) : (
                <ul className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {historyQuery.data!.items.map((entry) => {
                    const lines = diffSignInPolicy(entry);
                    const when = (() => {
                      try {
                        return format(new Date(entry.createdAt), "PPpp");
                      } catch {
                        return entry.createdAt;
                      }
                    })();
                    return (
                      <li
                        key={entry.id}
                        className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs space-y-1"
                        data-testid={`sign-in-policy-history-entry-${entry.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-foreground truncate">
                            {describeActor(entry)}
                          </span>
                          <time className="text-muted-foreground whitespace-nowrap">{when}</time>
                        </div>
                        <ul className="text-muted-foreground space-y-0.5">
                          {lines.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

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

interface BulkPolicyTarget {
  id: string;
  name: string;
  email: string;
}

interface BulkPolicyResponse {
  updated: Array<{
    userId: string;
    email: string;
    name: string | null;
    requiredSignInProvider: string | null;
    allowedSignInMethods: SignInMethod[] | null;
  }>;
  skipped: Array<{
    userId: string;
    email?: string;
    name?: string | null;
    reason: "not_found" | "would_lock_out";
    message: string;
  }>;
  requested: number;
  orgPolicy: UserSignInPolicy["orgPolicy"];
}

function BulkSignInRestrictionsDialog({
  orgId,
  targets,
  open,
  onOpenChange,
  onApplied,
}: {
  orgId: string;
  targets: BulkPolicyTarget[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onApplied: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Org policy snapshot (used to render placeholders for "inherit"). We borrow
  // the per-user GET endpoint by asking for an arbitrary selected user — its
  // response includes the org policy block we need.
  const probeUserId = targets[0]?.id;
  const { data: probe } = useQuery<UserSignInPolicy>({
    queryKey: ["userSignInPolicy", orgId, probeUserId],
    queryFn: async () => {
      const res = await fetch(`/api/organisations/${orgId}/users/${probeUserId}/sign-in-policy`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load org policy snapshot");
      return res.json();
    },
    enabled: open && !!probeUserId,
  });

  // Each field has three explicit modes:
  //   "unchanged" — don't send the field; existing per-user overrides preserved
  //   "clear"     — send null; existing per-user overrides removed (inherit org)
  //   "set"       — send a concrete value (provider name OR custom method list)
  // This makes the admin's intent unambiguous and matches the backend's
  // "at least one field provided" requirement.
  type RequiredMode = "unchanged" | "clear" | "set";
  type AllowedMode = "unchanged" | "clear" | "set";
  const [requiredMode, setRequiredMode] = useState<RequiredMode>("unchanged");
  const [requiredValue, setRequiredValue] = useState<Exclude<RequiredProvider, null>>("none");
  const [allowedMode, setAllowedMode] = useState<AllowedMode>("unchanged");
  const [allowed, setAllowed] = useState<SignInMethod[]>([]);
  const [result, setResult] = useState<BulkPolicyResponse | null>(null);

  useEffect(() => {
    if (open) {
      setRequiredMode("unchanged");
      setRequiredValue("none");
      setAllowedMode("unchanged");
      setAllowed([]);
      setResult(null);
    }
  }, [open]);

  const noFieldChosen = requiredMode === "unchanged" && allowedMode === "unchanged";
  const validationError =
    allowedMode === "set" && allowed.length === 0
      ? "If you set a custom allow list, it must include at least one method."
      : null;

  const toggleMethod = (m: SignInMethod) => {
    setAllowed((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
  };

  const mutate = useMutation({
    mutationFn: async () => {
      const body: {
        userIds: string[];
        requiredSignInProvider?: RequiredProvider;
        allowedSignInMethods?: SignInMethod[] | null;
      } = { userIds: targets.map((t) => t.id) };
      if (requiredMode === "clear") body.requiredSignInProvider = null;
      else if (requiredMode === "set") body.requiredSignInProvider = requiredValue;
      if (allowedMode === "clear") body.allowedSignInMethods = null;
      else if (allowedMode === "set") body.allowedSignInMethods = allowed;
      const res = await fetch(`/api/organisations/${orgId}/users/sign-in-policy/bulk`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(err.message || "Bulk update failed");
      }
      return (await res.json()) as BulkPolicyResponse;
    },
    onSuccess: (data) => {
      // Invalidate per-user policy caches so the per-user dialog reflects bulk changes.
      for (const u of data.updated) {
        queryClient.invalidateQueries({ queryKey: ["userSignInPolicy", orgId, u.userId] });
      }
      setResult(data);
      const updatedCount = data.updated.length;
      const skippedCount = data.skipped.length;
      toast({
        title:
          skippedCount === 0
            ? `Sign-in restrictions applied to ${updatedCount} user${updatedCount === 1 ? "" : "s"}`
            : `Applied to ${updatedCount}, skipped ${skippedCount}`,
        description:
          skippedCount === 0
            ? undefined
            : "Some users were skipped because the new restrictions would lock them out.",
        variant: skippedCount === 0 ? "default" : "destructive",
      });
      if (skippedCount === 0) {
        onApplied();
        onOpenChange(false);
      }
    },
    onError: (e: unknown) => {
      toast({
        variant: "destructive",
        title: "Could not save",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    },
  });

  const orgPolicy = probe?.orgPolicy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-primary" />
            Apply sign-in restrictions to {targets.length} user{targets.length === 1 ? "" : "s"}
          </DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-4 pt-2" data-testid="bulk-sign-in-result">
            <div className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-sm">
              <div className="flex items-center gap-2 text-foreground">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Applied to <strong>{result.updated.length}</strong> of {result.requested} selected user
                {result.requested === 1 ? "" : "s"}.
              </div>
            </div>
            {result.skipped.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
                <div className="flex items-center gap-2 text-sm text-destructive-foreground font-medium mb-2">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  Skipped {result.skipped.length} user{result.skipped.length === 1 ? "" : "s"}
                </div>
                <ul className="text-xs text-muted-foreground space-y-1.5 max-h-40 overflow-auto">
                  {result.skipped.map((s) => (
                    <li key={s.userId} data-testid={`bulk-skipped-${s.userId}`}>
                      <span className="text-foreground">{s.name || s.email || s.userId}</span>
                      {" — "}
                      {s.reason === "would_lock_out" ? "would be locked out" : "user not found"}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end pt-2">
              <Button
                onClick={() => {
                  onApplied();
                  onOpenChange(false);
                }}
                data-testid="button-bulk-close"
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6 pt-2">
            <p className="text-xs text-muted-foreground">
              These overrides will be applied to <strong>each selected user</strong> and supersede the
              organisation-wide sign-in policy. Leave blank to inherit the org default. Users that would
              be locked out by the new restrictions are reported and skipped.
            </p>

            <div className="rounded-md border border-border bg-secondary/20 px-3 py-2 max-h-32 overflow-auto">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                Selected users
              </div>
              <div className="text-xs text-foreground space-y-0.5">
                {targets.map((t) => (
                  <div key={t.id} data-testid={`bulk-target-${t.id}`}>
                    {t.name || t.email}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Required SSO provider
              </label>
              <select
                value={
                  requiredMode === "unchanged"
                    ? "__unchanged__"
                    : requiredMode === "clear"
                      ? "__clear__"
                      : requiredValue
                }
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "__unchanged__") setRequiredMode("unchanged");
                  else if (v === "__clear__") setRequiredMode("clear");
                  else {
                    setRequiredMode("set");
                    setRequiredValue(v as Exclude<RequiredProvider, null>);
                  }
                }}
                className="w-full h-10 px-3 rounded-md bg-background border border-input text-sm"
                data-testid="select-bulk-required-provider"
              >
                <option value="__unchanged__">Don't change (keep each user's existing setting)</option>
                <option value="__clear__">
                  Clear override → inherit org default ({describeOrgRequired(orgPolicy?.requiredSsoProvider ?? null)})
                </option>
                <option value="none">Set: no requirement (override org)</option>
                <option value="google">Set: must use Google</option>
                <option value="microsoft">Set: must use Microsoft</option>
              </select>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Allowed sign-in methods
              </label>
              <select
                value={allowedMode}
                onChange={(e) => setAllowedMode(e.target.value as AllowedMode)}
                className="w-full h-10 px-3 rounded-md bg-background border border-input text-sm"
                data-testid="select-bulk-allowed-mode"
              >
                <option value="unchanged">Don't change (keep each user's existing setting)</option>
                <option value="clear">
                  Clear override → inherit org default (
                  {!orgPolicy || orgPolicy.allowedSignInMethods.length === 0
                    ? "none"
                    : orgPolicy.allowedSignInMethods.map((m) => METHOD_LABELS[m]).join(", ")}
                  )
                </option>
                <option value="set">Set a custom allow list (override org)</option>
              </select>

              {/* Backwards-compat alias for the prior override checkbox testid: checking
                  switches mode to "set", unchecking switches to "unchanged". */}
              <label className="hidden">
                <input
                  type="checkbox"
                  checked={allowedMode === "set"}
                  onChange={(e) => setAllowedMode(e.target.checked ? "set" : "unchanged")}
                  data-testid="checkbox-bulk-override-allowed-methods"
                />
              </label>

              {allowedMode === "set" && (
                <div className="grid sm:grid-cols-2 gap-2">
                  {(Object.keys(METHOD_LABELS) as SignInMethod[]).map((m) => (
                    <label
                      key={m}
                      className="flex items-center gap-3 px-3 py-2 rounded-md border border-border bg-background cursor-pointer text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={allowed.includes(m)}
                        onChange={() => toggleMethod(m)}
                        className="h-4 w-4 accent-primary"
                        data-testid={`checkbox-bulk-method-${m}`}
                      />
                      <span className="text-foreground">{METHOD_LABELS[m]}</span>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Org admins always retain a magic-link break-glass path even if magic-link is removed
                here.
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
                disabled={!!validationError || noFieldChosen || mutate.isPending}
                onClick={() => mutate.mutate()}
                data-testid="button-apply-bulk-sign-in-policy"
                title={
                  noFieldChosen
                    ? "Choose a required SSO provider or override the allowed sign-in methods to apply changes."
                    : undefined
                }
              >
                {mutate.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Apply to {targets.length} user{targets.length === 1 ? "" : "s"}
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

  const queryClient = useQueryClient();
  const { data: users, isLoading, isSuccess: usersLoaded } = useListUsers(orgId!, { query: { enabled: !!orgId } });
  const createUser = useCreateUser();
  const deleteUser = useDeleteUser();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<keyof typeof CreateUserRequestRole>("org_viewer");

  // Multi-select state for bulk sign-in restriction action. We store ids in a Set
  // and prune any that disappear from the list (e.g. after a user is removed).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  const userItems = users?.items ?? [];

  // Allow deep-linking from the audit log: `/users?signInUserId=<id>` opens the
  // Sign-in restrictions dialog (with its History section) for that user. The
  // optional `signInOrgId` param carries the audit row's organisation so we can
  // detect a cross-org deep-link (e.g. from the super-admin global audit view)
  // and surface a clear error instead of silently looking the user up in the
  // wrong tenant. Once we've handled the param, strip it so a refresh doesn't
  // reopen the dialog.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Wait until the user list query has completed before processing the
    // deep-link, so that an org with zero users still surfaces a clear
    // "User not found" toast and clears the URL params (rather than getting
    // stuck with the params indefinitely).
    if (!isAdmin || !orgId || !usersLoaded) return;
    const params = new URLSearchParams(window.location.search);
    const targetId = params.get("signInUserId");
    if (!targetId) return;
    const targetOrgId = params.get("signInOrgId");

    if (targetOrgId && targetOrgId !== orgId) {
      toast({
        variant: "destructive",
        title: "Different organisation",
        description: "This audit entry belongs to another organisation. Switch to that org to view the user's restriction history.",
      });
    } else {
      const target = userItems.find((u) => u.id === targetId);
      if (target) {
        setRestrictionsUser({ id: target.id, name: target.name ?? "", email: target.email });
      } else {
        toast({
          variant: "destructive",
          title: "User not found",
          description: "That user is no longer in this organisation.",
        });
      }
    }
    params.delete("signInUserId");
    params.delete("signInOrgId");
    const qs = params.toString();
    setLocation(qs ? `/users?${qs}` : "/users", { replace: true });
  }, [isAdmin, orgId, usersLoaded, userItems, setLocation, toast]);


  // Admins cannot bulk-edit themselves (avoids self-lockout footguns and matches
  // the per-row UI that hides destructive actions on the current user).
  const selectableUsers = useMemo(
    () => userItems.filter((u) => u.id !== session?.userId),
    [userItems, session?.userId],
  );

  useEffect(() => {
    setSelectedIds((prev) => {
      const valid = new Set(selectableUsers.map((u) => u.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [selectableUsers]);

  const allSelectableSelected =
    selectableUsers.length > 0 && selectableUsers.every((u) => selectedIds.has(u.id));
  const someSelected = selectedIds.size > 0 && !allSelectableSelected;

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelectedIds((prev) => {
      if (prev.size === selectableUsers.length && selectableUsers.length > 0) return new Set();
      return new Set(selectableUsers.map((u) => u.id));
    });
  };

  const bulkTargets: BulkPolicyTarget[] = useMemo(
    () =>
      selectableUsers
        .filter((u) => selectedIds.has(u.id))
        .map((u) => ({ id: u.id, name: u.name ?? "", email: u.email })),
    [selectableUsers, selectedIds],
  );

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

      {isAdmin && selectedIds.size > 0 && (
        <Card
          className="border-primary/40 bg-primary/5 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
          data-testid="bulk-action-bar"
        >
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium text-foreground">
              {selectedIds.size} user{selectedIds.size === 1 ? "" : "s"} selected
            </span>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              data-testid="button-bulk-clear"
            >
              <X className="w-3 h-3" /> Clear selection
            </button>
          </div>
          <Button
            onClick={() => setBulkOpen(true)}
            className="gap-2"
            data-testid="button-bulk-sign-in-restrictions"
          >
            <Lock className="w-4 h-4" />
            Apply sign-in restrictions
          </Button>
        </Card>
      )}

      <Card className="border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary/30 text-muted-foreground uppercase text-xs font-semibold">
              <tr>
                {isAdmin && (
                  <th className="px-4 py-4 w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all users"
                      checked={allSelectableSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={toggleAll}
                      disabled={selectableUsers.length === 0}
                      className="h-4 w-4 accent-primary cursor-pointer disabled:cursor-not-allowed"
                      data-testid="checkbox-select-all-users"
                    />
                  </th>
                )}
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
                  {isAdmin && (
                    <td className="px-4 py-4 w-10">
                      {user.id !== session?.userId ? (
                        <input
                          type="checkbox"
                          aria-label={`Select ${user.name || user.email}`}
                          checked={selectedIds.has(user.id)}
                          onChange={() => toggleOne(user.id)}
                          className="h-4 w-4 accent-primary cursor-pointer"
                          data-testid={`checkbox-select-user-${user.id}`}
                        />
                      ) : (
                        <span className="inline-block w-4 h-4" aria-hidden="true" />
                      )}
                    </td>
                  )}
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

      {orgId && bulkOpen && bulkTargets.length > 0 && (
        <BulkSignInRestrictionsDialog
          orgId={orgId}
          targets={bulkTargets}
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          onApplied={() => {
            setSelectedIds(new Set());
            // Refresh the user list view so any downstream UI tied to the cache
            // (e.g. a future per-user "has override" badge) reflects updates.
            queryClient.invalidateQueries({ queryKey: getListUsersQueryKey(orgId!) });
          }}
        />
      )}
    </div>
  );
}

