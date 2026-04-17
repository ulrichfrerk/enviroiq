/**
 * CRM Integration API — sub-entity routes (FGC v1).
 *
 * Mounted at /api/v1. Splits out:
 *   - /customers/:cid/contacts                  (FGC contacts:read|write)
 *   - /customers/:cid/users                     (users:read|write)
 *   - /customers/:cid/subscriptions             (subscriptions:read|write)
 *   - /customers/:cid/billing-profile           (billing:read|write)
 *   - /customers/:cid/provisioning-requests     (provisioning:read|write)
 *   - /customers/:cid/tickets                   (tickets:read|write)
 *
 * All payloads are snake_case; all responses use the FGC envelope; lifecycle
 * actions require an FGC reason_code.
 */
import { Router } from "express";
import { z } from "zod/v4";
import { v4 as uuidv4 } from "uuid";
import {
  db,
  organisationsTable,
  contactsTable,
  subscriptionsTable,
  billingProfilesTable,
  provisioningRequestsTable,
  supportTicketsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireCrmApiKey } from "../lib/crm-api-auth.js";
import { idempotency } from "../lib/idempotency.js";
import { logAudit, isFgcReasonCode, FGC_REASON_CODES } from "../lib/audit.js";
import { ok, created, paginated, Errors, asyncRoute } from "../lib/api-response.js";

const router = Router({ mergeParams: true });

const reasonCodeSchema = z.string().refine(isFgcReasonCode, {
  message: `reason_code must be one of: ${FGC_REASON_CODES.join(", ")}`,
});

async function assertCustomer(id: string): Promise<void> {
  const [row] = await db
    .select({ id: organisationsTable.id })
    .from(organisationsTable)
    .where(eq(organisationsTable.id, id))
    .limit(1);
  if (!row) throw Errors.notFound("Customer", id);
}

const pageQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

/* ============================================================ */
/* Contacts                                                     */
/* ============================================================ */

