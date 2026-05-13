import { pgTable, text, boolean, timestamp, integer, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const organisationsTable = pgTable("organisations", {
  id: text("id").primaryKey(),
  // Identity / commercial (FGC standard: Organisation / Account)
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  legalEntityName: text("legal_entity_name"),
  tradingName: text("trading_name"),
  companyNumber: text("company_number"),
  gstVatTaxNumber: text("gst_vat_tax_number"),
  industry: text("industry"),
  country: text("country"),
  logoUrl: text("logo_url"),
  // FGC account_type: prospect | active_customer | suspended | closed
  accountType: text("account_type").notNull().default("active_customer"),
  // FGC commercial / lifecycle metadata
  accountOwner: text("account_owner"),
  accountManager: text("account_manager"),
  commercialStatus: text("commercial_status"),
  onboardingStatus: text("onboarding_status"),
  riskRating: text("risk_rating"),
  supportTier: text("support_tier"),
  contractStartDate: timestamp("contract_start_date", { withTimezone: true }),
  contractEndDate: timestamp("contract_end_date", { withTimezone: true }),
  renewalDate: timestamp("renewal_date", { withTimezone: true }),
  parentAccountId: text("parent_account_id"),
  notes: text("notes"),
  tags: jsonb("tags").$type<string[]>(),
  // FGC recommended extras
  creditLimit: real("credit_limit"),
  paymentTerms: text("payment_terms"),
  preferredCurrency: text("preferred_currency").notNull().default("NZD"),
  defaultTimezone: text("default_timezone").notNull().default("Pacific/Auckland"),
  defaultLanguage: text("default_language").notNull().default("en-NZ"),
  privacyClassification: text("privacy_classification"),
  securityClassification: text("security_classification"),
  dpaNdaStatus: text("dpa_nda_status"),
  trustFrameworkStatus: text("trust_framework_status"),
  complianceStatus: text("compliance_status"),
  // Lock/suspension governance fields
  suspensionReason: text("suspension_reason"),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspendedBy: text("suspended_by"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  // Internal infrastructure (not part of FGC spec)
  widgetKey: text("widget_key").notNull().unique(),
  webhookSecret: text("webhook_secret"),
  inboundEmailAddress: text("inbound_email_address").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  requireMfa: boolean("require_mfa").notNull().default(false),
  dataResidency: text("data_residency").notNull().default("NZ"),
  // Compliance archive retention (months). Applied at capture time to set
  // expires_at on the document_archives row. Range 1–120 enforced at the API
  // layer. Default 6mo matches the original platform-wide policy; auditors
  // requiring 7y can set 84.
  documentArchiveRetentionMonths: integer("document_archive_retention_months")
    .notNull()
    .default(6),
  // SSO policy ────────────────────────────────────────────────────────────────
  // Per-provider master switch. Both default ON so SSO works as soon as the
  // tenant has an EnviroIQ-issued OAuth client wired up at the platform level.
  googleSsoEnabled: boolean("google_sso_enabled").notNull().default(true),
  microsoftSsoEnabled: boolean("microsoft_sso_enabled").notNull().default(true),
  // Set of sign-in methods allowed for users in this org. Subset of
  // ["magic_link","passkey","google_sso","microsoft_sso"]. At least one must
  // remain non-empty (enforced at the API layer). org_admins always retain a
  // break-glass magic-link path even if magic_link is removed here.
  allowedSignInMethods: jsonb("allowed_sign_in_methods")
    .$type<("magic_link" | "passkey" | "google_sso" | "microsoft_sso")[]>()
    .notNull()
    .default(["magic_link", "passkey", "google_sso", "microsoft_sso"]),
  // When set, ordinary users can ONLY sign in via this provider. Admins still
  // retain magic-link break-glass.
  requiredSsoProvider: text("required_sso_provider"),
  // ESG computed metrics — updated by the scheduled metrics refresh engine
  esgFleetCo2eKg: real("esg_fleet_co2e_kg"),
  esgEnergyCo2eKg: real("esg_energy_co2e_kg"),
  esgTotalCo2eKg: real("esg_total_co2e_kg"),
  esgEnergyKwh: real("esg_energy_kwh"),
  esgSustainabilityScore: real("esg_sustainability_score"),
  esgComputedAt: timestamp("esg_computed_at", { withTimezone: true }),
  // CRM-managed billing surface (kept in sync by the sister CRM via /api/v1)
  // Retained for backwards compatibility — see billing_profiles for FGC-spec billing.
  plan: text("plan"),
  billingStatus: text("billing_status").notNull().default("active"),
  // FGC mandatory metadata
  sourceSystem: text("source_system"),
  version: integer("version").notNull().default(1),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOrganisationSchema = createInsertSchema(organisationsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertOrganisation = z.infer<typeof insertOrganisationSchema>;
export type Organisation = typeof organisationsTable.$inferSelect;
