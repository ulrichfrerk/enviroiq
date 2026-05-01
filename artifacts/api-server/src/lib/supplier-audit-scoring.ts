// Pure scoring engine for the Supplier ESG Audit.
// Inputs: a parsed TemplateSchema + the supplier's responses + uploaded files.
// Output: ESG score (0-100), risk level, per-section breakdown, flag list.
//
// Scoring rules (per spec):
//   yes + evidence (where evidenceGivesBonus) → full points
//   yes without required evidence            → partial (0.5)
//   yes (no evidence requirement)            → full points
//   no                                        → 0
//   missing                                   → 0 (counts against you)
//   yesno_evidence + evidenceRequired + missing file → 0
//
// Risk: ≥80 low, 50–79 medium, <50 high.

import type { TemplateSchema, TemplateSection, TemplateQuestion } from "./supplier-audit-default-template.js";

export interface ScoreFlag {
  category: string;
  severity: "info" | "warn" | "critical";
  message: string;
}

export interface ScoreResult {
  esgScore: number;
  riskLevel: "low" | "medium" | "high";
  breakdown: Record<string, number>;
  flags: ScoreFlag[];
}

type ResponseValue = string | number | boolean | null;
export type Responses = Record<string, ResponseValue>;
export type FilePresence = Record<string, boolean>; // questionId -> has at least one file

function scoreQuestion(q: TemplateQuestion, raw: ResponseValue, hasFile: boolean): number {
  if (q.weight === 0) return 0; // not scored
  switch (q.type) {
    case "yesno": {
      if (raw === true || raw === "true" || raw === "yes") return 1;
      return 0;
    }
    case "yesno_evidence": {
      const isYes = raw === true || raw === "true" || raw === "yes";
      if (!isYes) return 0;
      if (q.evidenceRequired && !hasFile) return 0;
      if (q.evidenceGivesBonus && !hasFile) return 0.5;
      return 1;
    }
    case "file": {
      // Pure file upload — full points iff a file is attached.
      if (q.evidenceRequired && !hasFile) return 0;
      return hasFile ? 1 : 0;
    }
    case "scale": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) return 0;
      const bounded = Math.max(0, Math.min(5, n));
      return bounded / 5;
    }
    case "number":
    case "text":
    case "longtext":
    default:
      // Free-text / numeric questions don't carry score weight unless explicitly weighted.
      // Reward "answered" with full credit when weighted >0.
      if (raw === null || raw === undefined || raw === "" ) return 0;
      return 1;
  }
}

function scoreSection(
  section: TemplateSection,
  responses: Responses,
  files: FilePresence,
  flags: ScoreFlag[],
): number {
  const scored = section.questions.filter((q) => q.weight > 0);
  if (scored.length === 0) return 100;
  let totalWeight = 0;
  let earned = 0;
  for (const q of scored) {
    const raw = responses[q.id] ?? null;
    const hasFile = !!files[q.id];
    const ratio = scoreQuestion(q, raw, hasFile);
    earned += ratio * q.weight;
    totalWeight += q.weight;

    // Flag rules
    if (q.evidenceRequired && !hasFile) {
      flags.push({
        category: section.id,
        severity: "warn",
        message: `Missing required evidence for "${q.text}"`,
      });
    }
    if (q.id === "compliance.breaches" && (raw === true || raw === "true" || raw === "yes")) {
      flags.push({
        category: "governance",
        severity: "critical",
        message: "Supplier reports regulatory breaches in the last 3 years",
      });
    }
    if (q.id === "sc.highRisk" && (raw === true || raw === "true" || raw === "yes")) {
      flags.push({
        category: "supplyChain",
        severity: "warn",
        message: "Supplier sources from high-risk regions",
      });
    }
    if (q.id === "sc.conflict" && (raw === true || raw === "true" || raw === "yes")) {
      flags.push({
        category: "supplyChain",
        severity: "critical",
        message: "Supplier reports conflict minerals (3TG) in supply chain",
      });
    }
  }
  return totalWeight === 0 ? 100 : (earned / totalWeight) * 100;
}

export function scoreSupplierAudit(
  schema: TemplateSchema,
  responses: Responses,
  files: FilePresence,
  weights: { environmental: number; social: number; governance: number; supplyChain: number },
): ScoreResult {
  const flags: ScoreFlag[] = [];
  const breakdown: Record<string, number> = {};
  // Track which sections actually have at least one applicable scored question
  // so we can renormalise weights when a section is empty for this audit.
  const sectionHasScored: Record<string, boolean> = {};

  // Score each scored section.
  for (const section of schema.sections) {
    if (section.weight === 0) continue;
    const scoredCount = section.questions.filter((q) => q.weight > 0).length;
    sectionHasScored[section.id] = scoredCount > 0;
    if (scoredCount === 0) continue; // section is fully disabled — skip from weighted sum
    const pct = scoreSection(section, responses, files, flags);
    breakdown[section.id] = Math.round(pct);
  }

  // Normalised weighting: only count sections that contributed a score.
  const w = {
    environmental: sectionHasScored.environmental ? weights.environmental : 0,
    social: sectionHasScored.social ? weights.social : 0,
    governance: sectionHasScored.governance ? weights.governance : 0,
    supplyChain: sectionHasScored.supplyChain ? weights.supplyChain : 0,
  };
  const totalWeight = w.environmental + w.social + w.governance + w.supplyChain;

  const total =
    totalWeight === 0
      ? 0
      : ((breakdown.environmental ?? 0) * w.environmental +
          (breakdown.social ?? 0) * w.social +
          (breakdown.governance ?? 0) * w.governance +
          (breakdown.supplyChain ?? 0) * w.supplyChain) /
        totalWeight;

  const esgScore = Math.round(total);
  const riskLevel: ScoreResult["riskLevel"] =
    esgScore >= 80 ? "low" : esgScore >= 50 ? "medium" : "high";

  return { esgScore, riskLevel, breakdown, flags };
}
