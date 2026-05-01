// Public, no-auth supplier audit form. Rendered at /audits/:auditId/:token.
// All data fetches go through the public API routes mounted at /api/public/audits/*.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, Lock, Save, Send, Upload, Trash2, Paperclip, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface Question {
  id: string; text: string; type: string; weight: number;
  evidenceRequired?: boolean; evidenceGivesBonus?: boolean; help?: string; unit?: string; required?: boolean;
}
interface Section { id: string; title: string; description: string; weight: number; questions: Question[]; }
interface TemplateSchema { intro: string; sections: Section[]; }
interface AuditPayload {
  audit: {
    id: string; status: string; recipientName?: string; recipientEmail: string;
    dueAt: string; submittedAt?: string; lockedAt?: string;
    responses: Record<string, string | number | boolean | null>;
    declarationName?: string; declarationRole?: string; declarationConfirmed: boolean;
  };
  organisation: { name: string; logoUrl?: string };
  supplier: { id: string; legalName: string; tradingName?: string };
  template: { id: string; name: string; version: number; weights: { environmental: number; social: number; governance: number; supplyChain: number }; schema: TemplateSchema; customised?: boolean; totalQuestions?: number; effectiveQuestions?: number; disabledCount?: number };
  files: Array<{ id: string; questionId?: string; filename: string; sizeBytes: number; mimeType?: string }>;
}

