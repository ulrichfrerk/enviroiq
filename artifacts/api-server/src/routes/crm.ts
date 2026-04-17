/**
 * CRM Integration API — versioned at /api/v1/*
 *
 * Authenticated via Bearer API keys (see lib/crm-api-auth.ts). Designed for a
 * sister CRM application to programmatically:
 *   - provision new customers (organisations + admin user with magic link)
 *   - manage user access (invite, deactivate)
 *   - lock / unlock accounts (suspend access)
 *   - update billing plan and status
 *   - pull live ESG metrics + supplier audit status to sync into the CRM
 *
 * All write endpoints emit an audit_logs row with the API key prefix in details
 * so every CRM action is traceable.
 */
import { Router } from "express";
import { randomBytes } from "crypto";
import { db, organisationsTable, usersTable, magicLinksTable } from "@workspace/db";
import { eq, sql, count, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { requireCrmApiKey } from "../lib/crm-api-auth.js";
import { logAudit } from "../lib/audit.js";
import { sendInviteEmail } from "../lib/mailer.js";

const router = Router();

function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
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
function appBase(): string {
  return (
    process.env.APP_BASE_URL ||
    `https://${process.env.REPLIT_DOMAINS?.split(",")[0]?.trim() ?? "enviroiq.net"}/app`
  );
}

const VALID_PLANS = new Set(["operate", "assure", "enterprise"]);
const VALID_BILLING_STATUSES = new Set(["active", "trialing", "past_due", "suspended"]);
const VALID_USER_ROLES = new Set(["org_admin", "org_user", "org_viewer", "org_auditor"]);

/* ------------------------------------------------------------------ */
/* Sanity                                                              */
/* ------------------------------------------------------------------ */

// GET /api/v1/ping — confirm key is alive
router.get("/ping", requireCrmApiKey(), (req, res) => {
  res.json({
    ok: true,
    keyPrefix: req.crmApiKey?.prefix,
    keyName: req.crmApiKey?.name,
    scopes: req.crmApiKey?.scopes,
    serverTime: new Date().toISOString(),
  });
});

/* ------------------------------------------------------------------ */
/* Customers (= organisations)                                         */
/* ------------------------------------------------------------------ */

// GET /api/v1/customers
router.get("/customers", requireCrmApiKey("customers:read"), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1")) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50")) || 50));
    const offset = (page - 1) * limit;

    const [items, [{ total }]] = await Promise.all([
      db.select().from(organisationsTable).limit(limit).offset(offset),
      db.select({ total: count() }).from(organisationsTable),
    ]);

    res.json({
      items: items.map(serializeCustomer),
      total: Number(total) || 0,
      page,
      limit,
    });
  } catch (err) {
    req.log.error({ err }, "CRM list customers failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// POST /api/v1/customers — provision a new customer
router.post("/customers", requireCrmApiKey("customers:write"), async (req, res) => {
  try {
    const { name, industry, country, adminEmail, adminName, plan, sendInvite } = req.body as {
      name?: string;
      industry?: string;
      country?: string;
      adminEmail?: string;
      adminName?: string;
      plan?: string;
      sendInvite?: boolean;
    };
    if (!name || !adminEmail || !adminName) {
      res.status(400).json({
        error: "Bad Request",
        message: "name, adminEmail and adminName are required",
      });
      return;
    }
    if (plan && !VALID_PLANS.has(plan)) {
      res.status(400).json({ error: "Bad Request", message: `plan must be one of ${[...VALID_PLANS].join(", ")}` });
      return;
    }

    const slug = generateSlug(name);
    const orgId = uuidv4();
    const widgetKey = generateWidgetKey();
    const webhookSecret = generateWebhookSecret();
    const inboundEmail = generateInboundEmail(slug);

    const [org] = await db
      .insert(organisationsTable)
      .values({
        id: orgId,
        name,
        slug,
        industry,
        country,
        widgetKey,
        webhookSecret,
        inboundEmailAddress: inboundEmail,
      })
      .returning();

    let adminUser = await db.query.usersTable.findFirst({ where: eq(usersTable.email, adminEmail) });
    if (!adminUser) {
      const [created] = await db
        .insert(usersTable)
        .values({
          id: uuidv4(),
          email: adminEmail,
          name: adminName,
          role: "org_admin",
          organisationId: orgId,
        })
        .returning();
      adminUser = created;
    } else {
      await db
        .update(usersTable)
        .set({ organisationId: orgId, role: "org_admin", updatedAt: new Date() })
        .where(eq(usersTable.id, adminUser.id));
    }

    if (plan) {
      await db.update(organisationsTable).set({ plan, updatedAt: new Date() }).where(eq(organisationsTable.id, orgId));
    }

    // Generate magic link so the CRM can deliver the welcome email or hand it back
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.insert(magicLinksTable).values({ id: uuidv4(), userId: adminUser.id, token, expiresAt });
    const magicUrl = `${appBase()}/auth/verify?token=${token}`;

    if (sendInvite !== false) {
      try {
        await sendInviteEmail({ to: adminEmail, name: adminName, organisationName: name, magicUrl });
      } catch (err) {
        req.log.warn({ err }, "CRM customer create: invite email failed (link still returned)");
      }
    }

    await logAudit({
      req,
      action: "crm.customer.create",
      resourceType: "organisation",
      resourceId: orgId,
      organisationId: orgId,
      details: { keyPrefix: req.crmApiKey?.prefix, name, adminEmail, plan: plan ?? null },
    });

    res.status(201).json({
      customer: serializeCustomer(org),
      adminUser: { id: adminUser.id, email: adminUser.email, name: adminUser.name, role: adminUser.role },
      magicLink: { url: magicUrl, expiresAt },
    });
  } catch (err) {
    req.log.error({ err }, "CRM create customer failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// GET /api/v1/customers/:id
router.get("/customers/:id", requireCrmApiKey("customers:read"), async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const org = await db.query.organisationsTable.findFirst({ where: eq(organisationsTable.id, id) });
    if (!org) {
      res.status(404).json({ error: "Not Found", message: "Customer not found" });
      return;
    }
    res.json({ customer: serializeCustomer(org) });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// PATCH /api/v1/customers/:id — update profile, lock/unlock
router.patch("/customers/:id", requireCrmApiKey("customers:write"), async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const { name, industry, country, isActive } = req.body as {
      name?: string;
      industry?: string;
      country?: string;
      isActive?: boolean;
    };
    const updates: Partial<typeof organisationsTable.$inferInsert> = { updatedAt: new Date() };
    if (typeof name === "string") updates.name = name;
    if (typeof industry === "string") updates.industry = industry;
    if (typeof country === "string") updates.country = country;
    if (typeof isActive === "boolean") updates.isActive = isActive;

    const [org] = await db
      .update(organisationsTable)
      .set(updates)
      .where(eq(organisationsTable.id, id))
      .returning();

    if (!org) {
      res.status(404).json({ error: "Not Found", message: "Customer not found" });
      return;
    }

    await logAudit({
      req,
      action: "crm.customer.update",
      resourceType: "organisation",
      resourceId: id,
      organisationId: id,
      details: { keyPrefix: req.crmApiKey?.prefix, ...updates },
    });

    res.json({ customer: serializeCustomer(org) });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// POST /api/v1/customers/:id/lock — convenience: lock account
router.post("/customers/:id/lock", requireCrmApiKey("customers:write"), async (req, res) => {
  return setActive(req, res, false, "crm.customer.lock");
});
// POST /api/v1/customers/:id/unlock
router.post("/customers/:id/unlock", requireCrmApiKey("customers:write"), async (req, res) => {
  return setActive(req, res, true, "crm.customer.unlock");
});

async function setActive(
  req: import("express").Request,
  res: import("express").Response,
  isActive: boolean,
  action: string,
) {
  try {
    const { id } = req.params as { id: string };
    const [org] = await db
      .update(organisationsTable)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(organisationsTable.id, id))
      .returning();
    if (!org) {
      res.status(404).json({ error: "Not Found", message: "Customer not found" });
      return;
    }
    await logAudit({
      req,
      action,
      resourceType: "organisation",
      resourceId: id,
      organisationId: id,
      details: { keyPrefix: req.crmApiKey?.prefix },
    });
    res.json({ customer: serializeCustomer(org) });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

// GET /api/v1/customers/:id/users
router.get("/customers/:id/users", requireCrmApiKey("users:read"), async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const users = await db.query.usersTable.findMany({
      where: eq(usersTable.organisationId, id),
    });
    res.json({
      items: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// POST /api/v1/customers/:id/users — invite a new user (or attach existing)
router.post("/customers/:id/users", requireCrmApiKey("users:write"), async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const { email, name, role, sendInvite } = req.body as {
      email?: string;
      name?: string;
      role?: string;
      sendInvite?: boolean;
    };
    if (!email || !name) {
      res.status(400).json({ error: "Bad Request", message: "email and name are required" });
      return;
    }
    const finalRole = role && VALID_USER_ROLES.has(role) ? role : "org_user";

    const org = await db.query.organisationsTable.findFirst({
      where: eq(organisationsTable.id, id),
    });
    if (!org) {
      res.status(404).json({ error: "Not Found", message: "Customer not found" });
      return;
    }

    let user = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email) });
    if (!user) {
      const [created] = await db
        .insert(usersTable)
        .values({
          id: uuidv4(),
          email,
          name,
          role: finalRole,
          organisationId: id,
        })
        .returning();
      user = created;
    } else {
      await db
        .update(usersTable)
        .set({ organisationId: id, role: finalRole, isActive: true, updatedAt: new Date() })
        .where(eq(usersTable.id, user.id));
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.insert(magicLinksTable).values({ id: uuidv4(), userId: user.id, token, expiresAt });
    const magicUrl = `${appBase()}/auth/verify?token=${token}`;

    if (sendInvite !== false) {
      try {
        await sendInviteEmail({ to: email, name, organisationName: org.name, magicUrl });
      } catch (err) {
        req.log.warn({ err }, "CRM user invite email failed (link still returned)");
      }
    }

    await logAudit({
      req,
      action: "crm.user.invite",
      resourceType: "user",
      resourceId: user.id,
      organisationId: id,
      details: { keyPrefix: req.crmApiKey?.prefix, email, role: finalRole },
    });

    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name, role: finalRole, isActive: true },
      magicLink: { url: magicUrl, expiresAt },
    });
  } catch (err) {
    req.log.error({ err }, "CRM invite user failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// PATCH /api/v1/customers/:id/users/:userId — update role / activate / deactivate
router.patch(
  "/customers/:id/users/:userId",
  requireCrmApiKey("users:write"),
  async (req, res) => {
    try {
      const { id, userId } = req.params as { id: string; userId: string };
      const { role, isActive } = req.body as { role?: string; isActive?: boolean };
      const updates: Partial<typeof usersTable.$inferInsert> = { updatedAt: new Date() };
      if (role) {
        if (!VALID_USER_ROLES.has(role)) {
          res.status(400).json({ error: "Bad Request", message: "Invalid role" });
          return;
        }
        updates.role = role;
      }
      if (typeof isActive === "boolean") updates.isActive = isActive;

      const [user] = await db
        .update(usersTable)
        .set(updates)
        .where(and(eq(usersTable.id, userId), eq(usersTable.organisationId, id)))
        .returning();
      if (!user) {
        res.status(404).json({ error: "Not Found", message: "User not found in this customer" });
        return;
      }
      await logAudit({
        req,
        action: "crm.user.update",
        resourceType: "user",
        resourceId: userId,
        organisationId: id,
        details: { keyPrefix: req.crmApiKey?.prefix, ...updates },
      });
      res.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          isActive: user.isActive,
        },
      });
    } catch (err) {
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

// DELETE /api/v1/customers/:id/users/:userId — soft-deactivate
router.delete(
  "/customers/:id/users/:userId",
  requireCrmApiKey("users:write"),
  async (req, res) => {
    try {
      const { id, userId } = req.params as { id: string; userId: string };
      const [user] = await db
        .update(usersTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(usersTable.id, userId), eq(usersTable.organisationId, id)))
        .returning();
      if (!user) {
        res.status(404).json({ error: "Not Found", message: "User not found in this customer" });
        return;
      }
      await logAudit({
        req,
        action: "crm.user.deactivate",
        resourceType: "user",
        resourceId: userId,
        organisationId: id,
        details: { keyPrefix: req.crmApiKey?.prefix },
      });
      res.json({ id: userId, deactivated: true });
    } catch (err) {
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
);

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

// GET /api/v1/customers/:id/metrics — ESG snapshot for CRM display
router.get("/customers/:id/metrics", requireCrmApiKey("metrics:read"), async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const org = await db.query.organisationsTable.findFirst({
      where: eq(organisationsTable.id, id),
    });
    if (!org) {
      res.status(404).json({ error: "Not Found", message: "Customer not found" });
      return;
    }
    res.json({
      organisationId: id,
      sustainabilityScore: org.esgSustainabilityScore,
      totalCo2eKg: org.esgTotalCo2eKg,
      fleetCo2eKg: org.esgFleetCo2eKg,
      energyCo2eKg: org.esgEnergyCo2eKg,
      energyKwh: org.esgEnergyKwh,
      computedAt: org.esgComputedAt,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/* ------------------------------------------------------------------ */
/* Supplier audits                                                     */
/* ------------------------------------------------------------------ */

// GET /api/v1/customers/:id/audits — audit summary + recent items
router.get("/customers/:id/audits", requireCrmApiKey("audits:read"), async (req, res) => {
  try {
    const { id } = req.params as { id: string };

    const [supplierTotalsRes, statusRes, recentRes, upcomingRes] = await Promise.all([
      db
        .execute(
          sql`SELECT COUNT(*)::int AS total FROM suppliers WHERE organisation_id = ${id}`,
        )
        .catch(() => ({ rows: [{ total: 0 }] })),
      db
        .execute(sql`
          SELECT status, COUNT(*)::int AS cnt
          FROM supplier_audits
          WHERE organisation_id = ${id}
          GROUP BY status
        `)
        .catch(() => ({ rows: [] })),
      db
        .execute(sql`
          SELECT id, supplier_id, status, esg_score, risk_level, sent_at, due_at, submitted_at
          FROM supplier_audits
          WHERE organisation_id = ${id}
          ORDER BY COALESCE(submitted_at, sent_at, created_at) DESC NULLS LAST
          LIMIT 25
        `)
        .catch(() => ({ rows: [] })),
      db
        .execute(sql`
          SELECT COUNT(*)::int AS due_soon
          FROM suppliers
          WHERE organisation_id = ${id}
            AND next_audit_due_at IS NOT NULL
            AND next_audit_due_at <= NOW() + INTERVAL '30 days'
        `)
        .catch(() => ({ rows: [{ due_soon: 0 }] })),
    ]);

    const supplierTotals = ((supplierTotalsRes as { rows?: Array<{ total: number }> }).rows ?? [])[0] ?? { total: 0 };
    const statusRows = ((statusRes as { rows?: Array<{ status: string; cnt: number }> }).rows ?? []);
    const recentRows = ((recentRes as { rows?: Array<Record<string, unknown>> }).rows ?? []);
    const upcoming = ((upcomingRes as { rows?: Array<{ due_soon: number }> }).rows ?? [])[0] ?? { due_soon: 0 };

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const r of statusRows) {
      byStatus[r.status] = Number(r.cnt) || 0;
      total += Number(r.cnt) || 0;
    }
    const submitted = (byStatus.submitted ?? 0) + (byStatus.approved ?? 0);
    const compliancePct = total > 0 ? Math.round((submitted / total) * 1000) / 10 : null;

    // Average ESG score across submitted/approved audits
    const avgRes = await db
      .execute(sql`
        SELECT AVG(esg_score)::float AS avg
        FROM supplier_audits
        WHERE organisation_id = ${id} AND esg_score IS NOT NULL
      `)
      .catch(() => ({ rows: [{ avg: null }] }));
    const avgScore = ((avgRes as { rows?: Array<{ avg: number | null }> }).rows ?? [])[0]?.avg ?? null;

    res.json({
      organisationId: id,
      totalSuppliers: Number(supplierTotals.total) || 0,
      totalAudits: total,
      auditsByStatus: byStatus,
      compliancePct,
      averageEsgScore: avgScore,
      auditsDueWithin30Days: Number(upcoming.due_soon) || 0,
      recent: recentRows.map((r) => ({
        id: r.id,
        supplierId: r.supplier_id,
        status: r.status,
        esgScore: r.esg_score,
        riskLevel: r.risk_level,
        sentAt: r.sent_at,
        dueAt: r.due_at,
        submittedAt: r.submitted_at,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "CRM audits summary failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */

// GET /api/v1/customers/:id/billing
router.get("/customers/:id/billing", requireCrmApiKey("billing:read"), async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const org = await db.query.organisationsTable.findFirst({ where: eq(organisationsTable.id, id) });
    if (!org) {
      res.status(404).json({ error: "Not Found", message: "Customer not found" });
      return;
    }
    res.json({
      organisationId: id,
      plan: org.plan ?? null,
      billingStatus: org.billingStatus ?? "active",
      isActive: org.isActive,
    });
  } catch (err) {
    req.log.error({ err }, "CRM billing read failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// PATCH /api/v1/customers/:id/billing
router.patch("/customers/:id/billing", requireCrmApiKey("billing:write"), async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const { plan, billingStatus } = req.body as { plan?: string; billingStatus?: string };
    if (plan && !VALID_PLANS.has(plan)) {
      res.status(400).json({ error: "Bad Request", message: `plan must be one of ${[...VALID_PLANS].join(", ")}` });
      return;
    }
    if (billingStatus && !VALID_BILLING_STATUSES.has(billingStatus)) {
      res.status(400).json({
        error: "Bad Request",
        message: `billingStatus must be one of ${[...VALID_BILLING_STATUSES].join(", ")}`,
      });
      return;
    }

    // 404 on unknown customer — never silently succeed.
    const existing = await db.query.organisationsTable.findFirst({ where: eq(organisationsTable.id, id) });
    if (!existing) {
      res.status(404).json({ error: "Not Found", message: "Customer not found" });
      return;
    }

    const patch: Partial<typeof organisationsTable.$inferInsert> = { updatedAt: new Date() };
    if (plan) patch.plan = plan;
    if (billingStatus) {
      patch.billingStatus = billingStatus;
      patch.isActive = billingStatus !== "suspended";
    }

    const [updated] = await db
      .update(organisationsTable)
      .set(patch)
      .where(eq(organisationsTable.id, id))
      .returning();

    await logAudit({
      req,
      action: "crm.billing.update",
      resourceType: "organisation",
      resourceId: id,
      organisationId: id,
      details: { keyPrefix: req.crmApiKey?.prefix, plan, billingStatus },
    });

    res.json({
      organisationId: id,
      plan: updated.plan ?? null,
      billingStatus: updated.billingStatus ?? "active",
      isActive: updated.isActive,
    });
  } catch (err) {
    req.log.error({ err }, "CRM billing update failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function serializeCustomer(o: typeof organisationsTable.$inferSelect) {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    industry: o.industry,
    country: o.country,
    isActive: o.isActive,
    dataResidency: o.dataResidency,
    requireMfa: o.requireMfa,
    inboundEmailAddress: o.inboundEmailAddress,
    plan: o.plan ?? null,
    billingStatus: o.billingStatus ?? "active",
    sustainabilityScore: o.esgSustainabilityScore,
    totalCo2eKg: o.esgTotalCo2eKg,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

export default router;