function serializeContact(c: typeof contactsTable.$inferSelect) {
  return {
    id: c.id,
    customer_id: c.organisationId,
    organisation_id: c.organisationId,
    first_name: c.firstName,
    last_name: c.lastName,
    job_title: c.jobTitle,
    email: c.email,
    mobile: c.mobile,
    phone: c.phone,
    department: c.department,
    role_in_customer_business: c.roleInCustomerBusiness,
    is_primary_contact: c.isPrimaryContact,
    is_active: c.isActive,
    preferred_communication_method: c.preferredCommunicationMethod,
    marketing_consent: c.marketingConsent,
    escalation_level: c.escalationLevel,
    is_after_hours_contact: c.isAfterHoursContact,
    notes: c.notes,
    source_system: c.sourceSystem,
    created_by: c.createdBy,
    updated_by: c.updatedBy,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

const contactCreateSchema = z.object({
  first_name: z.string().min(1).max(80),
  last_name: z.string().min(1).max(80),
  email: z.string().email(),
  job_title: z.string().max(120).optional().nullable(),
  mobile: z.string().max(40).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  department: z.string().max(80).optional().nullable(),
  role_in_customer_business: z
    .enum(["billing", "technical", "procurement", "executive", "support"])
    .optional()
    .nullable(),
  is_primary_contact: z.boolean().optional(),
  preferred_communication_method: z.enum(["email", "phone", "sms"]).optional().nullable(),
  marketing_consent: z.boolean().optional(),
  escalation_level: z.string().max(20).optional().nullable(),
  is_after_hours_contact: z.boolean().optional(),
  notes: z.string().max(2000).optional().nullable(),
});
const contactPatchSchema = contactCreateSchema.partial();

router.get(
  "/customers/:cid/contacts",
  requireCrmApiKey("contacts:read"),
  asyncRoute(async (req, res) => {
    await assertCustomer(req.params.cid);
    const q = pageQuery.parse(req.query);
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(contactsTable)
      .where(eq(contactsTable.organisationId, req.params.cid));
    const rows = await db
      .select()
      .from(contactsTable)
      .where(eq(contactsTable.organisationId, req.params.cid))
      .orderBy(desc(contactsTable.createdAt))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    res.json(paginated(rows.map(serializeContact), { ...q, total }, req));
  }),
);

router.post(
  "/customers/:cid/contacts",
  requireCrmApiKey("contacts:write"),
  idempotency(),
  asyncRoute(async (req, res) => {
    await assertCustomer(req.params.cid);
    const parse = contactCreateSchema.safeParse(req.body);
    if (!parse.success) throw Errors.unprocessable("Invalid contact payload", parse.error.issues);
    const b = parse.data;
    const id = uuidv4();
    const [row] = await db
      .insert(contactsTable)
      .values({
        id,
        organisationId: req.params.cid,
        firstName: b.first_name,
        lastName: b.last_name,
        email: b.email,
        jobTitle: b.job_title ?? undefined,
        mobile: b.mobile ?? undefined,
        phone: b.phone ?? undefined,
        department: b.department ?? undefined,
        roleInCustomerBusiness: b.role_in_customer_business ?? undefined,
        isPrimaryContact: b.is_primary_contact ?? false,
        preferredCommunicationMethod: b.preferred_communication_method ?? undefined,
        marketingConsent: b.marketing_consent ?? false,
        escalationLevel: b.escalation_level ?? undefined,
        isAfterHoursContact: b.is_after_hours_contact ?? false,
        notes: b.notes ?? undefined,
        sourceSystem: "fgc-crm",
        createdBy: req.crmApiKey?.prefix,
        updatedBy: req.crmApiKey?.prefix,
      })
      .returning();
    await logAudit({
      req,
      action: "contact.created",
      resourceType: "contact",
      resourceId: id,
      organisationId: req.params.cid,
      newValue: serializeContact(row),
      details: { event: "contact.created" },
    });
    res.status(201).json(created(serializeContact(row), req));
  }),
);

router.get(
  "/customers/:cid/contacts/:id",
  requireCrmApiKey("contacts:read"),
  asyncRoute(async (req, res) => {
    const [row] = await db
      .select()
      .from(contactsTable)
      .where(and(eq(contactsTable.id, req.params.id), eq(contactsTable.organisationId, req.params.cid)))
      .limit(1);
    if (!row) throw Errors.notFound("Contact", req.params.id);
    res.json(ok(serializeContact(row), req));
  }),
);

router.patch(
  "/customers/:cid/contacts/:id",
  requireCrmApiKey("contacts:write"),
  idempotency(),
  asyncRoute(async (req, res) => {
    const parse = contactPatchSchema.safeParse(req.body);
    if (!parse.success) throw Errors.unprocessable("Invalid contact patch", parse.error.issues);
    const b = parse.data;
    const [before] = await db
      .select()
      .from(contactsTable)
      .where(and(eq(contactsTable.id, req.params.id), eq(contactsTable.organisationId, req.params.cid)))
      .limit(1);
    if (!before) throw Errors.notFound("Contact", req.params.id);

    const patch: Partial<typeof contactsTable.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: req.crmApiKey?.prefix,
    };
    if (b.first_name !== undefined) patch.firstName = b.first_name;
    if (b.last_name !== undefined) patch.lastName = b.last_name;
    if (b.email !== undefined) patch.email = b.email;
    if (b.job_title !== undefined) patch.jobTitle = b.job_title ?? null;
    if (b.mobile !== undefined) patch.mobile = b.mobile ?? null;
    if (b.phone !== undefined) patch.phone = b.phone ?? null;
    if (b.department !== undefined) patch.department = b.department ?? null;
    if (b.role_in_customer_business !== undefined) patch.roleInCustomerBusiness = b.role_in_customer_business ?? null;
    if (b.is_primary_contact !== undefined) patch.isPrimaryContact = b.is_primary_contact;
    if (b.preferred_communication_method !== undefined) patch.preferredCommunicationMethod = b.preferred_communication_method ?? null;
    if (b.marketing_consent !== undefined) patch.marketingConsent = b.marketing_consent;
    if (b.escalation_level !== undefined) patch.escalationLevel = b.escalation_level ?? null;
    if (b.is_after_hours_contact !== undefined) patch.isAfterHoursContact = b.is_after_hours_contact;
    if (b.notes !== undefined) patch.notes = b.notes ?? null;

    const [updated] = await db
      .update(contactsTable)
      .set(patch)
      .where(eq(contactsTable.id, req.params.id))
      .returning();

    await logAudit({
      req,
      action: "contact.updated",
      resourceType: "contact",
      resourceId: req.params.id,
      organisationId: req.params.cid,
      previousValue: serializeContact(before),
      newValue: serializeContact(updated),
      details: { event: "contact.updated" },
    });
    res.json(ok(serializeContact(updated), req));
  }),
);

router.delete(
  "/customers/:cid/contacts/:id",
  requireCrmApiKey("contacts:write"),
  idempotency(),
  asyncRoute(async (req, res) => {
    const [before] = await db
      .select()
      .from(contactsTable)
      .where(and(eq(contactsTable.id, req.params.id), eq(contactsTable.organisationId, req.params.cid)))
      .limit(1);
    if (!before) throw Errors.notFound("Contact", req.params.id);
    await db.delete(contactsTable).where(eq(contactsTable.id, req.params.id));
    await logAudit({
      req,
      action: "contact.deleted",
      resourceType: "contact",
      resourceId: req.params.id,
      organisationId: req.params.cid,
      previousValue: serializeContact(before),
      details: { event: "contact.deleted" },
    });
    res.status(204).end();
  }),
);

/* ============================================================ */
/* Users (app users at the customer)                            */
/* ============================================================ */

function serializeUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    customer_id: u.organisationId,
    organisation_id: u.organisationId,
    email: u.email,
    name: u.name,
    role: u.role,
    is_active: u.isActive,
    last_login_at: u.lastLoginAt,
    created_at: u.createdAt,
    updated_at: u.updatedAt,
  };
}

const userCreateSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  role: z.enum(["org_admin", "org_member", "org_viewer"]).default("org_member"),
});
const userPatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  role: z.enum(["org_admin", "org_member", "org_viewer"]).optional(),
});

router.get(
  "/customers/:cid/users",
  requireCrmApiKey("users:read"),
  asyncRoute(async (req, res) => {
    await assertCustomer(req.params.cid);
    const q = pageQuery.parse(req.query);
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(usersTable)
      .where(eq(usersTable.organisationId, req.params.cid));
    const rows = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.organisationId, req.params.cid))
      .orderBy(desc(usersTable.createdAt))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    res.json(paginated(rows.map(serializeUser), { ...q, total }, req));
  }),
);

router.post(
  "/customers/:cid/users",
  requireCrmApiKey("users:write"),
  idempotency(),
  asyncRoute(async (req, res) => {
    await assertCustomer(req.params.cid);
    const parse = userCreateSchema.safeParse(req.body);
    if (!parse.success) throw Errors.unprocessable("Invalid user payload", parse.error.issues);
    const b = parse.data;
    const [exists] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, b.email)).limit(1);
    if (exists) throw Errors.conflict("User with this email already exists", { email: b.email });
    const id = uuidv4();
    const [row] = await db
      .insert(usersTable)
      .values({ id, email: b.email, name: b.name, role: b.role, organisationId: req.params.cid })
      .returning();
    await logAudit({
      req,
      action: "user.created",
      resourceType: "user",
      resourceId: id,
      organisationId: req.params.cid,
      newValue: serializeUser(row),
      details: { event: "user.created" },
    });
    res.status(201).json(created(serializeUser(row), req));
  }),
);

router.patch(
  "/customers/:cid/users/:id",
  requireCrmApiKey("users:write"),
  idempotency(),
  asyncRoute(async (req, res) => {
    const parse = userPatchSchema.safeParse(req.body);
    if (!parse.success) throw Errors.unprocessable("Invalid user patch", parse.error.issues);
    const [before] = await db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.id, req.params.id), eq(usersTable.organisationId, req.params.cid)))
      .limit(1);
    if (!before) throw Errors.notFound("User", req.params.id);
    const patch: Partial<typeof usersTable.$inferInsert> = { updatedAt: new Date() };
    if (parse.data.name !== undefined) patch.name = parse.data.name;
    if (parse.data.role !== undefined) patch.role = parse.data.role;
    const [updated] = await db.update(usersTable).set(patch).where(eq(usersTable.id, req.params.id)).returning();
    await logAudit({
      req,
      action: "user.updated",
      resourceType: "user",
      resourceId: req.params.id,
      organisationId: req.params.cid,
      previousValue: serializeUser(before),
      newValue: serializeUser(updated),
      details: { event: "user.updated" },
    });
    res.json(ok(serializeUser(updated), req));
  }),
);

router.post(
  "/customers/:cid/users/:id/suspend",
  requireCrmApiKey("users:write"),
  idempotency(),
  asyncRoute(async (req, res) => {
    const parsed = z.object({ reason_code: reasonCodeSchema, reason_note: z.string().max(500).optional() }).safeParse(req.body);
    if (!parsed.success) throw Errors.badRequest("Invalid lifecycle payload", parsed.error.issues);
    const [before] = await db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.id, req.params.id), eq(usersTable.organisationId, req.params.cid)))
      .limit(1);
    if (!before) throw Errors.notFound("User", req.params.id);
    const [updated] = await db
      .update(usersTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(usersTable.id, req.params.id))
      .returning();
    await logAudit({
      req,
      action: "user.suspended",
      resourceType: "user",
      resourceId: req.params.id,
      organisationId: req.params.cid,
      reasonCode: parsed.data.reason_code,
      previousValue: { is_active: before.isActive },
      newValue: { is_active: false },
      details: { event: "user.suspended", reason_note: parsed.data.reason_note },
    });
    res.json(ok(serializeUser(updated), req));
  }),
);

