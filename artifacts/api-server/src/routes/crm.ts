/**
 * CRM Integration API — FGC Customer Operations API Standard v1.
 *
 * Mounted at /api/v1. All endpoints:
 *   - Bearer-key authenticated via requireCrmApiKey()
 *   - snake_case request/response payloads
 *   - Standard envelope: { success, data, meta, [pagination] }
 *   - Standard error codes (BAD_REQUEST, NOT_FOUND, CONFLICT, …)
 *   - Optional Idempotency-Key on POST/PATCH/DELETE
 *   - Lifecycle endpoints require a reason_code from FGC_REASON_CODES
 *
 * Customer = Organisation (in EnviroIQ each tenant is one customer/account).
 *
 * This file owns: customer CRUD + lifecycle + the /audit query endpoint.
 * Sub-entity routes (contacts, users, subscriptions, billing, provisioning,
 * tickets) live in crm-entities.ts.
 */
import { Router } from "express";
import { z } from "zod/v4";
import { v4 as uuidv4 } from "uuid";
import { db, organisationsTable, usersTable, auditLogsTable } from "@workspace/db";
import { eq, and, desc, asc, sql, ilike, or, gte, lte, inArray } from "drizzle-orm";
import { requireCrmApiKey } from "../lib/crm-api-auth.js";
import { idempotency } from "../lib/idempotency.js";
import { logAudit, isFgcReasonCode, FGC_REASON_CODES } from "../lib/audit.js";
import { ok, created, paginated, noContent, Errors, asyncRoute } from "../lib/api-response.js";
import { randomBytes } from "crypto";

function generateWidgetKey(): string {
  return `wk_${uuidv4().replace(/-/g, "").substring(0, 24)}`;
}
function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}
function generateInboundEmail(slug: string): string {
  const domain = process.env.INBOUND_EMAIL_DOMAIN || "enviroiq.net";
  return `${slug}@${domain}`;
}

const router = Router();

/* ------------------------------------------------------------------ */
/* Serializers — DB row → FGC snake_case payload                       */
/* ------------------------------------------------------------------ */

function serializeCustomer(o: typeof organisationsTable.$inferSelect) {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    legal_entity_name: o.legalEntityName,
    trading_name: o.tradingName,
    company_number: o.companyNumber,
    gst_vat_tax_number: o.gstVatTaxNumber,
    industry: o.industry,
    country: o.country,
    logo_url: o.logoUrl,
    account_type: o.accountType,
    account_owner: o.accountOwner,
    account_manager: o.accountManager,
    commercial_status: o.commercialStatus,
    onboarding_status: o.onboardingStatus,
    risk_rating: o.riskRating,
    support_tier: o.supportTier,
    contract_start_date: o.contractStartDate,
    contract_end_date: o.contractEndDate,
    renewal_date: o.renewalDate,
    parent_account_id: o.parentAccountId,
    notes: o.notes,
    tags: o.tags ?? [],
    credit_limit: o.creditLimit,
    payment_terms: o.paymentTerms,
    preferred_currency: o.preferredCurrency,
    default_timezone: o.defaultTimezone,
    default_language: o.defaultLanguage,
    privacy_classification: o.privacyClassification,
    security_classification: o.securityClassification,
    dpa_nda_status: o.dpaNdaStatus,
    trust_framework_status: o.trustFrameworkStatus,
    compliance_status: o.complianceStatus,
    suspension_reason: o.suspensionReason,
    suspended_at: o.suspendedAt,
    suspended_by: o.suspendedBy,
    archived_at: o.archivedAt,
    is_active: o.isActive,
    require_mfa: o.requireMfa,
    data_residency: o.dataResidency,
    inbound_email_address: o.inboundEmailAddress,
    plan: o.plan,
    billing_status: o.billingStatus,
    sustainability_score: o.esgSustainabilityScore,
    total_co2e_kg: o.esgTotalCo2eKg,
    source_system: o.sourceSystem,
    version: o.version,
    created_by: o.createdBy,
    updated_by: o.updatedBy,
    created_at: o.createdAt,
    updated_at: o.updatedAt,
  };
}

