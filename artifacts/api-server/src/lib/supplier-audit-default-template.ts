// Default Supplier ESG Audit template — single source of truth for the
// questionnaire shipped out of the box. Mirrors the spec sections 1-7 and is
// idempotently seeded into supplier_audit_templates as a global (orgId=null)
// row at server boot.
//
// Every question carries a `rationale` ("why this matters") string written by
// EnviroIQ in plain language. The rationale is shown to org admins next to
// the on/off toggle on the Audit Customisation page; when an admin disables a
// question the rationale is snapshotted into the override record so the audit
// trail stays truthful even if EnviroIQ later edits the rationale.

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
  /** Why this question matters — shown to admins customising the audit. Plain language. */
  rationale: string;
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
// Version 2 introduces the `rationale` field on every question.
export const DEFAULT_TEMPLATE_VERSION = 2;

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
        { id: "ghg.measure", text: "Do you measure your greenhouse gas (GHG) emissions?", type: "yesno", weight: 3,
          rationale: "Measuring emissions is the foundation of any climate plan — without a baseline you can't set targets, report to NZ XRB / TCFD, or verify reductions. Disable only if this supplier's footprint is genuinely de-minimis (e.g. a sole trader with no plant)." },
        { id: "ghg.scopes", text: "Which scopes do you measure? (1 / 2 / 3 — comma separated)", type: "text", weight: 2, help: "Example: 1,2,3",
          rationale: "Tells us whether the supplier sees the whole picture (Scope 1 fuel + 2 electricity + 3 supply-chain) or only the easy bits. Scope 3 coverage is the leading indicator of climate maturity. Disable if you don't intend to act on the answer." },
        { id: "ghg.report", text: "Provide your last 12 months emissions data", type: "file", weight: 3, evidenceRequired: true,
          rationale: "Documentary evidence (CSV, GHG inventory, sustainability report) is what turns a 'yes' answer into something a regulator or auditor can rely on. Disable if you're collecting raw data via another channel (e.g. EnviroIQ's energy sync)." },
        { id: "ghg.targets", text: "Do you have emissions reduction targets?", type: "yesno_evidence", weight: 2, evidenceGivesBonus: true,
          rationale: "Targets are how you separate suppliers who are managing the transition from those who aren't. Critical for any net-zero / SBTi alignment story. Disable for suppliers where you're only sourcing one-off goods." },
        { id: "ghg.sbt", text: "Are your targets science-based (SBTi-aligned)?", type: "yesno", weight: 2,
          rationale: "Science-based targets prove the supplier's ambition is consistent with limiting warming to 1.5–2 °C. Disable if you're a small org and SBTi alignment isn't on your radar yet — but most enterprise buyers want this." },

        { id: "energy.kwh", text: "Total annual energy consumption (kWh)", type: "number", weight: 1, unit: "kWh",
          rationale: "Raw energy figures let you spot anomalies and compute intensity (kWh per unit produced). Disable for service-only suppliers where energy use is genuinely negligible." },
        { id: "energy.renewable", text: "% of energy from renewable sources", type: "number", weight: 2, unit: "%",
          rationale: "Renewable share directly drives the supplier's Scope 2 emissions. In NZ this is mostly grid mix + on-site solar. Disable only if you don't care about Scope 2 attribution." },
        { id: "energy.plan", text: "Do you have a documented energy reduction plan?", type: "yesno_evidence", weight: 2, evidenceGivesBonus: true,
          rationale: "A written plan distinguishes intent from action. Suppliers without a plan rarely deliver year-on-year reductions. Disable if you're auditing for compliance only, not performance." },

        { id: "materials.list", text: "List the key materials you supply", type: "longtext", weight: 1, required: true,
          rationale: "Without a materials list you can't assess embodied carbon, recyclability, or sourcing risk. Almost always relevant — disable only for pure service providers (legal, IT support, consulting)." },
        { id: "materials.sustainable", text: "Are materials sustainably sourced?", type: "yesno_evidence", weight: 2, evidenceGivesBonus: true,
          rationale: "Sustainable sourcing reduces embodied carbon and protects you from reputational risk. Disable only if you've already covered this via a separate procurement policy or industry certification." },
        { id: "materials.certified", text: "Hold any sourcing certifications (FSC, recycled content, etc.)?", type: "file", weight: 2,
          rationale: "Third-party certifications are auditor-grade evidence. Disable for industries where the relevant certifications don't exist (e.g. some specialty trades)." },
        { id: "materials.origin", text: "Country of origin for the materials", type: "text", weight: 1,
          rationale: "Country of origin drives freight emissions, modern-slavery risk, and tariff exposure. Disable only for service-only suppliers." },

        { id: "waste.track", text: "Do you track waste output?", type: "yesno", weight: 2,
          rationale: "Waste tracking is the entry point to a circular-economy conversation and lets you measure landfill diversion. Disable for office-only suppliers with no operational waste stream." },
        { id: "waste.recycledPct", text: "% of waste recycled", type: "number", weight: 2, unit: "%",
          rationale: "Recycling rate is the simplest forward-looking circularity metric. Disable if waste is genuinely not material for this supplier." },
        { id: "waste.hazardous", text: "Describe your hazardous waste handling process", type: "longtext", weight: 1,
          rationale: "Hazardous waste handling is a compliance hot-spot — failures create liability for your org under WorkSafe NZ and HSWA 2015. Disable only if you've confirmed the supplier handles no hazardous materials at all." },

        { id: "water.track", text: "Do you track water usage?", type: "yesno", weight: 1,
          rationale: "Water is increasingly material for NZ suppliers in agri, food & bev, and manufacturing. Disable for low-water service businesses." },
        { id: "water.reduce", text: "Are water reduction initiatives in place?", type: "yesno", weight: 1,
          rationale: "Demonstrates active management vs passive measurement. Disable in lockstep with the water-tracking question above if water is immaterial." },
      ],
    },
    {
      id: "social",
      title: "Social",
      description: "Labour, modern slavery, health & safety, diversity.",
      weight: 20,
      questions: [
        { id: "labour.compliant", text: "Do you comply with all applicable local labour laws?", type: "yesno", weight: 3,
          rationale: "A 'no' (or refusal to answer) is a hard stop — labour-law breaches expose you to joint liability and reputational damage. Almost never disable." },
        { id: "labour.contracts", text: "Do you have formal employment contracts for all staff?", type: "yesno", weight: 2,
          rationale: "Formal contracts are the baseline anti-exploitation safeguard. Disable only for owner-operator businesses with no employees." },
        { id: "labour.hours", text: "Average weekly working hours", type: "number", weight: 1, unit: "hrs",
          rationale: "Excessive hours flag burnout and modern-slavery risk. Disable if you're not assessing labour conditions in this category of supplier." },

        { id: "slavery.policy", text: "Do you have a Modern Slavery / Human Rights policy?", type: "file", weight: 3, evidenceRequired: true,
          rationale: "Required under NZ's Modern Slavery legislation and Australia's MSA for any supplier in your reportable supply chain. Disable only for micro-suppliers genuinely below reporting thresholds." },
        { id: "slavery.assess", text: "Do you assess your own suppliers for modern slavery risk?", type: "yesno", weight: 2,
          rationale: "Tier-2 visibility is what separates checkbox compliance from real protection. Disable for suppliers with no sub-suppliers (e.g. solo trades)." },

        { id: "hs.policy", text: "Do you have a Health & Safety policy?", type: "file", weight: 3, evidenceRequired: true,
          rationale: "Mandatory under HSWA 2015 for any business with workers. Disable only for owner-operators with no employees and no contractors." },
        { id: "hs.tri", text: "Total recordable injury rate (TRIFR, last 12 months)", type: "number", weight: 1, unit: "per 1M hrs",
          rationale: "TRIFR is the industry-standard safety benchmark. Disable if the supplier is too small to have meaningful denominators (TRIFR is noisy below ~100k worked hours)." },
        { id: "hs.ltifr", text: "Lost-Time Injury Frequency Rate (LTIFR)", type: "number", weight: 1, unit: "per 1M hrs",
          rationale: "Complements TRIFR by isolating injuries severe enough to cause lost time. Same caveat as TRIFR for very small suppliers." },

        { id: "div.track", text: "Do you track workforce diversity?", type: "yesno", weight: 1,
          rationale: "Tracking is the precondition for closing pay-equity gaps and meeting board-diversity expectations. Disable for very small suppliers where headcount makes the metric meaningless." },
        { id: "div.female", text: "% female workforce", type: "number", weight: 1, unit: "%",
          rationale: "Single-metric snapshot of workforce diversity. Disable as above for very small suppliers." },
        { id: "div.femaleLead", text: "% female leadership", type: "number", weight: 1, unit: "%",
          rationale: "Leadership representation is a stronger signal of inclusive culture than overall headcount. Disable for owner-operator suppliers." },
      ],
    },
    {
      id: "governance",
      title: "Governance",
      description: "Ethics, cyber security, regulatory compliance.",
      weight: 25,
      questions: [
        { id: "gov.code", text: "Do you have a Code of Conduct?", type: "file", weight: 3, evidenceRequired: true,
          rationale: "Documents how the supplier expects employees to behave — the foundation of governance. Disable only for owner-operator businesses." },
        { id: "gov.bribery", text: "Anti-bribery / corruption policy in place?", type: "file", weight: 3, evidenceRequired: true,
          rationale: "Critical if any supplier touches procurement, contracts or government. Required for ISO 37001 alignment. Disable for low-risk service suppliers with no payment authority." },
        { id: "gov.whistle", text: "Whistleblower policy / mechanism in place?", type: "yesno_evidence", weight: 2, evidenceGivesBonus: true,
          rationale: "A safe channel for staff to raise concerns is the early-warning system for fraud, harassment and safety. Disable only for suppliers with <5 employees." },

        { id: "cyber.framework", text: "Do you have a documented cybersecurity framework?", type: "yesno_evidence", weight: 3, evidenceGivesBonus: true,
          rationale: "Suppliers with system access become your attack surface. A documented framework is the minimum for any data-handling relationship. Disable only for suppliers with no digital touchpoint to your business." },
        { id: "cyber.iso27001", text: "Aligned to a recognised standard (ISO 27001, NIST CSF, SOC 2)?", type: "text", weight: 2, help: "List standards / certifications",
          rationale: "Recognised standards mean an external auditor has verified controls. Disable if you don't require certifications from this tier of supplier." },
        { id: "cyber.mfa", text: "MFA enforced on all production systems?", type: "yesno", weight: 2,
          rationale: "MFA prevents the vast majority of credential-stuffing attacks — a baseline expectation in 2025. Disable only for fully air-gapped trades suppliers." },

        { id: "compliance.breaches", text: "Any regulatory breaches in the last 3 years?", type: "yesno", weight: 3, help: "A 'yes' will be flagged for follow-up",
          rationale: "Past breaches are the strongest predictor of future risk. Almost never disable — a 'yes' here is auto-flagged for human review." },
        { id: "compliance.investigations", text: "Any ongoing investigations or material litigation?", type: "yesno", weight: 2,
          rationale: "Live investigations can become material disclosures for your own org. Almost never disable." },
      ],
    },
    {
      id: "supplyChain",
      title: "Supply Chain & Traceability",
      description: "Visibility, logistics, conflict-zone risk.",
      weight: 20,
      questions: [
        { id: "sc.origin", text: "Do you know the origin of all materials?", type: "yesno", weight: 3,
          rationale: "Origin visibility is the precondition for modern-slavery, conflict-mineral and embodied-carbon assessments. Disable for service-only suppliers." },
        { id: "sc.audit", text: "Do you audit your own suppliers?", type: "yesno_evidence", weight: 3, evidenceGivesBonus: true,
          rationale: "Cascading the standard down the supply chain is how risk actually gets reduced beyond your immediate counterparty. Disable for suppliers with no sub-tier." },

        { id: "sc.shipping", text: "Primary shipping method (road / sea / air / mixed)", type: "text", weight: 1, required: true,
          rationale: "Air freight is ~50× more carbon-intensive than sea per tonne-km — a single answer that materially shifts your Scope 3 transport calc. Disable for non-physical suppliers." },
        { id: "sc.freightCo2e", text: "Estimated annual freight emissions (kg CO₂e, if known)", type: "number", weight: 1, unit: "kg CO₂e",
          rationale: "If the supplier already has a number, use it — otherwise we estimate from method + distance. Disable when freight is immaterial." },
        { id: "sc.transportTrack", text: "Do you track transport emissions?", type: "yesno", weight: 2,
          rationale: "Tracking shows the supplier is actively managing freight emissions, not just reporting an estimate. Disable when freight is immaterial." },

        { id: "sc.highRisk", text: "Are any materials sourced from high-risk regions?", type: "yesno", weight: 2,
          rationale: "High-risk-region exposure (sanctioned countries, conflict zones) is auto-flagged for review. Almost never disable." },
        { id: "sc.conflict", text: "Any conflict minerals involved (3TG)?", type: "yesno", weight: 2,
          rationale: "Tin, tungsten, tantalum, gold from DRC region — Dodd-Frank and EU regulations apply to many electronics inputs. Disable only for suppliers in industries where 3TG cannot be present (e.g. food, professional services)." },
      ],
    },
    {
      id: "performance",
      title: "Performance & Improvement",
      description:
        "Open-ended forward-looking questions. Not scored — turns the audit into a partnership.",
      weight: 0,
      questions: [
        { id: "perf.target", text: "Do you have publicly stated ESG targets?", type: "yesno" , weight: 0,
          rationale: "Public targets create accountability. Insight question only — not scored. Disable to keep the audit shorter." },
        { id: "perf.publicReport", text: "Do you publish an ESG / sustainability report?", type: "yesno", weight: 0,
          rationale: "Public reporting signals maturity and lets you cross-reference claims. Insight only." },
        { id: "perf.improvements", text: "What ESG improvements have you made in the last 12 months?", type: "longtext", weight: 0,
          rationale: "Captures momentum the supplier is proud of — useful colour for your supplier scorecard. Insight only." },
        { id: "perf.topRisk", text: "What is your biggest ESG risk today?", type: "longtext", weight: 0,
          rationale: "Self-disclosed risks help you prioritise where to focus joint improvement work. Insight only." },
        { id: "perf.support", text: "What support do you need from us to improve?", type: "longtext", weight: 0,
          rationale: "Turns the audit into a two-way conversation — often surfaces quick wins (training, payment terms, joint procurement). Insight only." },
        { id: "perf.willingAlign", text: "Are you willing to align to our ESG framework?", type: "yesno", weight: 0,
          rationale: "Captures intent to formalise the partnership. Insight only — useful for tiering suppliers into 'partner' vs 'transactional'." },
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
      const needsRefresh = existing.schema !== newSchema || existing.version !== DEFAULT_TEMPLATE_VERSION;
      if (needsRefresh) {
        await db.update(supplierAuditTemplatesTable)
          .set({ schema: newSchema, version: DEFAULT_TEMPLATE_VERSION, updatedAt: new Date() })
          .where(eq(supplierAuditTemplatesTable.id, existing.id));
        logger.info({ templateId: existing.id, version: DEFAULT_TEMPLATE_VERSION }, "Default supplier audit template schema refreshed");
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