async function pubFetch(url: string, init?: RequestInit) {
  const res = await fetch(`/api${url}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export default function PublicAuditPage() {
  const [, params] = useRoute("/audits/:auditId/:token");
  const auditId = params?.auditId;
  const token = params?.token;
  const [, navigate] = useLocation();

  const [data, setData] = useState<AuditPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, string | number | boolean | null>>({});
  const [declaration, setDeclaration] = useState({ name: "", role: "", confirmed: false });
  const [perf, setPerf] = useState({ topRisk: "", supportNeeded: "", willingAlign: "" });
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [files, setFiles] = useState<AuditPayload["files"]>([]);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!auditId || !token) return;
    setLoading(true);
    pubFetch(`/public/audits/${auditId}/${token}`)
      .then((d: AuditPayload) => {
        setData(d);
        setResponses(d.audit.responses || {});
        setDeclaration({ name: d.audit.declarationName || "", role: d.audit.declarationRole || "", confirmed: d.audit.declarationConfirmed });
        setFiles(d.files);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [auditId, token]);

  const isLocked = !!data?.audit.lockedAt || data?.audit.status === "submitted" || data?.audit.status === "approved";

  const completion = useMemo(() => {
    if (!data) return 0;
    const all = data.template.schema.sections.flatMap((s) => s.questions);
    const answered = all.filter((q) => {
      const v = responses[q.id];
      if (q.type === "file") return files.some((f) => f.questionId === q.id);
      return v !== null && v !== undefined && v !== "";
    }).length;
    return Math.round((answered / Math.max(1, all.length)) * 100);
  }, [data, responses, files]);

  if (loading) return <Splash><Loader2 className="w-8 h-8 animate-spin text-primary" /></Splash>;
  if (error || !data) return <Splash><div className="text-center"><AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" /><p className="text-foreground font-medium">{error || "Link invalid"}</p><p className="text-sm text-muted-foreground mt-2">Please contact your audit sponsor for a fresh link.</p></div></Splash>;

  const setVal = (id: string, v: string | number | boolean | null) => setResponses((prev) => ({ ...prev, [id]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await pubFetch(`/public/audits/${auditId}/${token}/save`, {
        method: "POST",
        body: JSON.stringify({
          responses,
          declarationName: declaration.name,
          declarationRole: declaration.role,
          topRiskAnswer: perf.topRisk,
          supportNeededAnswer: perf.supportNeeded,
          willingToAlignAnswer: perf.willingAlign,
        }),
      });
      toast.success("Draft saved");
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const submit = async () => {
    if (!declaration.confirmed || !declaration.name.trim() || !declaration.role.trim()) {
      toast.error("Please complete and confirm the declaration before submitting"); return;
    }
    if (!confirm("Once submitted the audit is locked and cannot be edited. Continue?")) return;
    setSubmitting(true);
    try {
      const result = await pubFetch(`/public/audits/${auditId}/${token}/submit`, {
        method: "POST",
        body: JSON.stringify({
          responses,
          declarationConfirmed: true,
          declarationName: declaration.name,
          declarationRole: declaration.role,
          topRiskAnswer: perf.topRisk,
          supportNeededAnswer: perf.supportNeeded,
          willingToAlignAnswer: perf.willingAlign,
        }),
      });
      toast.success(`Submitted — ESG score ${result.esgScore} (${result.riskLevel} risk)`);
      // Re-fetch so we land on the locked screen with persisted data.
      const fresh = await pubFetch(`/public/audits/${auditId}/${token}`);
      setData(fresh);
    } catch (e) { toast.error((e as Error).message); }
    finally { setSubmitting(false); }
  };

  const uploadFile = async (questionId: string, file: File) => {
    if (file.size > 5 * 1024 * 1024) { toast.error("File too large (max 5 MB)"); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const result = String(reader.result || "");
      const base64 = result.split(",")[1] ?? "";
      try {
        const created = await pubFetch(`/public/audits/${auditId}/${token}/file`, {
          method: "POST",
          body: JSON.stringify({ questionId, filename: file.name, mimeType: file.type, contentBase64: base64 }),
        });
        setFiles((prev) => [...prev, { ...created, questionId }]);
        toast.success("Evidence attached");
      } catch (e) { toast.error((e as Error).message); }
    };
    reader.readAsDataURL(file);
  };

  const removeFile = async (fileId: string) => {
    try {
      await fetch(`/api/public/audits/${auditId}/${token}/file/${fileId}`, { method: "DELETE" });
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    } catch { toast.error("Could not remove file"); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30">
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-7 w-7 text-primary" />
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{data.organisation.name}</div>
              <div className="font-semibold text-foreground leading-tight">Supplier ESG Audit</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Due {new Date(data.audit.dueAt).toLocaleDateString("en-NZ")}</div>
            {isLocked
              ? <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 mt-1"><Lock className="h-3 w-3 mr-1" />Locked</Badge>
              : <Badge variant="outline" className="mt-1">{completion}% complete</Badge>}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {isLocked ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center space-y-2">
            <ShieldCheck className="h-10 w-10 text-emerald-500 mx-auto" />
            <h2 className="text-xl font-bold">Audit submitted &amp; locked</h2>
            <p className="text-muted-foreground text-sm">
              Submitted on {data.audit.submittedAt ? new Date(data.audit.submittedAt).toLocaleString("en-NZ") : "—"} by {data.audit.declarationName}.
            </p>
            <p className="text-muted-foreground text-sm">A copy of your responses has been recorded with {data.organisation.name}.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-6 space-y-2">
            <h1 className="text-2xl font-bold">Hi {data.audit.recipientName || data.supplier.legalName} 👋</h1>
            <p className="text-muted-foreground">{data.template.schema.intro}</p>
            {data.template.customised && (
              <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground space-y-1">
                <p>
                  <span className="font-medium">{data.organisation.name}</span> has tailored this audit for you.
                  You're seeing <span className="font-medium">{data.template.effectiveQuestions ?? data.template.schema.sections.reduce((n, s) => n + s.questions.length, 0)}</span>
                  {" "}of {data.template.totalQuestions ?? "—"} questions
                  {typeof data.template.disabledCount === "number" && data.template.disabledCount > 0
                    ? ` (${data.template.disabledCount} turned off as not applicable)`
                    : ""}.
                </p>
                <p className="text-xs text-muted-foreground">
                  Your final score is normalised across the questions you do answer, so disabled questions don't count against you.
                </p>
              </div>
            )}
          </div>
        )}

        {data.template.schema.sections.map((sec) => (
          <section key={sec.id} className="rounded-xl border border-border bg-card overflow-hidden">
            <header className="px-6 py-4 border-b border-border bg-muted/40">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">{sec.title}</h2>
                  <p className="text-sm text-muted-foreground">{sec.description}</p>
                </div>
                {sec.weight > 0 && <Badge variant="outline">Weight {sec.weight}%</Badge>}
              </div>
            </header>
            <div className="px-6 py-4 space-y-5">
              {sec.questions.map((q) => (
                <QuestionField
                  key={q.id} q={q}
                  value={responses[q.id]}
                  onChange={(v) => setVal(q.id, v)}
                  files={files.filter((f) => f.questionId === q.id)}
                  onFileChoose={(f) => uploadFile(q.id, f)}
                  onFileRemove={removeFile}
                  fileInputRef={(el) => { fileInputs.current[q.id] = el; }}
                  disabled={isLocked}
                />
              ))}
            </div>
          </section>
        ))}

        <section className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h2 className="text-lg font-bold">Declaration</h2>
          <p className="text-sm text-muted-foreground">
            By submitting, you confirm that the responses are accurate to the best of your knowledge.
            The audit will be locked and timestamped for record-keeping.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Full name *</Label><Input value={declaration.name} onChange={(e) => setDeclaration((d) => ({ ...d, name: e.target.value }))} disabled={isLocked} data-testid="input-declaration-name" /></div>
            <div><Label>Role / title *</Label><Input value={declaration.role} onChange={(e) => setDeclaration((d) => ({ ...d, role: e.target.value }))} disabled={isLocked} data-testid="input-declaration-role" /></div>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={declaration.confirmed} onChange={(e) => setDeclaration((d) => ({ ...d, confirmed: e.target.checked }))} disabled={isLocked} data-testid="checkbox-declaration" />
            <span>I confirm that the information above is accurate and that I am authorised to submit this audit on behalf of the supplier.</span>
          </label>
        </section>

        {!isLocked && (
          <div className="flex items-center justify-end gap-2 sticky bottom-4 bg-background/80 backdrop-blur border border-border rounded-xl p-3">
            <span className="text-xs text-muted-foreground mr-auto">Progress: {completion}%</span>
            <Button variant="outline" onClick={save} disabled={saving} data-testid="button-save-draft">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save draft
            </Button>
            <Button onClick={submit} disabled={submitting} data-testid="button-submit-audit">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Submit &amp; lock
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}

function QuestionField({ q, value, onChange, files, onFileChoose, onFileRemove, fileInputRef, disabled }: {
  q: Question;
  value: string | number | boolean | null | undefined;
  onChange: (v: string | number | boolean | null) => void;
  files: Array<{ id: string; filename: string; sizeBytes: number }>;
  onFileChoose: (f: File) => void;
  onFileRemove: (id: string) => void;
  fileInputRef: (el: HTMLInputElement | null) => void;
  disabled: boolean;
}) {
  const labelEl = (
    <Label className="block">
      <span className="font-medium text-foreground text-sm">{q.text}</span>
      {q.evidenceRequired && <span className="ml-2 text-xs text-rose-600">Evidence required</span>}
      {q.evidenceGivesBonus && !q.evidenceRequired && <span className="ml-2 text-xs text-amber-600">Evidence boosts score</span>}
      {q.help && <span className="block text-xs text-muted-foreground mt-0.5">{q.help}</span>}
    </Label>
  );
  const showFileSlot = q.type === "file" || q.evidenceRequired || q.evidenceGivesBonus;

  let input: React.ReactNode = null;
  if (q.type === "yesno" || q.type === "yesno_evidence") {
    input = (
      <div className="flex gap-2">
        <Button type="button" variant={value === true || value === "yes" ? "default" : "outline"} size="sm" onClick={() => onChange(true)} disabled={disabled} data-testid={`q-${q.id}-yes`}>Yes</Button>
        <Button type="button" variant={value === false || value === "no" ? "default" : "outline"} size="sm" onClick={() => onChange(false)} disabled={disabled} data-testid={`q-${q.id}-no`}>No</Button>
      </div>
    );
  } else if (q.type === "number") {
    input = (
      <div className="flex items-center gap-2">
        <Input type="number" value={value === null || value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} disabled={disabled} className="max-w-xs" data-testid={`q-${q.id}-num`} />
        {q.unit && <span className="text-sm text-muted-foreground">{q.unit}</span>}
      </div>
    );
  } else if (q.type === "scale") {
    input = (
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <Button key={n} type="button" variant={Number(value) === n ? "default" : "outline"} size="sm" onClick={() => onChange(n)} disabled={disabled}>{n}</Button>
        ))}
      </div>
    );
  } else if (q.type === "longtext") {
    input = <Textarea rows={3} value={(value as string) || ""} onChange={(e) => onChange(e.target.value)} disabled={disabled} data-testid={`q-${q.id}-text`} />;
  } else if (q.type === "file") {
    input = null;
  } else {
    input = <Input value={(value as string) || ""} onChange={(e) => onChange(e.target.value)} disabled={disabled} data-testid={`q-${q.id}-text`} />;
  }

  return (
    <div className="space-y-2 pb-4 border-b border-border last:border-b-0 last:pb-0">
      {labelEl}
      {input}
      {showFileSlot && (
        <div>
          <input type="file" className="hidden" ref={fileInputRef} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileChoose(f); e.target.value = ""; }} disabled={disabled} />
          <div className="flex flex-wrap gap-2 items-center mt-1">
            <Button type="button" size="sm" variant="outline" onClick={(e) => (e.currentTarget.previousElementSibling as HTMLInputElement)?.click()} disabled={disabled}>
              <Upload className="h-3.5 w-3.5 mr-1.5" /> Attach evidence
            </Button>
            {files.map((f) => (
              <Badge key={f.id} variant="outline" className="gap-1 pl-2 pr-1 py-1">
                <Paperclip className="h-3 w-3" />
                <span className="text-xs">{f.filename}</span>
                {!disabled && (
                  <button type="button" onClick={() => onFileRemove(f.id)} className="ml-1 text-muted-foreground hover:text-rose-600">
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Splash({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center bg-background px-6">{children}</div>;
}