function serializeAudit(a: typeof auditLogsTable.$inferSelect) {
  let details: unknown = null;
  if (a.details) {
    try {
      details = JSON.parse(a.details);
    } catch {
      details = a.details;
    }
  }
  return {
    id: a.id,
    correlation_id: a.correlationId,
    organisation_id: a.organisationId,
    customer_id: a.organisationId,
    user_id: a.userId,
    user_email: a.userEmail,
    actor_type: a.actorType,
    action: a.action,
    resource_type: a.resourceType,
    resource_id: a.resourceId,
    previous_value: a.previousValue,
    new_value: a.newValue,
    reason_code: a.reasonCode,
    source_system: a.sourceSystem,
    outcome: a.outcome,
    ip_address: a.ipAddress,
    user_agent: a.userAgent,
    details,
    created_at: a.createdAt,
  };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const reasonCodeSchema = z
  .string()
  .refine(isFgcReasonCode, {
    message: `reason_code must be one of: ${FGC_REASON_CODES.join(", ")}`,
  });

const createCustomerSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/i, "slug must be alphanumeric + hyphens"),
  legal_entity_name: z.string().max(200).optional().nullable(),
  trading_name: z.string().max(200).optional().nullable(),
  company_number: z.string().max(64).optional().nullable(),
  gst_vat_tax_number: z.string().max(64).optional().nullable(),
  industry: z.string().max(80).optional().nullable(),
  country: z.string().max(2).optional().nullable(),
  logo_url: z.string().url().optional().nullable(),
  account_type: z.enum(["prospect", "active_customer", "suspended", "closed"]).optional(),
  account_owner: z.string().max(120).optional().nullable(),
  account_manager: z.string().max(120).optional().nullable(),
  commercial_status: z.string().max(40).optional().nullable(),
  risk_rating: z.enum(["low", "medium", "high"]).optional(),
  support_tier: z.string().max(40).optional().nullable(),
  contract_start_date: z.coerce.date().optional().nullable(),
  contract_end_date: z.coerce.date().optional().nullable(),
  renewal_date: z.coerce.date().optional().nullable(),
  parent_account_id: z.string().optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  tags: z.array(z.string().max(40)).max(50).optional(),
  credit_limit: z.number().nonnegative().optional().nullable(),
  payment_terms: z.string().max(80).optional().nullable(),
  preferred_currency: z.string().length(3).optional(),
  default_timezone: z.string().max(64).optional(),
  default_language: z.string().max(16).optional(),
  data_residency: z.string().max(8).optional(),
  require_mfa: z.boolean().optional(),
  plan: z.string().max(40).optional().nullable(),
  source_system: z.string().max(40).optional(),
});

const updateCustomerSchema = createCustomerSchema.partial().omit({ slug: true });

const lifecycleActionSchema = z.object({
  reason_code: reasonCodeSchema,
  reason_note: z.string().max(500).optional(),
});

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

const customerIncludeMap: Record<string, string> = {
  // Reserved for future expansion (?include=primary_contact,subscription)
};

const listCustomersQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  q: z.string().optional(),
  account_type: z
    .enum(["prospect", "active_customer", "suspended", "closed"])
    .optional(),
  industry: z.string().optional(),
  country: z.string().optional(),
  sort: z.enum(["created_at", "updated_at", "name"]).default("created_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

router.get(
  "/customers",
  requireCrmApiKey("customers:read"),
  asyncRoute(async (req, res) => {
    const parse = listCustomersQuery.safeParse(req.query);
    if (!parse.success) throw Errors.badRequest("Invalid query parameters", parse.error.issues);
    const q = parse.data;

    const filters = [] as ReturnType<typeof eq>[];
    if (q.q) {
      filters.push(
        or(
          ilike(organisationsTable.name, `%${q.q}%`),
          ilike(organisationsTable.slug, `%${q.q}%`),
          ilike(organisationsTable.legalEntityName, `%${q.q}%`),
        )!,
      );
    }
    if (q.account_type) filters.push(eq(organisationsTable.accountType, q.account_type));
    if (q.industry) filters.push(eq(organisationsTable.industry, q.industry));
    if (q.country) filters.push(eq(organisationsTable.country, q.country));

    const where = filters.length ? and(...filters) : undefined;
    const sortCol =
      q.sort === "name"
        ? organisationsTable.name
        : q.sort === "updated_at"
          ? organisationsTable.updatedAt
          : organisationsTable.createdAt;

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(organisationsTable)
      .where(where ?? sql`true`);

    const rows = await db
      .select()
      .from(organisationsTable)
      .where(where ?? sql`true`)
      .orderBy(q.order === "asc" ? asc(sortCol) : desc(sortCol))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);

    res.json(
      paginated(rows.map(serializeCustomer), { page: q.page, limit: q.limit, total }, req),
    );
  }),
);

