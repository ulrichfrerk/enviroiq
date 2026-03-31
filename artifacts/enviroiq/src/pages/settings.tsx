import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useGetEnergyEmailAddress, useGetWidgetConfig } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Mail, Copy, Check, Webhook, RefreshCw, Code, Loader2,
  KeyRound, Eye, EyeOff, ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

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