router.post(
  "/customers/:cid/users/:id/reactivate",
  requireCrmApiKey("users:write"),
  idempotency(),
  asyncRoute(async (req, res) => {
    const parsed = z.object({ reason_code: reasonCodeSchema, reason_note: z.string().max(500).optional() }).safeParse(req.body);
    if (!parsed.success) throw Errors.badRequest("Invalid lifecycle payload", parsed.error.issues);
    const [before] = await db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.id, req.params.id), eq(usersTable.organisationId, req.params.cid)))
      .limit(1);
    if (!before) throw Errors.notFound("User", req.params.id);
    const [updated] = await db
      .update(usersTable)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(usersTable.id, req.params.id))
      .returning();
    await logAudit({
      req,
      action: "user.reactivated",
      resourceType: "user",
      resourceId: req.params.id,
      organisationId: req.params.cid,
      reasonCode: parsed.data.reason_code,
      previousValue: { is_active: before.isActive },
      newValue: { is_active: true },
      details: { event: "user.reactivated", reason_note: parsed.data.reason_note },
    });
    res.json(ok(serializeUser(updated), req));
  }),
);

/* ============================================================ */
/* Subscriptions                                                */
/* ============================================================ */

function serializeSubscription(s: typeof subscriptionsTable.$inferSelect) {
  return {
    id: s.id,
    customer_id: s.organisationId,
    organisation_id: s.organisationId,
    plan_code: s.planCode,
    status: s.status,
    pricing_tier: s.pricingTier,
    support_tier: s.supportTier,
    contract_status: s.contractStatus,
    billing_status: s.billingStatus,
    start_date: s.startDate,
    end_date: s.endDate,
    renewal_date: s.renewalDate,
    is_credit_hold: s.isCreditHold,
    entitlements: s.entitlements,
    addons: s.addons ?? [],
    monthly_price: s.monthlyPrice,
    currency: s.currency,
    cancelled_at: s.cancelledAt,
    cancel_reason: s.cancelReason,
    suspended_at: s.suspendedAt,
    suspend_reason: s.suspendReason,
    source_system: s.sourceSystem,
    created_by: s.createdBy,
    updated_by: s.updatedBy,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

const subCreateSchema = z.object({
  plan_code: z.string().min(1).max(80),
  status: z.enum(["active", "pending", "suspended", "disabled", "archived", "cancelled"]).default("active"),
  pricing_tier: z.string().max(40).optional().nullable(),
  support_tier: z.string().max(40).optional().nullable(),
  start_date: z.coerce.date().optional(),
  end_date: z.coerce.date().optional().nullable(),
  renewal_date: z.coerce.date().optional().nullable(),
  entitlements: z.record(z.string(), z.unknown()).optional(),
  addons: z.array(z.string()).optional(),
  monthly_price: z.number().nonnegative().optional().nullable(),
  currency: z.string().length(3).optional(),
});

router.get(
  "/customers/:cid/subscriptions",
  requireCrmApiKey("subscriptions:read"),
  asyncRoute(async (req, res) => {
    await assertCustomer(req.params.cid);
    const q = pageQuery.parse(req.query);
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.organisationId, req.params.cid));
    const rows = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.organisationId, req.params.cid))
      .orderBy(desc(subscriptionsTable.createdAt))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    res.json(paginated(rows.map(serializeSubscription), { ...q, total }, req));
  }),
);

router.post(
  "/customers/:cid/subscriptions",
  requireCrmApiKey("subscriptions:write"),
  idempotency(),
  asyncRoute(async (req, res) => {
    await assertCustomer(req.params.cid);
    const parse = subCreateSchema.safeParse(req.body);
    if (!parse.success) throw Errors.unprocessable("Invalid subscription payload", parse.error.issues);
    const b = parse.data;
    const id = uuidv4();
    const [row] = await db
      .insert(subscriptionsTable)
      .values({
        id,
        organisationId: req.params.cid,
        planCode: b.plan_code,
        status: b.status,
        pricingTier: b.pricing_tier ?? undefined,
        supportTier: b.support_tier ?? undefined,
        startDate: b.start_date ?? new Date(),
        endDate: b.end_date ?? undefined,
        renewalDate: b.renewal_date ?? undefined,
        entitlements: b.entitlements,
        addons: b.addons,
        monthlyPrice: b.monthly_price ?? undefined,
        currency: b.currency ?? "NZD",
        sourceSystem: "fgc-crm",
        createdBy: req.crmApiKey?.prefix,
        updatedBy: req.crmApiKey?.prefix,
      })
      .returning();
    await logAudit({
      req,
      action: "subscription.created",
      resourceType: "subscription",
      resourceId: id,
      organisationId: req.params.cid,
      newValue: serializeSubscription(row),
      details: { event: "subscription.created" },
    });
    res.status(201).json(created(serializeSubscription(row), req));
  }),
);