router.get(
  "/customers/:id",
  requireCrmApiKey("customers:read"),
  asyncRoute(async (req, res) => {
    const [row] = await db
      .select()
      .from(organisationsTable)
      .where(eq(organisationsTable.id, req.params.id))
      .limit(1);
    if (!row) throw Errors.notFound("Customer", req.params.id);
    res.json(ok(serializeCustomer(row), req));
  }),
);

router.post(
  "/customers",
  requireCrmApiKey("customers:write"),
  idempotency(),
  asyncRoute(async (req, res) => {
    const parse = createCustomerSchema.safeParse(req.body);
    if (!parse.success) throw Errors.unprocessable("Invalid customer payload", parse.error.issues);
    const body = parse.data;

    const [existing] = await db
      .select({ id: organisationsTable.id })
      .from(organisationsTable)
      .where(eq(organisationsTable.slug, body.slug))
      .limit(1);
    if (existing) throw Errors.conflict("Customer slug already exists", { slug: body.slug });

    const id = uuidv4();
    const widgetKey = generateWidgetKey();
    const inboundEmailAddress = generateInboundEmail(body.slug);
    const webhookSecret = generateWebhookSecret();

    const insertValues: typeof organisationsTable.$inferInsert = {
      id,
      name: body.name,
      slug: body.slug,
      legalEntityName: body.legal_entity_name ?? undefined,
      tradingName: body.trading_name ?? undefined,
      companyNumber: body.company_number ?? undefined,
      gstVatTaxNumber: body.gst_vat_tax_number ?? undefined,
      industry: body.industry ?? undefined,
      country: body.country ?? undefined,
      logoUrl: body.logo_url ?? undefined,
      accountType: body.account_type ?? "active_customer",
      accountOwner: body.account_owner ?? undefined,
      accountManager: body.account_manager ?? undefined,
      commercialStatus: body.commercial_status ?? undefined,
      riskRating: body.risk_rating ?? undefined,
      supportTier: body.support_tier ?? undefined,
      contractStartDate: body.contract_start_date ?? undefined,
      contractEndDate: body.contract_end_date ?? undefined,
      renewalDate: body.renewal_date ?? undefined,
      parentAccountId: body.parent_account_id ?? undefined,
      notes: body.notes ?? undefined,
      tags: body.tags ?? undefined,
      creditLimit: body.credit_limit ?? undefined,
      paymentTerms: body.payment_terms ?? undefined,
      preferredCurrency: body.preferred_currency ?? "NZD",
      defaultTimezone: body.default_timezone ?? "Pacific/Auckland",
      defaultLanguage: body.default_language ?? "en-NZ",
      dataResidency: body.data_residency ?? "NZ",
      requireMfa: body.require_mfa ?? false,
      plan: body.plan ?? undefined,
      sourceSystem: body.source_system ?? "fgc-crm",
      createdBy: req.crmApiKey?.prefix,
      updatedBy: req.crmApiKey?.prefix,
      widgetKey,
      inboundEmailAddress,
      webhookSecret,
    };
    const [row] = await db.insert(organisationsTable).values(insertValues).returning();

    await logAudit({
      req,
      action: "customer.created",
      resourceType: "customer",
      resourceId: id,
      organisationId: id,
      newValue: serializeCustomer(row),
      details: { event: "customer.created", api_key: req.crmApiKey?.prefix },
    });

    res.status(201).json(created(serializeCustomer(row), req));
  }),
);

