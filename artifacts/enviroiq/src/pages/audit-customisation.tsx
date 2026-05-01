// Org-level supplier audit customisation. Lets an org admin turn each
// question off across the whole organisation, with a confirm modal that
// surfaces the rationale ("why this matters") and demands a reason which is
// captured in the audit log.
//
// Per-supplier exceptions are managed inline on the supplier detail dialog
// (suppliers.tsx → SupplierDetail).

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiClient } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, History, Info, Loader2, ShieldCheck } from "lucide-react";
import { Link } from "wouter";

interface TemplateQuestion {
  id: string; text: string; type: string; weight: number; rationale: string;
  evidenceRequired?: boolean; evidenceGivesBonus?: boolean;
}
interface TemplateSection {
  id: string; title: string; description: string; weight: number;
  questions: TemplateQuestion[];
}
interface Template {
  id: string; name: string; description: string;
  weightEnvironmental: number; weightSocial: number; weightGovernance: number; weightSupplyChain: number;
  schema: { intro: string; sections: TemplateSection[] };
}

interface OverrideRow {
  id: string; questionId: string; supplierId: string | null;
  enabled: boolean; reason: string; rationaleSnapshot: string;
  createdByEmail: string | null; updatedAt: string;
}

export default function AuditCustomisationPage() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const isAdmin = session?.role === "org_admin" || session?.role === "super_admin";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: templates } = useQuery({
    queryKey: ["supplier-audit-templates", orgId],
    queryFn: () => apiClient<Array<{ id: string; isDefault: boolean }>>(
      `/organisations/${orgId}/supplier-audit-templates`,
    ),
    enabled: !!orgId,
  });
  const defaultId = templates?.find((t) => t.isDefault)?.id;

  const { data: template, isLoading: tplLoading } = useQuery({
    queryKey: ["supplier-audit-template", orgId, defaultId],
    queryFn: () => apiClient<Template>(`/organisations/${orgId}/supplier-audit-templates/${defaultId}`),
    enabled: !!orgId && !!defaultId,
  });

  const { data: overrideData, isLoading: ovLoading } = useQuery({
    queryKey: ["audit-overrides", orgId, defaultId],
    queryFn: () => apiClient<{ overrides: OverrideRow[] }>(
      `/organisations/${orgId}/audit-overrides?templateId=${defaultId}`,
    ),
    enabled: !!orgId && !!defaultId,
  });

  // Org-level overrides only (supplierId === null)
  const orgOverrideByQ = useMemo(() => {
    const m = new Map<string, OverrideRow>();
    for (const o of overrideData?.overrides ?? []) if (o.supplierId === null) m.set(o.questionId, o);
    return m;
  }, [overrideData]);

  const upsert = useMutation({
    mutationFn: async (vars: { questionId: string; enabled: boolean; reason: string }) => {
      return apiClient(`/organisations/${orgId}/audit-overrides`, {
        method: "PUT",
        body: { templateId: defaultId, questionId: vars.questionId, supplierId: null, enabled: vars.enabled, reason: vars.reason },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audit-overrides", orgId, defaultId] });
      toast({ title: "Audit updated", description: "Change recorded in the audit log." });
    },
    onError: (e: unknown) => toast({ variant: "destructive", title: "Could not save", description: e instanceof Error ? e.message : "Try again" }),
  });

  const removeOverride = useMutation({
    mutationFn: async (questionId: string) => {
      return apiClient(`/organisations/${orgId}/audit-overrides/${encodeURIComponent(questionId)}?templateId=${defaultId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audit-overrides", orgId, defaultId] });
      toast({ title: "Reset to default", description: "Question is on for everyone again." });
    },
  });

  // Confirm-disable modal
  const [confirmFor, setConfirmFor] = useState<{ section: TemplateSection; q: TemplateQuestion } | null>(null);
  const [reason, setReason] = useState("");

  const onToggle = (section: TemplateSection, q: TemplateQuestion, nextEnabled: boolean) => {
    if (!isAdmin) return;
    if (!nextEnabled) {
      // Disabling — gather reason via modal
      setConfirmFor({ section, q });
      setReason("");
      return;
    }
    // Re-enabling: if there was an override, just delete it (revert to default-on)
    if (orgOverrideByQ.has(q.id)) {
      removeOverride.mutate(q.id);
    }
  };

  const submitDisable = () => {
    if (!confirmFor) return;
    if (reason.trim().length < 10) {
      toast({ variant: "destructive", title: "Reason required", description: "Tell future-you why this question is off (min 10 chars)." });
      return;
    }
    upsert.mutate(
      { questionId: confirmFor.q.id, enabled: false, reason: reason.trim() },
      { onSuccess: () => setConfirmFor(null) },
    );
  };

  if (!orgId) return null;
  if (tplLoading || ovLoading || !template) {
    return <div className="p-8 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const totalQuestions = template.schema.sections.reduce((n, s) => n + s.questions.length, 0);
  const disabledCount = Array.from(orgOverrideByQ.values()).filter((o) => !o.enabled).length;

  return (
    <div className="space-y-8 pb-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Audit customisation</h1>
          <p className="text-muted-foreground mt-1">
            Right-size your supplier audit. Turn off questions that don't apply org-wide; per-supplier exceptions live on each supplier's detail card.
          </p>
        </div>
        <Link href="/audit?action=supplier_audit_question_override">
          <Button variant="outline" size="sm" className="shrink-0 mt-1">
            <History className="h-3.5 w-3.5 mr-1.5" /> View change history
          </Button>
        </Link>
      </div>

      <Card className="p-4 border-primary/30 bg-primary/5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{disabledCount} of {totalQuestions} questions disabled org-wide.</span>{" "}
            Section weights are renormalised when a section is fully empty so scores stay comparable. Audits already in flight are unaffected — each audit is locked to the question set in force at send time.
          </div>
        </div>
      </Card>

      {!isAdmin && (
        <Card className="p-4 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
            <div className="text-sm text-muted-foreground">Only org admins can change the audit. You're in read-only mode.</div>
          </div>
        </Card>
      )}

      {template.schema.sections.map((sec) => {
        const sectionDisabled = sec.questions.every((q) => orgOverrideByQ.get(q.id)?.enabled === false);
        return (
          <Card key={sec.id} className="overflow-hidden border-border/50">
            <div className="p-5 border-b border-border/50 bg-secondary/20 flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold text-base text-foreground">{sec.title}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{sec.description}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className="text-xs">{sec.weight === 0 ? "Insight (not scored)" : `weight ${sec.weight}`}</Badge>
                {sectionDisabled && <Badge variant="destructive" className="text-xs">Section empty</Badge>}
              </div>
            </div>
            <div className="divide-y divide-border/50">
              {sec.questions.map((q) => {
                const ov = orgOverrideByQ.get(q.id);
                const enabled = ov ? ov.enabled : true;
                return (
                  <div key={q.id} className="p-5 flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2 flex-wrap">
                        <span className="font-medium text-sm text-foreground">{q.text}</span>
                        <Badge variant="outline" className="text-[10px] shrink-0">{q.type}</Badge>
                        {q.evidenceRequired && <Badge variant="outline" className="text-[10px] shrink-0">evidence required</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                        <span className="font-medium text-foreground/80">Why this matters: </span>{q.rationale}
                      </p>
                      {ov && !ov.enabled && (
                        <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
                          <div className="text-amber-300 font-medium flex items-center gap-1.5">
                            <AlertTriangle className="h-3 w-3" /> Disabled org-wide
                          </div>
                          <div className="text-muted-foreground mt-1">{ov.reason}</div>
                          <div className="text-muted-foreground/70 mt-0.5 text-[10px]">By {ov.createdByEmail || "system"} · {new Date(ov.updatedAt).toLocaleString()}</div>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Switch
                        checked={enabled}
                        disabled={!isAdmin || upsert.isPending || removeOverride.isPending}
                        onCheckedChange={(v) => onToggle(sec, q, v)}
                        data-testid={`q-toggle-${q.id}`}
                      />
                      <span className="text-[10px] text-muted-foreground">{enabled ? "On" : "Off"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}

      <Dialog open={!!confirmFor} onOpenChange={(o) => { if (!o) setConfirmFor(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Disable this question?</DialogTitle>
            <DialogDescription>{confirmFor?.q.text}</DialogDescription>
          </DialogHeader>
          {confirmFor && (
            <div className="space-y-4">
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                <div className="font-medium text-foreground mb-1">Why we ask this</div>
                <p className="text-muted-foreground text-xs leading-relaxed">{confirmFor.q.rationale}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Your reason (recorded in the audit log)</Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="E.g. Our suppliers are NZ-only, conflict-mineral risk does not apply."
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmFor(null)}>Cancel</Button>
            <Button onClick={submitDisable} disabled={upsert.isPending}>
              {upsert.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Disable question
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