router.post(
  "/customers/:cid/subscriptions/:id/cancel",
  requireCrmApiKey("subscriptions:write"),
  idempotency(),
  asyncRoute(async (req, res) => {
    const parsed = z
      .object({ reason_code: reasonCodeSchema, reason_note: z.string().max(500).optional() })
      .safeParse(req.body);
    if (!parsed.success) throw Errors.badRequest("Invalid lifecycle payload", parsed.error.issues);
    const [before] = await db
      .select()
      .from(subscriptionsTable)
      .where(and(eq(subscriptionsTable.id, req.params.id), eq(subscriptionsTable.organisationId, req.params.cid)))
      .limit(1);
    if (!before) throw Errors.notFound("Subscription", req.params.id);
    const [updated] = await db
      .update(subscriptionsTable)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelReason: parsed.data.reason_code,
        updatedAt: new Date(),
        updatedBy: req.crmApiKey?.prefix,
      })
      .where(eq(subscriptionsTable.id, req.params.id))
      .returning();
    await logAudit({
      req,
      action: "subscription.cancelled",
      resourceType: "subscription",
      resourceId: req.params.id,
      organisationId: req.params.cid,
      reasonCode: parsed.data.reason_code,
      previousValue: { status: before.status },
      newValue: { status: "cancelled" },
      details: { event: "subscription.cancelled", reason_note: parsed.data.reason_note },
    });
    res.json(ok(serializeSubscription(updated), req));
  }),
);

/* ============================================================ */
/* Billing Profile                                              */
/* ============================================================ */

function serializeBillingProfile(b: typeof billingProfilesTable.$inferSelect) {
  return {
    id: b.id,
    customer_id: b.organisationId,
    organisation_id: b.organisationId,
    billing_legal_entity_name: b.billingLegalEntityName,
    billing_contact_id: b.billingContactId,
    billing_email: b.billingEmail,
    accounts_payable_email: b.accountsPayableEmail,
    invoice_email: b.invoiceEmail,
    purchase_order_number: b.purchaseOrderNumber,
    tax_number: b.taxNumber,
    billing_address: b.billingAddress,
    shipping_address: b.shippingAddress,
    currency: b.currency,
    payment_terms: b.paymentTerms,
    payment_method_token: b.paymentMethodToken,
    direct_debit_status: b.directDebitStatus,
    invoice_delivery_method: b.invoiceDeliveryMethod,
    invoice_grouping_rules: b.invoiceGroupingRules,
    statement_cycle: b.statementCycle,
    suspension_threshold: b.suspensionThreshold,
    collections_status: b.collectionsStatus,
    is_credit_hold: b.isCreditHold,
    credit_hold_reason: b.creditHoldReason,
    credit_hold_at: b.creditHoldAt,
    source_system: b.sourceSystem,
    created_by: b.createdBy,
    updated_by: b.updatedBy,
    created_at: b.createdAt,
    updated_at: b.updatedAt,
  };
}

const billingUpsertSchema = z.object({
  billing_legal_entity_name: z.string().max(200).optional().nullable(),
  billing_contact_id: z.string().optional().nullable(),
  billing_email: z.string().email().optional().nullable(),
  accounts_payable_email: z.string().email().optional().nullable(),
  invoice_email: z.string().email().optional().nullable(),
  purchase_order_number: z.string().max(80).optional().nullable(),
  tax_number: z.string().max(64).optional().nullable(),
  billing_address: z.record(z.string(), z.unknown()).optional().nullable(),
  shipping_address: z.record(z.string(), z.unknown()).optional().nullable(),
  currency: z.string().length(3).optional(),
  payment_terms: z.string().max(80).optional().nullable(),
  payment_method_token: z.string().max(200).optional().nullable(),
  direct_debit_status: z.string().max(40).optional().nullable(),
  invoice_delivery_method: z.enum(["email", "post", "portal"]).optional().nullable(),
  statement_cycle: z.enum(["monthly", "quarterly", "annual"]).optional().nullable(),
  suspension_threshold: z.number().nonnegative().optional().nullable(),
  collections_status: z.string().max(40).optional().nullable(),
});

router.get(
  "/customers/:cid/billing-profile",
  requireCrmApiKey("billing:read"),
  asyncRoute(async (req, res) => {
    await assertCustomer(req.params.cid);
    const [row] = await db
      .select()
      .from(billingProfilesTable)
      .where(eq(billingProfilesTable.organisationId, req.params.cid))
      .limit(1);
    if (!row) throw Errors.notFound("BillingProfile", req.params.cid);
    res.json(ok(serializeBillingProfile(row), req));
  }),
);

