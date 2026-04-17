// Default Supplier ESG Audit template — single source of truth for the
// questionnaire shipped out of the box. Mirrors the spec sections 1-7 and is
// idempotently seeded into supplier_audit_templates as a global (orgId=null)
// row at server boot.

import { db, supplierAuditTemplatesTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { logger } from "./logger.js";

export type QuestionType =
  | "yesno"           // Yes / No
  | "yesno_evidence"  // Yes / No, evidence upload boosts to full points
  | "text"            // free text (no scoring)
  | "longtext"        // free text (no scoring)
  | "number"          // numeric value (no scoring unless target)
  | "scale"           // 0-5 self-assessment
  | "file";           // pure file upload

export interface TemplateQuestion {
  id: string;
  text: string;
  type: QuestionType;
  /** Per-question weight inside its section. Higher = more important. */
  weight: number;
  /** If true, an evidence file must be attached for the answer to count. */
  evidenceRequired?: boolean;
  /** If true, attaching evidence boosts a "yes" from partial to full points. */
  evidenceGivesBonus?: boolean;
  /** Optional helper text shown to the supplier. */
  help?: string;
  /** Optional unit shown next to a number input. */
  unit?: string;
  /** For non-scored free-text questions, marks the field as required. */
  required?: boolean;
}

export interface TemplateSection {
  id: "environmental" | "social" | "governance" | "supplyChain" | "performance";
  title: string;
  description: string;
  /** Per-section weight (0-100, sum across scored sections must equal 100). */
  weight: number;
  questions: TemplateQuestion[];
}

export interface TemplateSchema {
  intro: string;
  sections: TemplateSection[];
}

export const DEFAULT_TEMPLATE_NAME = "EnviroIQ Supplier ESG Audit (NZ MfE 2024)";
export const DEFAULT_TEMPLATE_VERSION = 1;

export const DEFAULT_TEMPLATE_SCHEMA: TemplateSchema = {
  intro:
    "This audit assesses your environmental, social, governance and supply-chain " +
    "performance. Where evidence is requested, attach a recent (≤24 months) policy " +
    "or report. Submissions are locked for audit-trail purposes.",
  sections: [
    {
      id: "environmental",
      title: "Environmental",
      description: "Carbon, energy, materials, waste and water performance.",
      weight: 35,
      questions: [
        { id: "ghg.measure", text: "Do you measure your greenhouse gas (GHG) emissions?", type: "yesno", weight: 3 },
        { id: "ghg.scopes", text: "Which scopes do you measure? (1 / 2 / 3 — comma separated)", type: "text", weight: 2, help: "Example: 1,2,3" },
        { id: "ghg.report", text: "Provide your last 12 months emissions data", type: "file", weight: 3, evidenceRequired: true },
        { id: "ghg.targets", text: "Do you have emissions reduction targets?", type: "yesno_evidence", weight: 2, evidenceGivesBonus: true },
        { id: "ghg.sbt", text: "Are your targets science-based (SBTi-aligned)?", type: "yesno", weight: 2 },

        { id: "energy.kwh", text: "Total annual energy consumption (kWh)", type: "number", weight: 1, unit: "kWh" },
        { id: "energy.renewable", text: "% of energy from renewable sources", type: "number", weight: 2, unit: "%" },
        { id: "energy.plan", text: "Do you have a documented energy reduction plan?", type: "yesno_evidence", weight: 2, evidenceGivesBonus: true },

        { id: "materials.list", text: "List the key materials you supply", type: "longtext", weight: 1, required: true },
        { id: "materials.sustainable", text: "Are materials sustainably sourced?", type: "yesno_evidence", weight: 2, evidenceGivesBonus: true },
        { id: "materials.certified", text: "Hold any sourcing certifications (FSC, recycled content, etc.)?", type: "file", weight: 2 },
        { id: "materials.origin", text: "Country of origin for the materials", type: "text", weight: 1 },

        { id: "waste.track", text: "Do you track waste output?", type: "yesno", weight: 2 },
        { id: "waste.recycledPct", text: "% of waste recycled", type: "number", weight: 2, unit: "%" },
        { id: "waste.hazardous", text: "Describe your hazardous waste handling process", type: "longtext", weight: 1 },

        { id: "water.track", text: "Do you track water usage?", type: "yesno", weight: 1 },
        { id: "water.reduce", text: "Are water reduction initiatives in place?", type: "yesno", weight: 1 },
      ],
    },
    {
      id: "social",
      title: "Social",
      description: "Labour, modern slavery, health & safety, diversity.",
      weight: 20,
      questions: [
        { id: "labour.compliant", text: "Do you comply with all applicable local labour laws?", type: "yesno", weight: 3 },
        { id: "labour.contracts", text: "Do you have formal employment contracts for all staff?", type: "yesno", weight: 2 },
        { id: "labour.hours", text: "Average weekly working hours", type: "number", weight: 1, unit: "hrs" },

        { id: "slavery.policy", text: "Do you have a Modern Slavery / Human Rights policy?", type: "file", weight: 3, evidenceRequired: true },
        { id: "slavery.assess", text: "Do you assess your own suppliers for modern slavery risk?", type: "yesno", weight: 2 },

        { id: "hs.policy", text: "Do you have a Health & Safety policy?", type: "file", weight: 3, evidenceRequired: true },
        { id: "hs.tri", text: "Total recordable injury rate (TRIFR, last 12 months)", type: "number", weight: 1, unit: "per 1M hrs" },
        { id: "hs.ltifr", text: "Lost-Time Injury Frequency Rate (LTIFR)", type: "number", weight: 1, unit: "per 1M hrs" },

        { id: "div.track", text: "Do you track workforce diversity?", type: "yesno", weight: 1 },
        { id: "div.female", text: "% female workforce", type: "number", weight: 1, unit: "%" },
        { id: "div.femaleLead", text: "% female leadership", type: "number", weight: 1, unit: "%" },
      ],
    },
    {
      id: "governance",
      title: "Governance",
      description: "Ethics, cyber security, regulatory compliance.",
      weight: 25,
      questions: [
        { id: "gov.code", text: "Do you have a Code of Conduct?", type: "file", weight: 3, evidenceRequired: true },
        { id: "gov.bribery", text: "Anti-bribery / corruption policy in place?", type: "file", weight: 3, evidenceRequired: true },
        { id: "gov.whistle", text: "Whistleblower policy / mechanism in place?", type: "yesno_evidence", weight: 2, evidenceGivesBonus: true },

        { id: "cyber.framework", text: "Do you have a documented cybersecurity framework?", type: "yesno_evidence", weight: 3, evidenceGivesBonus: true },
        { id: "cyber.iso27001", text: "Aligned to a recognised standard (ISO 27001, NIST CSF, SOC 2)?", type: "text", weight: 2, help: "List standards / certifications" },
        { id: "cyber.mfa", text: "MFA enforced on all production systems?", type: "yesno", weight: 2 },

        { id: "compliance.breaches", text: "Any regulatory breaches in the last 3 years?", type: "yesno", weight: 3, help: "A 'yes' will be flagged for follow-up" },
        { id: "compliance.investigations", text: "Any ongoing investigations or material litigation?", type: "yesno", weight: 2 },
      ],
    },
    {
      id: "supplyChain",
      title: "Supply Chain & Traceability",
      description: "Visibility, logistics, conflict-zone risk.",
      weight: 20,
      questions: [
        { id: "sc.origin", text: "Do you know the origin of all materials?", type: "yesno", weight: 3 },
        { id: "sc.audit", text: "Do you audit your own suppliers?", type: "yesno_evidence", weight: 3, evidenceGivesBonus: true },

        { id: "sc.shipping", text: "Primary shipping method (road / sea / air / mixed)", type: "text", weight: 1, required: true },
        { id: "sc.freightCo2e", text: "Estimated annual freight emissions (kg CO₂e, if known)", type: "number", weight: 1, unit: "kg CO₂e" },
        { id: "sc.transportTrack", text: "Do you track transport emissions?", type: "yesno", weight: 2 },

        { id: "sc.highRisk", text: "Are any materials sourced from high-risk regions?", type: "yesno", weight: 2 },
        { id: "sc.conflict", text: "Any conflict minerals involved (3TG)?", type: "yesno", weight: 2 },
      ],
    },
    {
      id: "performance",
      title: "Performance & Improvement",
      description:
        "Open-ended forward-looking questions. Not scored — turns the audit into a partnership.",
      weight: 0,
      questions: [
        { id: "perf.target", text: "Do you have publicly stated ESG targets?", type: "yesno" , weight: 0 },
        { id: "perf.publicReport", text: "Do you publish an ESG / sustainability report?", type: "yesno", weight: 0 },
        { id: "perf.improvements", text: "What ESG improvements have you made in the last 12 months?", type: "longtext", weight: 0 },
        { id: "perf.topRisk", text: "What is your biggest ESG risk today?", type: "longtext", weight: 0 },
        { id: "perf.support", text: "What support do you need from us to improve?", type: "longtext", weight: 0 },
        { id: "perf.willingAlign", text: "Are you willing to align to our ESG framework?", type: "yesno", weight: 0 },
      ],
    },
  ],
};

/**
 * Idempotently insert the global default template at server boot.
 * Called from index.ts.
 */
export async function ensureDefaultSupplierAuditTemplate(): Promise<void> {
  try {
    const existing = await db.query.supplierAuditTemplatesTable.findFirst({
      where: and(
        isNull(supplierAuditTemplatesTable.organisationId),
        eq(supplierAuditTemplatesTable.isDefault, true),
      ),
    });
    if (existing) {
      // Refresh schema in-place so updates to DEFAULT_TEMPLATE_SCHEMA propagate.
      const newSchema = JSON.stringify(DEFAULT_TEMPLATE_SCHEMA);
      if (existing.schema !== newSchema) {
        await db.update(supplierAuditTemplatesTable)
          .set({ schema: newSchema, updatedAt: new Date() })
          .where(eq(supplierAuditTemplatesTable.id, existing.id));
        logger.info({ templateId: existing.id }, "Default supplier audit template schema refreshed");
      }
      return;
    }
    const id = `tpl_default_v${DEFAULT_TEMPLATE_VERSION}`;
    await db.insert(supplierAuditTemplatesTable).values({
      id,
      organisationId: null,
      name: DEFAULT_TEMPLATE_NAME,
      description:
        "Global EnviroIQ supplier ESG audit. Aligned to GHG Protocol, GRI and TCFD principles.",
      version: DEFAULT_TEMPLATE_VERSION,
      isActive: true,
      isDefault: true,
      weightEnvironmental: 35,
      weightSocial: 20,
      weightGovernance: 25,
      weightSupplyChain: 20,
      schema: JSON.stringify(DEFAULT_TEMPLATE_SCHEMA),
    });
    logger.info({ templateId: id }, "Default supplier audit template seeded");
  } catch (err) {
    logger.error({ err }, "Failed to seed default supplier audit template");
  }
}
