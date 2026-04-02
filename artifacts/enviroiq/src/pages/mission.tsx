import { useState, useRef, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Sparkles, Copy, Download, RefreshCw, CheckCheck,
  Loader2, FileText, Megaphone, AlignLeft, Globe, Briefcase,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tone = "professional" | "ambitious" | "concise";

interface OrgSummary {
  totalCo2eKg?: number;
  vehicleCount?: number;
}

const TONES: { value: Tone; label: string; desc: string; Icon: React.ElementType }[] = [
  { value: "professional", label: "Professional", desc: "Tender submissions & board reports", Icon: Briefcase },
  { value: "ambitious",    label: "Ambitious",    desc: "Website & marketing copy",          Icon: Megaphone },
  { value: "concise",      label: "Concise",      desc: "Executive summaries (3–4 sentences)", Icon: AlignLeft },
];

const FOCUS_OPTIONS = [
  "Fleet decarbonisation",
  "Renewable energy transition",
  "Scope 1 & 2 measurement",
  "NZ net zero 2050 alignment",
  "Toitū CEMARS certification",
  "Supply chain transparency",
  "Community impact",
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function MissionStatement() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const { toast } = useToast();

  const [tone, setTone] = useState<Tone>("professional");
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [customContext, setCustomContext] = useState("");
  const [statement, setStatement] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch summary for display
  const { data: summary } = useQuery<OrgSummary>({
    queryKey: ["org-summary", orgId],
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/organisations/${orgId}/summary`, { credentials: "include" });
      if (!res.ok) return {};
      return res.json();
    },
  });

  const toggleFocus = (area: string) => {
    setFocusAreas(prev =>
      prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area]
    );
  };

  const generate = useCallback(async () => {
    if (!orgId || streaming) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatement("");
    setStreaming(true);

    try {
      const res = await fetch(`/api/organisations/${orgId}/mission/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tone, focusAreas, customContext: customContext || undefined }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error("Failed to start generation");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.error) {
              toast({ title: "Generation failed", description: payload.error, variant: "destructive" });
              break;
            }
            if (payload.content) {
              setStatement(prev => prev + payload.content);
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    } finally {
      setStreaming(false);
    }
  }, [orgId, tone, focusAreas, customContext, streaming, toast]);

  const copy = async () => {
    if (!statement) return;
    await navigator.clipboard.writeText(statement);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
    toast({ title: "Copied to clipboard" });
  };

  const downloadPdf = () => {
    if (!statement) return;
    const orgName = session?.organisationName ?? "Organisation";
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>ESG Mission Statement — ${orgName}</title>
<style>
  body { font-family: Georgia, serif; max-width: 700px; margin: 60px auto; color: #1a1a1a; line-height: 1.8; }
  h1 { font-size: 22px; margin-bottom: 4px; color: #0f4c2a; }
  .meta { font-size: 12px; color: #666; margin-bottom: 32px; }
  p { font-size: 15px; margin-bottom: 18px; text-align: justify; }
  .footer { margin-top: 48px; font-size: 11px; color: #999; border-top: 1px solid #ddd; padding-top: 12px; }
</style>
</head>
<body>
<h1>ESG Sustainability Mission Statement</h1>
<div class="meta">${orgName} &nbsp;·&nbsp; Generated ${new Date().toLocaleDateString("en-NZ", { year: "numeric", month: "long", day: "numeric" })}</div>
${statement.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, " ")}</p>`).join("\n")}
<div class="footer">
  Generated by EnviroIQ · Verified emissions data · NZ Ministry for the Environment methodology
</div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${orgName.replace(/\s+/g, "-")}-ESG-Mission-Statement.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Downloaded", description: "Open in your browser and print to PDF." });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            AI Mission Statement
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generate a data-grounded ESG sustainability mission statement using your verified emissions data.
          </p>
        </div>
        <div className="text-xs text-muted-foreground bg-secondary/30 rounded-lg px-3 py-1.5 shrink-0 text-right">
          <Globe className="w-3 h-3 inline mr-1" />
          For websites, tenders &amp; reports
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ── Left panel: options ─────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Tone selector */}
          <Card className="p-5 border-border/50 space-y-3">
            <Label className="text-sm font-semibold text-foreground">Tone</Label>
            <div className="space-y-2">
              {TONES.map(({ value, label, desc, Icon }) => (
                <button
                  key={value}
                  onClick={() => setTone(value)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                    tone === value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border/50 bg-secondary/10 hover:bg-secondary/20 text-muted-foreground"
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${tone === value ? "text-primary" : ""}`} />
                  <div>
                    <div className="text-xs font-semibold">{label}</div>
                    <div className="text-xs opacity-70">{desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </Card>

          {/* Focus areas */}
          <Card className="p-5 border-border/50 space-y-3">
            <Label className="text-sm font-semibold text-foreground">Focus areas <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <div className="flex flex-wrap gap-2">
              {FOCUS_OPTIONS.map(area => (
                <button
                  key={area}
                  onClick={() => toggleFocus(area)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                    focusAreas.includes(area)
                      ? "bg-primary/20 border-primary text-primary"
                      : "border-border/50 text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {area}
                </button>
              ))}
            </div>
          </Card>

          {/* Custom context */}
          <Card className="p-5 border-border/50 space-y-3">
            <Label htmlFor="customContext" className="text-sm font-semibold text-foreground">
              Additional context <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="customContext"
              placeholder="e.g. We have 3 electric vehicles and solar on our warehouse roof…"
              value={customContext}
              onChange={e => setCustomContext(e.target.value)}
              maxLength={500}
              className="text-sm"
            />
            <p className="text-xs text-muted-foreground">{customContext.length}/500 characters</p>
          </Card>

          {/* Data context pill */}
          {summary?.totalCo2eKg != null && (
            <div className="text-xs text-muted-foreground bg-secondary/20 rounded-lg p-3 space-y-1">
              <p className="font-semibold text-foreground mb-1">Data the AI will use:</p>
              <p>· {(summary.totalCo2eKg / 1000).toFixed(1)} t CO₂e total (last 12 months)</p>
              {summary.vehicleCount != null && <p>· {summary.vehicleCount} active fleet vehicles</p>}
            </div>
          )}

          <Button
            onClick={generate}
            disabled={streaming}
            className="w-full gap-2 font-semibold"
            size="lg"
          >
            {streaming
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
              : <><Sparkles className="w-4 h-4" /> {statement ? "Regenerate" : "Generate Statement"}</>
            }
          </Button>
        </div>

        {/* ── Right panel: output ─────────────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-4">
          <Card className="border-border/50 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border/50 bg-secondary/20">
              <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                Mission Statement
              </span>
              {statement && !streaming && (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={copy} className="h-7 gap-1.5 text-xs">
                    {copied ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={downloadPdf} className="h-7 gap-1.5 text-xs">
                    <Download className="w-3.5 h-3.5" />
                    Download
                  </Button>
                  <Button size="sm" variant="ghost" onClick={generate} className="h-7 gap-1.5 text-xs text-muted-foreground">
                    <RefreshCw className="w-3.5 h-3.5" />
                    Redo
                  </Button>
                </div>
              )}
            </div>

            {!statement && !streaming ? (
              <div className="flex flex-col items-center justify-center py-20 text-center px-6">
                <Sparkles className="w-10 h-10 text-muted-foreground/30 mb-4" />
                <p className="text-sm text-muted-foreground max-w-xs">
                  Select your tone, choose focus areas, then hit Generate. The AI uses your verified emissions data to craft a grounded statement — no greenwashing.
                </p>
              </div>
            ) : (
              <div className="p-5">
                <Textarea
                  value={statement}
                  onChange={e => setStatement(e.target.value)}
                  className={`min-h-[340px] text-sm leading-relaxed resize-y font-serif bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-0 ${streaming ? "animate-pulse" : ""}`}
                  placeholder="Your mission statement will appear here…"
                  readOnly={streaming}
                />
                {streaming && (
                  <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    AI is writing…
                  </div>
                )}
              </div>
            )}
          </Card>

          {statement && !streaming && (
            <Card className="p-4 border-border/50 bg-secondary/10">
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Tip:</span> You can edit the text directly in the box above before copying or downloading.
                The downloaded file is print-ready HTML — open in any browser and use <kbd className="bg-secondary px-1 rounded text-xs">Ctrl+P</kbd> / <kbd className="bg-secondary px-1 rounded text-xs">⌘+P</kbd> to save as PDF.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