router.put(
  "/customers/:cid/billing-profile",
  requireCrmApiKey("billing:write"),
  idempotency(),
  asyncRoute(async (req, res) => {
    await assertCustomer(req.params.cid);
    const parse = billingUpsertSchema.safeParse(req.body);
    if (!parse.success) throw Errors.unprocessable("Invalid billing profile payload", parse.error.issues);
    const b = parse.data;
    const [existing] = await db
      .select()
      .from(billingProfilesTable)
      .where(eq(billingProfilesTable.organisationId, req.params.cid))
      .limit(1);

    const dbValues = {
      billingLegalEntityName: b.billing_legal_entity_name ?? null,
      billingContactId: b.billing_contact_id ?? null,
      billingEmail: b.billing_email ?? null,
      accountsPayableEmail: b.accounts_payable_email ?? null,
      invoiceEmail: b.invoice_email ?? null,
      purchaseOrderNumber: b.purchase_order_number ?? null,
      taxNumber: b.tax_number ?? null,
      billingAddress: (b.billing_address ?? null) as Record<string, unknown> | null,
      shippingAddress: (b.shipping_address ?? null) as Record<string, unknown> | null,
      currency: b.currency ?? "NZD",
      paymentTerms: b.payment_terms ?? null,
      paymentMethodToken: b.payment_method_token ?? null,
      directDebitStatus: b.direct_debit_status ?? null,
      invoiceDeliveryMethod: b.invoice_delivery_method ?? null,
      statementCycle: b.statement_cycle ?? null,
      suspensionThreshold: b.suspension_threshold ?? null,
      collectionsStatus: b.collections_status ?? null,
      updatedAt: new Date(),
      updatedBy: req.crmApiKey?.prefix,
    };

    let row: typeof billingProfilesTable.$inferSelect;
    if (existing) {
      [row] = await db
        .update(billingProfilesTable)
        .set(dbValues)
        .where(eq(billingProfilesTable.id, existing.id))
        .returning();
    } else {
      [row] = await db
        .insert(billingProfilesTable)
        .values({
          id: uuidv4(),
          organisationId: req.params.cid,
          ...dbValues,
          sourceSystem: "fgc-crm",
          createdBy: req.crmApiKey?.prefix,
        })
        .returning();
    }
    await logAudit({
      req,
      action: existing ? "billing_profile.updated" : "billing_profile.created",
      resourceType: "billing_profile",
      resourceId: row.id,
      organisationId: req.params.cid,
      previousValue: existing ? serializeBillingProfile(existing) : null,
      newValue: serializeBillingProfile(row),
      details: { event: existing ? "billing_profile.updated" : "billing_profile.created" },
    });
    res.json(ok(serializeBillingProfile(row), req));
  }),
);

router.post(
  "/customers/:cid/billing-profile/credit-hold",
  requireCrmApiKey("billing:write"),
  idempotency(),
  asyncRoute(async (req, res) => {
    const parse = z
      .object({
        on: z.boolean(),
        reason_code: reasonCodeSchema,
        reason_note: z.string().max(500).optional(),
      })
      .safeParse(req.body);
    if (!parse.success) throw Errors.badRequest("Invalid credit-hold payload", parse.error.issues);
    const [existing] = await db
      .select()
      .from(billingProfilesTable)
      .where(eq(billingProfilesTable.organisationId, req.params.cid))
      .limit(1);
    if (!existing) throw Errors.notFound("BillingProfile", req.params.cid);
    const [updated] = await db
      .update(billingProfilesTable)
      .set({
        isCreditHold: parse.data.on,
        creditHoldReason: parse.data.on ? parse.data.reason_code : null,
        creditHoldAt: parse.data.on ? new Date() : null,
        updatedAt: new Date(),
        updatedBy: req.crmApiKey?.prefix,
      })
      .where(eq(billingProfilesTable.id, existing.id))
      .returning();
    await logAudit({
      req,
      action: parse.data.on ? "billing_profile.credit_hold_applied" : "billing_profile.credit_hold_released",
      resourceType: "billing_profile",
      resourceId: existing.id,
      organisationId: req.params.cid,
      reasonCode: parse.data.reason_code,
      previousValue: { is_credit_hold: existing.isCreditHold },
      newValue: { is_credit_hold: parse.data.on },
      details: {
        event: parse.data.on ? "billing_profile.credit_hold_applied" : "billing_profile.credit_hold_released",
        reason_note: parse.data.reason_note,
      },
    });
    res.json(ok(serializeBillingProfile(updated), req));
  }),
);

/* ============================================================ */
/* Provisioning Requests                                        */
/* ============================================================ */

