import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useGetEnergyEmailAddress, useGetWidgetConfig } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Mail, Copy, Check, Webhook, RefreshCw, Code, Loader2,
  KeyRound, Eye, EyeOff, ExternalLink, Shield, AlertCircle, History,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { format } from "date-fns";

type SignInMethod = "magic_link" | "passkey" | "google_sso" | "microsoft_sso";
type RequiredProvider = "google" | "microsoft" | null;

interface SsoPolicy {
  googleSsoEnabled: boolean;
  microsoftSsoEnabled: boolean;
  allowedSignInMethods: SignInMethod[];
  requiredSsoProvider: RequiredProvider;
}

interface SsoPolicyHistoryEntry {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorType: string | null;
  previousValue: Partial<SsoPolicy> | null;
  newValue: Partial<SsoPolicy> | null;
}

const METHOD_LABELS: Record<SignInMethod, string> = {
  magic_link: "Email magic link",
  passkey: "Passkey",
  google_sso: "Google SSO",
  microsoft_sso: "Microsoft SSO",
};

function describeRequired(v: RequiredProvider | undefined): string {
  if (v === undefined || v === null) return "no requirement";
  if (v === "google") return "Google";
  if (v === "microsoft") return "Microsoft";
  return String(v);
}

function describeAllowed(v: SignInMethod[] | null | undefined): string {
  if (v === undefined || v === null) return "(unset)";
  if (v.length === 0) return "(none)";
  return v.map((m) => METHOD_LABELS[m] ?? m).join(", ");
}

function describeBool(label: string, v: boolean | undefined): string {
  return `${label} ${v ? "on" : "off"}`;
}

function diffSsoPolicy(entry: SsoPolicyHistoryEntry): string[] {
  const lines: string[] = [];
  const prev = entry.previousValue ?? {};
  const next = entry.newValue ?? {};

  if ((prev.googleSsoEnabled ?? null) !== (next.googleSsoEnabled ?? null)) {
    lines.push(
      `Google SSO: ${describeBool("Google", prev.googleSsoEnabled)} → ${describeBool("Google", next.googleSsoEnabled)}`,
    );
  }
  if ((prev.microsoftSsoEnabled ?? null) !== (next.microsoftSsoEnabled ?? null)) {
    lines.push(
      `Microsoft SSO: ${describeBool("Microsoft", prev.microsoftSsoEnabled)} → ${describeBool("Microsoft", next.microsoftSsoEnabled)}`,
    );
  }
  const prevReq = prev.requiredSsoProvider ?? null;
  const nextReq = next.requiredSsoProvider ?? null;
  if (prevReq !== nextReq) {
    lines.push(`Required provider: ${describeRequired(prevReq)} → ${describeRequired(nextReq)}`);
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
    lines.push(`Allowed methods: ${describeAllowed(prevAllowed)} → ${describeAllowed(nextAllowed)}`);
  }
  if (lines.length === 0) lines.push("No effective change");
  return lines;
}

function describeSsoActor(entry: SsoPolicyHistoryEntry): string {
  if (entry.actorEmail) return entry.actorEmail;
  if (entry.actorType === "system") return "System";
  if (entry.actorType === "scheduler") return "Scheduler";
  if (entry.actorType === "api_key") return "API key";
  if (entry.actorType === "webhook") return "Webhook";
  if (entry.actorUserId) return `User ${entry.actorUserId}`;
  return "Unknown";
}

