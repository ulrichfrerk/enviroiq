import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useGetWidgetConfig, useUpdateWidgetConfig } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings, Copy, Check, Globe, BarChart3, Zap, Car, Target, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Widget() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const { data: config, isLoading, refetch } = useGetWidgetConfig(orgId!, { query: { enabled: !!orgId } });
  const updateConfig = useUpdateWidgetConfig();

  const handleToggle = async (field: string, value: boolean) => {
    if (!config) return;
    try {
      await updateConfig.mutateAsync({
        orgId: orgId!,
        data: { ...config, [field]: value },
      });
      toast({ title: "Widget settings updated" });
      refetch();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Could not update widget settings";
      toast({ variant: "destructive", title: "Error", description: message });
    }
  };

  const embedSnippet = config?.embedScript || (config?.widgetKey
    ? `<script src="${window.location.origin}/api/widget/${config.widgetKey}/widget.js" async></script>\n<div id="enviroiq-widget"></div>`
    : "");

  const copyEmbed = () => {
    navigator.clipboard.writeText(embedSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Embed code copied!" });
  };

  if (isLoading) {
    return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-8 pb-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Public Widget</h1>
        <p className="text-muted-foreground mt-1">
          Embed your sustainability metrics on your public website to showcase your ESG commitments.
        </p>
      </div>

      {/* Preview */}
      <Card className="p-6 bg-gradient-to-br from-secondary/30 to-background border-primary/20">
        <div className="flex items-center gap-2 mb-4">
          <Globe className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Widget Preview</span>
        </div>
        <div className="bg-background rounded-xl p-6 border border-border shadow-lg max-w-md">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-5 h-5 rounded bg-primary flex items-center justify-center">
              <span className="text-[10px] text-primary-foreground font-bold">E</span>
            </div>
            <span className="text-sm font-semibold text-foreground">{session?.organisationName}</span>
            <span className="text-xs text-muted-foreground ml-auto">Powered by EnviroIQ</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {config?.showTotalCo2e !== false && (
              <div className="bg-secondary/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><BarChart3 className="w-3 h-3" /> CO₂e Saved</p>
                <p className="text-2xl font-bold text-foreground">1.2t</p>
              </div>
            )}
            {config?.showEnergyUsage !== false && (
              <div className="bg-secondary/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Zap className="w-3 h-3" /> Energy kWh</p>
                <p className="text-2xl font-bold text-foreground">4.5k</p>
              </div>
            )}
            {config?.showFleetStats !== false && (
              <div className="bg-secondary/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Car className="w-3 h-3" /> Fleet km</p>
                <p className="text-2xl font-bold text-foreground">12.4k</p>
              </div>
            )}
            {config?.showGoals !== false && (
              <div className="bg-secondary/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Target className="w-3 h-3" /> Score</p>
                <p className="text-2xl font-bold text-emerald-400">85</p>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Toggle Metrics */}
      <Card className="p-6 border-border/50">
        <h3 className="font-semibold text-lg mb-5">Visible Metrics</h3>
        <div className="space-y-4">
          {[
            { field: "showTotalCo2e", label: "CO₂e Emissions", desc: "Total carbon footprint in kg/tonnes", icon: BarChart3 },
            { field: "showEnergyUsage", label: "Energy Consumption", desc: "Electricity and gas usage in kWh", icon: Zap },
            { field: "showFleetStats", label: "Fleet Activity", desc: "Distance travelled by fleet vehicles", icon: Car },
            { field: "showGoals", label: "Sustainability Score", desc: "Your overall ESG performance score", icon: Target },
          ].map(({ field, label, desc, icon: Icon }) => {
            const isOn = config?.[field as keyof typeof config] !== false;
            return (
              <div key={field} className="flex items-center justify-between py-3 border-b border-border/50 last:border-0">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-secondary/50 rounded-lg">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{label}</p>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleToggle(field, !isOn)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isOn ? "bg-primary" : "bg-secondary"}`}
                  disabled={updateConfig.isPending}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${isOn ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Embed Code */}
      <Card className="p-6 border-border/50">
        <div className="flex items-center gap-2 mb-2">
          <Settings className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-lg">Embed Code</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Paste this snippet into your website's HTML to embed the sustainability widget.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-secondary/50 border border-border rounded-lg px-4 py-3 text-xs font-mono text-foreground overflow-x-auto whitespace-nowrap">
            {embedSnippet}
          </code>
          <Button variant="outline" size="icon" onClick={copyEmbed} className="shrink-0 h-[46px] w-[46px]">
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          The widget is publicly accessible using your unique widget key. Data refreshes every 6 hours.
        </p>
      </Card>
    </div>
  );
}