router.patch(
  "/customers/:id",
  requireCrmApiKey("customers:write"),
  idempotency(),
  asyncRoute(async (req, res) => {
    const parse = updateCustomerSchema.safeParse(req.body);
    if (!parse.success) throw Errors.unprocessable("Invalid customer patch", parse.error.issues);
    const body = parse.data;

    const [before] = await db
      .select()
      .from(organisationsTable)
      .where(eq(organisationsTable.id, req.params.id))
      .limit(1);
    if (!before) throw Errors.notFound("Customer", req.params.id);

    const patch: Partial<typeof organisationsTable.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: req.crmApiKey?.prefix,
      version: (before.version ?? 1) + 1,
    };
    if (body.name !== undefined) patch.name = body.name;
    if (body.legal_entity_name !== undefined) patch.legalEntityName = body.legal_entity_name ?? null;
    if (body.trading_name !== undefined) patch.tradingName = body.trading_name ?? null;
    if (body.company_number !== undefined) patch.companyNumber = body.company_number ?? null;
    if (body.gst_vat_tax_number !== undefined) patch.gstVatTaxNumber = body.gst_vat_tax_number ?? null;
    if (body.industry !== undefined) patch.industry = body.industry ?? null;
    if (body.country !== undefined) patch.country = body.country ?? null;
    if (body.logo_url !== undefined) patch.logoUrl = body.logo_url ?? null;
    if (body.account_type !== undefined) patch.accountType = body.account_type;
    if (body.account_owner !== undefined) patch.accountOwner = body.account_owner ?? null;
    if (body.account_manager !== undefined) patch.accountManager = body.account_manager ?? null;
    if (body.commercial_status !== undefined) patch.commercialStatus = body.commercial_status ?? null;
    if (body.risk_rating !== undefined) patch.riskRating = body.risk_rating;
    if (body.support_tier !== undefined) patch.supportTier = body.support_tier ?? null;
    if (body.contract_start_date !== undefined) patch.contractStartDate = body.contract_start_date ?? null;
    if (body.contract_end_date !== undefined) patch.contractEndDate = body.contract_end_date ?? null;
    if (body.renewal_date !== undefined) patch.renewalDate = body.renewal_date ?? null;
    if (body.parent_account_id !== undefined) patch.parentAccountId = body.parent_account_id ?? null;
    if (body.notes !== undefined) patch.notes = body.notes ?? null;
    if (body.tags !== undefined) patch.tags = body.tags;
    if (body.credit_limit !== undefined) patch.creditLimit = body.credit_limit ?? null;
    if (body.payment_terms !== undefined) patch.paymentTerms = body.payment_terms ?? null;
    if (body.preferred_currency !== undefined) patch.preferredCurrency = body.preferred_currency;
    if (body.default_timezone !== undefined) patch.defaultTimezone = body.default_timezone;
    if (body.default_language !== undefined) patch.defaultLanguage = body.default_language;
    if (body.data_residency !== undefined) patch.dataResidency = body.data_residency;
    if (body.require_mfa !== undefined) patch.requireMfa = body.require_mfa;
    if (body.plan !== undefined) patch.plan = body.plan ?? null;

    const [updated] = await db
      .update(organisationsTable)
      .set(patch)
      .where(eq(organisationsTable.id, req.params.id))
      .returning();

    await logAudit({
      req,
      action: "customer.updated",
      resourceType: "customer",
      resourceId: req.params.id,
      organisationId: req.params.id,
      previousValue: serializeCustomer(before),
      newValue: serializeCustomer(updated),
      details: { event: "customer.updated", changed_fields: Object.keys(patch) },
    });

    res.json(ok(serializeCustomer(updated), req));
  }),
);

/* ----- lifecycle actions ----------------------------------------- */

async function lifecycleAction(opts: {
  req: import("express").Request;
  id: string;
  action: "suspend" | "reactivate" | "archive";
  patch: Partial<typeof organisationsTable.$inferInsert>;
}) {
  const parse = lifecycleActionSchema.safeParse(opts.req.body);
  if (!parse.success)
    throw Errors.badRequest("Invalid lifecycle payload", parse.error.issues);
  const { reason_code, reason_note } = parse.data;

  const [before] = await db
    .select()
    .from(organisationsTable)
    .where(eq(organisationsTable.id, opts.id))
    .limit(1);
  if (!before) throw Errors.notFound("Customer", opts.id);

  const next: Partial<typeof organisationsTable.$inferInsert> = {
    ...opts.patch,
    updatedAt: new Date(),
    updatedBy: opts.req.crmApiKey?.prefix,
    version: (before.version ?? 1) + 1,
  };
  if (opts.action === "suspend") {
    next.suspensionReason = reason_code;
    next.suspendedAt = new Date();
    next.suspendedBy = opts.req.crmApiKey?.prefix;
    next.isActive = false;
    next.accountType = "suspended";
  } else if (opts.action === "reactivate") {
    next.suspensionReason = null;
    next.suspendedAt = null;
    next.suspendedBy = null;
    next.isActive = true;
    next.accountType = "active_customer";
  } else if (opts.action === "archive") {
    next.archivedAt = new Date();
    next.isActive = false;
    next.accountType = "closed";
  }

  const [updated] = await db
    .update(organisationsTable)
    .set(next)
    .where(eq(organisationsTable.id, opts.id))
    .returning();

  await logAudit({
    req: opts.req,
    action: `customer.${opts.action === "suspend" ? "suspended" : opts.action === "reactivate" ? "reactivated" : "archived"}`,
    resourceType: "customer",
    resourceId: opts.id,
    organisationId: opts.id,
    reasonCode: reason_code,
    previousValue: { account_type: before.accountType, is_active: before.isActive },
    newValue: { account_type: updated.accountType, is_active: updated.isActive },
    details: {
      event: `customer.${opts.action === "suspend" ? "suspended" : opts.action === "reactivate" ? "reactivated" : "archived"}`,
      reason_note,
    },
  });

  return updated;
}