function serializeProvisioning(p: typeof provisioningRequestsTable.$inferSelect) {
  return {
    id: p.id,
    customer_id: p.organisationId,
    organisation_id: p.organisationId,
    product_code: p.productCode,
    service_instance_id: p.serviceInstanceId,
    environment: p.environment,
    status: p.status,
    request_payload: p.requestPayload,
    result_payload: p.resultPayload,
    error_message: p.errorMessage,
    requested_by: p.requestedBy,
    approved_by: p.approvedBy,
    approved_at: p.approvedAt,
    completed_at: p.completedAt,
    correlation_id: p.correlationId,
    source_system: p.sourceSystem,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

const provCreateSchema = z.object({
  product_code: z.string().min(1).max(80),
  environment: z.enum(["production", "sandbox", "staging", "development"]).default("production"),
  request_payload: z.record(z.string(), z.unknown()).optional(),
});

router.get(
  "/customers/:cid/provisioning-requests",
  requireCrmApiKey("provisioning:read"),
  asyncRoute(async (req, res) => {
    await assertCustomer(req.params.cid);
    const q = pageQuery.parse(req.query);
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(provisioningRequestsTable)
      .where(eq(provisioningRequestsTable.organisationId, req.params.cid));
    const rows = await db
      .select()
      .from(provisioningRequestsTable)
      .where(eq(provisioningRequestsTable.organisationId, req.params.cid))
      .orderBy(desc(provisioningRequestsTable.createdAt))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    res.json(paginated(rows.map(serializeProvisioning), { ...q, total }, req));
  }),
);

router.post(
  "/customers/:cid/provisioning-requests",
  requireCrmApiKey("provisioning:write"),
  idempotency(),
  asyncRoute(async (req, res) => {
    await assertCustomer(req.params.cid);
    const parse = provCreateSchema.safeParse(req.body);
    if (!parse.success) throw Errors.unprocessable("Invalid provisioning payload", parse.error.issues);
    const id = uuidv4();
    const [row] = await db
      .insert(provisioningRequestsTable)
      .values({
        id,
        organisationId: req.params.cid,
        customerId: req.params.cid,
        productCode: parse.data.product_code,
        environment: parse.data.environment,
        requestPayload: parse.data.request_payload,
        requestedBy: req.crmApiKey?.prefix,
        correlationId: req.correlationId,
        sourceSystem: "fgc-crm",
      })
      .returning();
    await logAudit({
      req,
      action: "provisioning.requested",
      resourceType: "provisioning_request",
      resourceId: id,
      organisationId: req.params.cid,
      newValue: serializeProvisioning(row),
      details: { event: "provisioning.requested" },
    });
    res.status(201).json(created(serializeProvisioning(row), req));
  }),
);

router.get(
  "/customers/:cid/provisioning-requests/:id",
  requireCrmApiKey("provisioning:read"),
  asyncRoute(async (req, res) => {
    const [row] = await db
      .select()
      .from(provisioningRequestsTable)
      .where(
        and(
          eq(provisioningRequestsTable.id, req.params.id),
          eq(provisioningRequestsTable.organisationId, req.params.cid),
        ),
      )
      .limit(1);
    if (!row) throw Errors.notFound("ProvisioningRequest", req.params.id);
    res.json(ok(serializeProvisioning(row), req));
  }),
);

/* ============================================================ */
/* Tickets                                                      */
/* ============================================================ */

function serializeTicket(t: typeof supportTicketsTable.$inferSelect) {
  return {
    id: t.id,
    customer_id: t.organisationId,
    organisation_id: t.organisationId,
    contact_id: t.contactId,
    subject: t.subject,
    description: t.description,
    category: t.category,
    severity: t.severity,
    status: t.status,
    assigned_to: t.assignedTo,
    escalation_level: t.escalationLevel,
    escalated_at: t.escalatedAt,
    resolved_at: t.resolvedAt,
    closed_at: t.closedAt,
    resolution: t.resolution,
    tags: t.tags ?? [],
    external_ticket_id: t.externalTicketId,
    external_system: t.externalSystem,
    source_system: t.sourceSystem,
    created_by: t.createdBy,
    updated_by: t.updatedBy,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

const ticketCreateSchema = z.object({
  subject: z.string().min(1).max(200),
  description: z.string().max(8000).optional().nullable(),
  category: z.string().max(80).optional().nullable(),
  severity: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  contact_id: z.string().optional().nullable(),
  assigned_to: z.string().max(120).optional().nullable(),
  external_ticket_id: z.string().max(120).optional().nullable(),
  external_system: z.string().max(40).optional().nullable(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

const ticketPatchSchema = z.object({
  subject: z.string().min(1).max(200).optional(),
  description: z.string().max(8000).optional().nullable(),
  category: z.string().max(80).optional().nullable(),
  severity: z.enum(["critical", "high", "medium", "low"]).optional(),
  status: z
    .enum(["open", "in_progress", "waiting_on_customer", "resolved", "closed", "cancelled"])
    .optional(),
  assigned_to: z.string().max(120).optional().nullable(),
  resolution: z.string().max(8000).optional().nullable(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

router.get(
  "/customers/:cid/tickets",
  requireCrmApiKey("tickets:read"),
  asyncRoute(async (req, res) => {
    await assertCustomer(req.params.cid);
    const q = pageQuery.parse(req.query);
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(supportTicketsTable)
      .where(eq(supportTicketsTable.organisationId, req.params.cid));
    const rows = await db
      .select()
      .from(supportTicketsTable)
      .where(eq(supportTicketsTable.organisationId, req.params.cid))
      .orderBy(desc(supportTicketsTable.createdAt))
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    res.json(paginated(rows.map(serializeTicket), { ...q, total }, req));
  }),
);

router.post(
  "/customers/:cid/tickets",
  requireCrmApiKey("tickets:write"),
  idempotency(),
  asyncRoute(async (req, res) => {
    await assertCustomer(req.params.cid);
    const parse = ticketCreateSchema.safeParse(req.body);
    if (!parse.success) throw Errors.unprocessable("Invalid ticket payload", parse.error.issues);
    const b = parse.data;
    const id = uuidv4();
    const [row] = await db
      .insert(supportTicketsTable)
      .values({
        id,
        organisationId: req.params.cid,
        contactId: b.contact_id ?? undefined,
        subject: b.subject,
        description: b.description ?? undefined,
        category: b.category ?? undefined,
        severity: b.severity,
        assignedTo: b.assigned_to ?? undefined,
        externalTicketId: b.external_ticket_id ?? undefined,
        externalSystem: b.external_system ?? undefined,
        tags: b.tags,
        sourceSystem: "fgc-crm",
        createdBy: req.crmApiKey?.prefix,
        updatedBy: req.crmApiKey?.prefix,
      })
      .returning();
    await logAudit({
      req,
      action: "ticket.created",
      resourceType: "support_ticket",
      resourceId: id,
      organisationId: req.params.cid,
      newValue: serializeTicket(row),
      details: { event: "ticket.created" },
    });
    res.status(201).json(created(serializeTicket(row), req));
  }),
);

router.patch(
  "/customers/:cid/tickets/:id",
  requireCrmApiKey("tickets:write"),
  idempotency(),
  asyncRoute(async (req, res) => {
    const parse = ticketPatchSchema.safeParse(req.body);
    if (!parse.success) throw Errors.unprocessable("Invalid ticket patch", parse.error.issues);
    const [before] = await db
      .select()
      .from(supportTicketsTable)
      .where(and(eq(supportTicketsTable.id, req.params.id), eq(supportTicketsTable.organisationId, req.params.cid)))
      .limit(1);
    if (!before) throw Errors.notFound("Ticket", req.params.id);
    const patch: Partial<typeof supportTicketsTable.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: req.crmApiKey?.prefix,
    };
    const b = parse.data;
    if (b.subject !== undefined) patch.subject = b.subject;
    if (b.description !== undefined) patch.description = b.description ?? null;
    if (b.category !== undefined) patch.category = b.category ?? null;
    if (b.severity !== undefined) patch.severity = b.severity;
    if (b.status !== undefined) {
      patch.status = b.status;
      if (b.status === "resolved" && !before.resolvedAt) patch.resolvedAt = new Date();
      if (b.status === "closed" && !before.closedAt) patch.closedAt = new Date();
    }
    if (b.assigned_to !== undefined) patch.assignedTo = b.assigned_to ?? null;
    if (b.resolution !== undefined) patch.resolution = b.resolution ?? null;
    if (b.tags !== undefined) patch.tags = b.tags;
    const [updated] = await db
      .update(supportTicketsTable)
      .set(patch)
      .where(eq(supportTicketsTable.id, req.params.id))
      .returning();
    await logAudit({
      req,
      action: "ticket.updated",
      resourceType: "support_ticket",
      resourceId: req.params.id,
      organisationId: req.params.cid,
      previousValue: serializeTicket(before),
      newValue: serializeTicket(updated),
      details: { event: "ticket.updated" },
    });
    res.json(ok(serializeTicket(updated), req));
  }),
);

router.post(
  "/customers/:cid/tickets/:id/escalate",
  requireCrmApiKey("tickets:write"),
  idempotency(),
  asyncRoute(async (req, res) => {
    const parse = z
      .object({
        escalation_level: z.string().min(1).max(20),
        reason_code: reasonCodeSchema,
        reason_note: z.string().max(500).optional(),
      })
      .safeParse(req.body);
    if (!parse.success) throw Errors.badRequest("Invalid escalation payload", parse.error.issues);
    const [before] = await db
      .select()
      .from(supportTicketsTable)
      .where(and(eq(supportTicketsTable.id, req.params.id), eq(supportTicketsTable.organisationId, req.params.cid)))
      .limit(1);
    if (!before) throw Errors.notFound("Ticket", req.params.id);
    const [updated] = await db
      .update(supportTicketsTable)
      .set({
        escalationLevel: parse.data.escalation_level,
        escalatedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: req.crmApiKey?.prefix,
      })
      .where(eq(supportTicketsTable.id, req.params.id))
      .returning();
    await logAudit({
      req,
      action: "ticket.escalated",
      resourceType: "support_ticket",
      resourceId: req.params.id,
      organisationId: req.params.cid,
      reasonCode: parse.data.reason_code,
      previousValue: { escalation_level: before.escalationLevel },
      newValue: { escalation_level: parse.data.escalation_level },
      details: { event: "ticket.escalated", reason_note: parse.data.reason_note },
    });
    res.json(ok(serializeTicket(updated), req));
  }),
);

export default router;