function SsoPolicyCard({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<SsoPolicy>({
    queryKey: ["ssoPolicy", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/organisations/${orgId}/sso-policy`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load SSO policy");
      return res.json();
    },
    enabled: isAdmin,
  });

  const historyQuery = useQuery<{ items: SsoPolicyHistoryEntry[] }>({
    queryKey: ["ssoPolicyHistory", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/organisations/${orgId}/sso-policy/history`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load SSO policy history");
      return res.json();
    },
    enabled: isAdmin,
  });

  const [draft, setDraft] = useState<SsoPolicy | null>(null);
  useEffect(() => {
    if (data && !draft) setDraft(data);
  }, [data, draft]);

  const mutate = useMutation({
    mutationFn: async (next: SsoPolicy) => {
      const res = await fetch(`/api/organisations/${orgId}/sso-policy`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || "Failed to save SSO policy");
      }
      return res.json() as Promise<SsoPolicy>;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(["ssoPolicy", orgId], next);
      setDraft(next);
      // Refresh the timeline so the change just made shows up immediately.
      queryClient.invalidateQueries({ queryKey: ["ssoPolicyHistory", orgId] });
      toast({ title: "Sign-in & SSO policy updated" });
    },
    onError: (e: unknown) => {
      toast({
        variant: "destructive",
        title: "Could not save",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    },
  });

  if (!isAdmin) return null;

  if (isLoading || !draft) {
    return (
      <Card className="overflow-hidden border-border/50">
        <div className="p-6 border-b border-border/50 bg-secondary/20 flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-xl"><Shield className="w-5 h-5 text-primary" /></div>
          <div>
            <h2 className="font-semibold text-base">Sign-in & SSO</h2>
            <p className="text-xs text-muted-foreground">Loading…</p>
          </div>
        </div>
        <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading sign-in policy…
        </div>
      </Card>
    );
  }

  const toggleMethod = (m: SignInMethod) => {
    setDraft((d) => {
      if (!d) return d;
      const has = d.allowedSignInMethods.includes(m);
      const next = has ? d.allowedSignInMethods.filter((x) => x !== m) : [...d.allowedSignInMethods, m];
      return { ...d, allowedSignInMethods: next };
    });
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(data);
  const validationError = draft.allowedSignInMethods.length === 0
    ? "At least one sign-in method must remain enabled."
    : null;

  const onSave = () => {
    if (!draft || validationError) return;
    mutate.mutate(draft);
  };

  const onReset = () => {
    if (data) setDraft(data);
  };

  return (
    <Card className="overflow-hidden border-border/50">
      <div className="p-6 border-b border-border/50 bg-secondary/20 flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-xl"><Shield className="w-5 h-5 text-primary" /></div>
        <div>
          <h2 className="font-semibold text-base">Sign-in & SSO</h2>
          <p className="text-xs text-muted-foreground">Choose how your team signs in to EnviroIQ</p>
        </div>
      </div>
      <div className="p-6 space-y-6">
        {/* Per-provider toggles */}
        <div className="space-y-3">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Allowed providers</label>
          <label className="flex items-center justify-between gap-3 px-4 py-3 rounded-md border border-border bg-background">
            <div>
              <div className="text-sm font-medium text-foreground">Allow Google sign-in for this organisation</div>
              <div className="text-xs text-muted-foreground">Anyone with a verified Gmail or Google Workspace account</div>
            </div>
            <input
              type="checkbox"
              checked={draft.googleSsoEnabled}
              onChange={(e) => setDraft({ ...draft, googleSsoEnabled: e.target.checked })}
              className="h-4 w-4 accent-primary"
              data-testid="checkbox-google-sso-enabled"
            />
          </label>
          <label className="flex items-center justify-between gap-3 px-4 py-3 rounded-md border border-border bg-background">
            <div>
              <div className="text-sm font-medium text-foreground">Allow Microsoft sign-in for this organisation</div>
              <div className="text-xs text-muted-foreground">Microsoft 365 / Entra ID and personal Microsoft accounts</div>
            </div>
            <input
              type="checkbox"
              checked={draft.microsoftSsoEnabled}
              onChange={(e) => setDraft({ ...draft, microsoftSsoEnabled: e.target.checked })}
              className="h-4 w-4 accent-primary"
              data-testid="checkbox-microsoft-sso-enabled"
            />
          </label>
        </div>

        {/* Allowed methods */}
        <div className="space-y-3">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sign-in methods allowed for this organisation</label>
          <div className="grid sm:grid-cols-2 gap-2">
            {(Object.keys(METHOD_LABELS) as SignInMethod[]).map((m) => (
              <label
                key={m}
                className="flex items-center gap-3 px-4 py-3 rounded-md border border-border bg-background cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={draft.allowedSignInMethods.includes(m)}
                  onChange={() => toggleMethod(m)}
                  className="h-4 w-4 accent-primary"
                  data-testid={`checkbox-method-${m}`}
                />
                <span className="text-sm text-foreground">{METHOD_LABELS[m]}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Org admins always retain a magic-link break-glass path even if magic-link is disabled here.
          </p>
        </div>

        {/* Required SSO provider */}
        <div className="space-y-3">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Required SSO provider (optional)</label>
          <select
            value={draft.requiredSsoProvider ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                requiredSsoProvider: (e.target.value || null) as "google" | "microsoft" | null,
              })
            }
            className="w-full h-11 px-3 rounded-md bg-input border border-border focus:border-primary focus:ring-1 focus:ring-primary outline-none text-foreground text-sm"
            data-testid="select-required-sso-provider"
          >
            <option value="">— None —</option>
            <option value="google">Google only</option>
            <option value="microsoft">Microsoft only</option>
          </select>
          <p className="text-xs text-muted-foreground">
            When set, ordinary users may only sign in via the chosen provider. Admins retain magic-link break-glass.
          </p>
        </div>

        {validationError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 flex gap-2 items-start">
            <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-sm text-destructive-foreground">{validationError}</p>
          </div>
        )}

        {/* Change history — answers "why is everyone suddenly restricted?"
            without forcing the admin to leave Settings for the audit log. */}
        <div className="space-y-2 pt-4 border-t border-border" data-testid="sso-policy-history">
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
              No org-wide sign-in policy changes recorded yet.
            </p>
          ) : (
            <ul className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {historyQuery.data!.items.map((entry) => {
                const lines = diffSsoPolicy(entry);
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
                    data-testid={`sso-policy-history-entry-${entry.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground truncate">
                        {describeSsoActor(entry)}
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
          <Button variant="outline" disabled={!dirty || mutate.isPending} onClick={onReset}>
            Reset
          </Button>
          <Button
            onClick={onSave}
            disabled={!dirty || !!validationError || mutate.isPending}
            data-testid="button-save-sso-policy"
          >
            {mutate.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Save changes
          </Button>
        </div>
      </div>
    </Card>
  );
}

function CopyField({ value, label, mono = true }: { value: string; label: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: `${label} copied!` });
  };

  return (
    <div className="flex items-center gap-2">
      <div className={`flex-1 bg-background border border-border rounded-lg px-4 py-3 text-sm text-foreground overflow-hidden text-ellipsis whitespace-nowrap ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
      <Button variant="outline" size="icon" onClick={copy} className="shrink-0 h-[46px] w-[46px]" title={`Copy ${label}`}>
        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
      </Button>
    </div>
  );
}

export default function Settings() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showSecret, setShowSecret] = useState(false);

  const { data: emailInfo, isLoading: loadingEmail } = useGetEnergyEmailAddress(orgId!, {
    query: { enabled: !!orgId },
  });

  const { data: webhookCreds, isLoading: loadingWebhook } = useQuery({
    queryKey: ["webhookCredentials", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/organisations/${orgId}/webhook-credentials`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load webhook credentials");
      return res.json() as Promise<{ webhookSecret: string; fleetWebhookUrl: string; energyWebhookUrl: string }>;
    },
    enabled: !!orgId,
  });

  const { data: widgetConfig, isLoading: loadingWidget } = useGetWidgetConfig(orgId!, {
    query: { enabled: !!orgId },
  });

  const rotateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/organisations/${orgId}/webhook-credentials/rotate`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to rotate secret");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhookCredentials", orgId] });
      toast({ title: "Webhook secret rotated", description: "Update all GPS/fleet integrations with the new secret." });
    },
    onError: (e: unknown) => {
      toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "Could not rotate secret" });
    },
  });

  // When deep-linked from the audit log's "Why?" shortcut for
  // sso.policy.changed (href="/settings#sso-policy-history"), scroll the
  // history block into view once it has rendered. We retry a few times
  // because the SsoPolicyCard only mounts when orgId/role are known.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#sso-policy-history") return;
    let cancelled = false;
    let attempts = 0;
    const tryScroll = () => {
      if (cancelled) return;
      const el = document.querySelector('[data-testid="sso-policy-history"]');
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (attempts++ < 20) setTimeout(tryScroll, 100);
    };
    tryScroll();
    return () => {
      cancelled = true;
    };
  }, []);

  const baseUrl = window.location.origin;
  const embedSnippet = widgetConfig?.widgetKey
    ? `<script src="${baseUrl}/api/widget/${widgetConfig.widgetKey}/widget.js" async></script>\n<div id="enviroiq-widget"></div>`
    : "";

  return (
    <div className="space-y-8 pb-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Integrations & Settings</h1>
        <p className="text-muted-foreground mt-1">Connect data sources and embed your public sustainability widget.</p>
      </div>

      {/* ── Sign-in & SSO ─────────────────────────────────────────────── */}
      {orgId && (session?.role === "org_admin" || session?.role === "super_admin") && (
        <SsoPolicyCard orgId={orgId} isAdmin />
      )}

      {/* ── Inbound Email ─────────────────────────────────────────────── */}
      <Card className="overflow-hidden border-border/50">
        <div className="p-6 border-b border-border/50 bg-secondary/20 flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-xl"><Mail className="w-5 h-5 text-primary" /></div>
          <div>
            <h2 className="font-semibold text-base">Energy Bill Email</h2>
            <p className="text-xs text-muted-foreground">Forward PDF bills here — EnviroIQ parses them automatically</p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Ask your accountant, energy retailer, or utility provider to forward PDF invoices to this address.
            EnviroIQ will automatically extract kWh usage, calculate CO₂e, and add the reading to your history.
          </p>
          {loadingEmail ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading address…
            </div>
          ) : emailInfo?.emailAddress ? (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Your unique inbound address</label>
              <CopyField value={emailInfo.emailAddress} label="Email address" />
            </div>
          ) : (
            <p className="text-sm text-destructive">Could not load email address.</p>
          )}
          <div className="rounded-xl bg-amber-950/20 border border-amber-800/30 px-4 py-3 text-xs text-amber-300">
            <strong>Tip:</strong> This address is unique to your organisation. Only PDF attachments are processed — the email body is ignored.
          </div>
        </div>
      </Card>

      {/* ── Webhook / API Credentials ─────────────────────────────────── */}
      <Card className="overflow-hidden border-border/50">
        <div className="p-6 border-b border-border/50 bg-secondary/20 flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-xl"><Webhook className="w-5 h-5 text-primary" /></div>
          <div>
            <h2 className="font-semibold text-base">GPS Fleet Webhooks</h2>
            <p className="text-xs text-muted-foreground">Navman, Blackhawk, or any generic GPS tracker</p>
          </div>
        </div>
        <div className="p-6 space-y-6">
          {loadingWebhook ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading credentials…
            </div>
          ) : webhookCreds ? (
            <>
              {/* Webhook URLs */}
              <div className="space-y-3">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Webhook Endpoints</label>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 font-mono">POST</span>
                    Navman GPS
                  </div>
                  <CopyField value={`${baseUrl}${webhookCreds.fleetWebhookUrl}/navman`} label="Navman webhook URL" />

                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-3">
                    <span className="px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 font-mono">POST</span>
                    Blackhawk GPS
                  </div>
                  <CopyField value={`${baseUrl}${webhookCreds.fleetWebhookUrl}/blackhawk`} label="Blackhawk webhook URL" />

                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-3">
                    <span className="px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 font-mono">POST</span>
                    Generic / Custom
                  </div>
                  <CopyField value={`${baseUrl}${webhookCreds.fleetWebhookUrl}/generic`} label="Generic webhook URL" />
                </div>
              </div>

              {/* Webhook Secret */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Webhook Secret (HMAC-SHA256)</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-background border border-border rounded-lg px-4 py-3 font-mono text-sm text-foreground overflow-hidden text-ellipsis whitespace-nowrap">
                    {showSecret ? webhookCreds.webhookSecret : "•".repeat(40)}
                  </div>
                  <Button variant="outline" size="icon" onClick={() => setShowSecret(s => !s)} className="shrink-0 h-[46px] w-[46px]" title={showSecret ? "Hide" : "Reveal"}>
                    {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                  {showSecret && (
                    <Button variant="outline" size="icon" onClick={() => {
                      navigator.clipboard.writeText(webhookCreds.webhookSecret);
                      toast({ title: "Secret copied!" });
                    }} className="shrink-0 h-[46px] w-[46px]" title="Copy secret">
                      <Copy className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    variant="outline" size="icon"
                    onClick={() => rotateMutation.mutate()}
                    disabled={rotateMutation.isPending}
                    className="shrink-0 h-[46px] w-[46px]"
                    title="Rotate secret (generates a new one)"
                  >
                    {rotateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Include this as <code className="bg-secondary px-1 rounded">X-Webhook-Secret</code> in your GPS device configuration.
                  Click the rotate button to generate a new secret — update all integrations immediately after.
                </p>
              </div>

              {/* API Key note */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Authentication Header</label>
                <div className="rounded-xl bg-secondary/30 border border-border/50 px-4 py-3 text-xs font-mono text-muted-foreground">
                  X-Webhook-Secret: {showSecret ? webhookCreds.webhookSecret : "your-webhook-secret"}
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-destructive">Could not load webhook credentials.</p>
          )}
        </div>
      </Card>

      {/* ── Public Widget ─────────────────────────────────────────────── */}
      <Card className="overflow-hidden border-border/50">
        <div className="p-6 border-b border-border/50 bg-secondary/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-xl"><Code className="w-5 h-5 text-primary" /></div>
            <div>
              <h2 className="font-semibold text-base">Public Sustainability Widget</h2>
              <p className="text-xs text-muted-foreground">Embed live CO₂e data on your website</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setLocation("/widget")} className="gap-1.5">
            <ExternalLink className="w-3.5 h-3.5" /> Widget Settings
          </Button>
        </div>
        <div className="p-6 space-y-4">
          {loadingWidget ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading widget…
            </div>
          ) : embedSnippet ? (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Embed snippet</label>
              <div className="relative">
                <pre className="bg-background border border-border rounded-lg p-4 text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all">
                  {embedSnippet}
                </pre>
                <Button
                  variant="outline" size="sm"
                  className="absolute top-2 right-2 h-7 gap-1.5"
                  onClick={() => {
                    navigator.clipboard.writeText(embedSnippet);
                    toast({ title: "Embed code copied!" });
                  }}
                >
                  <Copy className="w-3 h-3" /> Copy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Paste this anywhere in your website's HTML — the widget loads automatically.
                Configure what metrics are shown in <button className="underline hover:text-foreground" onClick={() => setLocation("/widget")}>Widget Settings</button>.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Widget key not yet generated. Open Widget Settings to configure.</p>
          )}
        </div>
      </Card>

      {/* ── Passkey / Account ─────────────────────────────────────────── */}
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => setLocation("/account")} className="gap-2">
          <KeyRound className="w-4 h-4" /> Manage Passkeys & Account
        </Button>
      </div>
    </div>
  );
}