router.post(
  "/customers/:id/suspend",
  requireCrmApiKey("customers:write"),
  idempotency(),
  asyncRoute(async (req, res) => {
    const updated = await lifecycleAction({ req, id: req.params.id, action: "suspend", patch: {} });
    res.json(ok(serializeCustomer(updated), req));
  }),
);

router.post(
  "/customers/:id/reactivate",
  requireCrmApiKey("customers:write"),
  idempotency(),
  asyncRoute(async (req, res) => {
    const updated = await lifecycleAction({ req, id: req.params.id, action: "reactivate", patch: {} });
    res.json(ok(serializeCustomer(updated), req));
  }),
);

router.post(
  "/customers/:id/archive",
  requireCrmApiKey("customers:write"),
  idempotency(),
  asyncRoute(async (req, res) => {
    const updated = await lifecycleAction({ req, id: req.params.id, action: "archive", patch: {} });
    res.json(ok(serializeCustomer(updated), req));
  }),
);

/* ------------------------------------------------------------------ */
/* Audit query — FGC standard /audit endpoint                          */
/* ------------------------------------------------------------------ */

const auditQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(100),
  customer_id: z.string().optional(),
  organisation_id: z.string().optional(),
  resource_type: z.string().optional(),
  resource_id: z.string().optional(),
  action: z.string().optional(),
  actor_type: z.string().optional(),
  reason_code: z.string().optional(),
  correlation_id: z.string().optional(),
  source_system: z.string().optional(),
  outcome: z.enum(["success", "failure"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

router.get(
  "/audit",
  requireCrmApiKey("audit:read"),
  asyncRoute(async (req, res) => {
    const parse = auditQuerySchema.safeParse(req.query);
    if (!parse.success) throw Errors.badRequest("Invalid audit query", parse.error.issues);
    const q = parse.data;

    const filters = [] as ReturnType<typeof eq>[];
    const orgId = q.customer_id ?? q.organisation_id;
    if (orgId) filters.push(eq(auditLogsTable.organisationId, orgId));
    if (q.resource_type) filters.push(eq(auditLogsTable.resourceType, q.resource_type));
    if (q.resource_id) filters.push(eq(auditLogsTable.resourceId, q.resource_id));
    if (q.action) filters.push(eq(auditLogsTable.action, q.action));
    if (q.actor_type) filters.push(eq(auditLogsTable.actorType, q.actor_type));
    if (q.reason_code) filters.push(eq(auditLogsTable.reasonCode, q.reason_code));
    if (q.correlation_id) filters.push(eq(auditLogsTable.correlationId, q.correlation_id));
    if (q.source_system) filters.push(eq(auditLogsTable.sourceSystem, q.source_system));
    if (q.outcome) filters.push(eq(auditLogsTable.outcome, q.outcome));
    if (q.from) filters.push(gte(auditLogsTable.createdAt, q.from));
    if (q.to) filters.push(lte(auditLogsTable.createdAt, q.to));

    const where = filters.length ? and(...filters) : undefined;

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(auditLogsTable)
      .where(where ?? sql`true`);

    const rows = await db
      .select()
      .from(auditLogsTable)
      .where(where ?? sql`true`)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);

    res.json(paginated(rows.map(serializeAudit), { page: q.page, limit: q.limit, total }, req));
  }),
);

export default router;

/* ------------------------------------------------------------------ */
/* Re-exports for ergonomics                                           */
/* ------------------------------------------------------------------ */

export { serializeCustomer };
