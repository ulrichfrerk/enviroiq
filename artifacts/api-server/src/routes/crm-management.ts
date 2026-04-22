/**
 * Management API alias router.
 *
 * Mounted at /api/management. Provides URL-compatible aliases for external
 * CRMs / portals that expect the conventional "tenants" naming, mapped onto
 * the same data and auth as the FGC /api/v1/customers endpoints.
 *
 * In EnviroIQ, one tenant === one organisation === one CRM customer.
 */
import { Router } from "express";
import { db, organisationsTable } from "@workspace/db";
import { eq, and, asc, desc, ilike, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireCrmApiKey } from "../lib/crm-api-auth.js";
import { ok, paginated, Errors, asyncRoute } from "../lib/api-response.js";

const router = Router();

function serializeTenant(o: typeof organisationsTable.$inferSelect) {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    legal_entity_name: o.legalEntityName,
    trading_name: o.tradingName,
    industry: o.industry,
    country: o.country,
    account_type: o.accountType,
    commercial_status: o.commercialStatus,
    onboarding_status: o.onboardingStatus,
    plan: o.plan,
    billing_status: o.billingStatus,
    is_active: o.isActive,
    contract_start_date: o.contractStartDate,
    contract_end_date: o.contractEndDate,
    renewal_date: o.renewalDate,
    created_at: o.createdAt,
    updated_at: o.updatedAt,
  };
}

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().optional(),
  account_type: z.enum(["prospect", "active_customer", "suspended", "closed"]).optional(),
  industry: z.string().optional(),
  country: z.string().optional(),
  sort: z.enum(["created_at", "updated_at", "name"]).default("created_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

router.get(
  "/tenants",
  requireCrmApiKey("customers:read"),
  asyncRoute(async (req, res) => {
    const parse = listQuery.safeParse(req.query);
    if (!parse.success) throw Errors.badRequest("Invalid query parameters", parse.error.issues);
    const q = parse.data;

    const filters: ReturnType<typeof eq>[] = [];
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
      paginated(rows.map(serializeTenant), { page: q.page, limit: q.limit, total }, req),
    );
  }),
);

router.get(
  "/tenants/:id",
  requireCrmApiKey("customers:read"),
  asyncRoute(async (req, res) => {
    const [row] = await db
      .select()
      .from(organisationsTable)
      .where(eq(organisationsTable.id, req.params.id))
      .limit(1);
    if (!row) throw Errors.notFound("Tenant", req.params.id);
    res.json(ok(serializeTenant(row), req));
  }),
);

export default router;
