import { Router } from "express";
import { randomBytes } from "crypto";
import { db, organisationsTable, usersTable, vehiclesTable, widgetConfigsTable, magicLinksTable } from "@workspace/db";
import { eq, count, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireRole, requireOrgAccess, requireOrgAdmin } from "../lib/auth.js";
import { sqlRow, sqlRows, numCol, intCol, strCol } from "../lib/sql-result.js";
import { logAudit } from "../lib/audit.js";
import { sendInviteEmail } from "../lib/mailer.js";
import { calcSustainabilityScore } from "../lib/emissions.js";

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

// GET /organisations
router.get("/", requireRole("super_admin"), async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const [items, [{ total }]] = await Promise.all([
      db.select().from(organisationsTable).limit(limit).offset(offset),
      db.select({ total: count() }).from(organisationsTable),
    ]);

    const userCounts = await db
      .select({ orgId: usersTable.organisationId, cnt: count() })
      .from(usersTable)
      .groupBy(usersTable.organisationId);
    const vehicleCounts = await db
      .select({ orgId: vehiclesTable.organisationId, cnt: count() })
      .from(vehiclesTable)
      .groupBy(vehiclesTable.organisationId);

    const ucMap = Object.fromEntries(userCounts.map((r) => [r.orgId, r.cnt]));
    const vcMap = Object.fromEntries(vehicleCounts.map((r) => [r.orgId, r.cnt]));

    res.json({
      items: items.map((o) => ({ ...o, userCount: ucMap[o.id] || 0, vehicleCount: vcMap[o.id] || 0 })),
      total,
      page,
      limit,
    });
  } catch (err) {
    req.log.error({ err }, "List organisations failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to list organisations" });
  }
});

// POST /organisations
router.post("/", requireRole("super_admin"), async (req, res) => {
  try {
    const { name, industry, country, adminEmail, adminName } = req.body;
    if (!name || !adminEmail || !adminName) {
      res.status(400).json({ error: "Bad Request", message: "name, adminEmail, adminName required" });
      return;
    }

    const slug = generateSlug(name);
    const orgId = uuidv4();
    const widgetKey = generateWidgetKey();
    const webhookSecret = generateWebhookSecret();
    const inboundEmail = generateInboundEmail(slug);

    const [org] = await db.insert(organisationsTable).values({
      id: orgId,
      name,
      slug,
      industry,
      country,
      widgetKey,
      webhookSecret,
      inboundEmailAddress: inboundEmail,
    }).returning();

    // Create admin user
    let adminUser = await db.query.usersTable.findFirst({ where: eq(usersTable.email, adminEmail) });
    if (!adminUser) {
      const [newUser] = await db.insert(usersTable).values({
        id: uuidv4(),
        email: adminEmail,
        name: adminName,
        role: "org_admin",
        organisationId: orgId,
      }).returning();
      adminUser = newUser;
    } else {
      await db.update(usersTable).set({ organisationId: orgId, role: "org_admin" }).where(eq(usersTable.id, adminUser.id));
    }

    // Create default widget config
    await db.insert(widgetConfigsTable).values({ organisationId: orgId }).onConflictDoNothing();

    // Generate a 24-hour magic link so the admin can log in straight away
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.insert(magicLinksTable).values({ id: uuidv4(), userId: adminUser.id, token, expiresAt });

    const appBase = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0]?.trim()}/app`;
    const magicUrl = `${appBase}/auth/verify?token=${token}`;

    try {
      await sendInviteEmail(adminEmail, adminName, name, magicUrl);
      req.log.info({ to: adminEmail, orgName: name }, "Invite email sent");
    } catch (emailErr) {
      req.log.error({ emailErr, to: adminEmail }, "Failed to send invite email — org created but no email sent");
    }

    await logAudit({ req, action: "organisation.create", resourceType: "organisation", resourceId: orgId, details: { name } });

    res.status(201).json({ ...org, userCount: 1, vehicleCount: 0 });
  } catch (err) {
    req.log.error({ err }, "Create organisation failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to create organisation" });
  }
});

// GET /organisations/public/:slug — no auth, returns basic org info for branded login pages
router.get("/public/:slug", async (req, res) => {
  try {
    const org = await db.query.organisationsTable.findFirst({
      where: eq(organisationsTable.slug, req.params.slug as string),
    });
    if (!org || !org.isActive) {
      res.status(404).json({ error: "Not Found", message: "Organisation not found" });
      return;
    }
    res.json({ id: org.id, name: org.name, slug: org.slug, logoUrl: org.logoUrl });
  } catch (err) {
    req.log.error({ err }, "Public org lookup failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to look up organisation" });
  }
});

// GET /organisations/:orgId
router.get("/:orgId", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const org = await db.query.organisationsTable.findFirst({
      where: eq(organisationsTable.id, req.params.orgId as string),
    });
    if (!org) {
      res.status(404).json({ error: "Not Found", message: "Organisation not found" });
      return;
    }
    const [{ uc }] = await db.select({ uc: count() }).from(usersTable).where(eq(usersTable.organisationId, org.id));
    const [{ vc }] = await db.select({ vc: count() }).from(vehiclesTable).where(eq(vehiclesTable.organisationId, org.id));
    res.json({ ...org, userCount: uc, vehicleCount: vc });
  } catch (err) {
    req.log.error({ err }, "Get organisation failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to get organisation" });
  }
});

// PATCH /organisations/:orgId
router.patch("/:orgId", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const { name, industry, country, logoUrl, isActive } = req.body;
    const [org] = await db
      .update(organisationsTable)
      .set({ name, industry, country, logoUrl, isActive, updatedAt: new Date() })
      .where(eq(organisationsTable.id, req.params.orgId as string))
      .returning();
    if (!org) {
      res.status(404).json({ error: "Not Found", message: "Organisation not found" });
      return;
    }
    await logAudit({ req, action: "organisation.update", resourceType: "organisation", resourceId: req.params.orgId as string });
    res.json(org);
  } catch (err) {
    req.log.error({ err }, "Update organisation failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to update organisation" });
  }
});

// DELETE /organisations/:orgId
router.delete("/:orgId", requireRole("super_admin"), async (req, res) => {
  try {
    await db.delete(organisationsTable).where(eq(organisationsTable.id, req.params.orgId as string));
    await logAudit({ req, action: "organisation.delete", resourceType: "organisation", resourceId: req.params.orgId as string });
    res.json({ message: "Organisation deleted" });
  } catch (err) {
    req.log.error({ err }, "Delete organisation failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to delete organisation" });
  }
});

// GET /organisations/:orgId/webhook-credentials — org_admin can view their own webhook secret
router.get("/:orgId/webhook-credentials", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const org = await db.query.organisationsTable.findFirst({
      where: eq(organisationsTable.id, req.params.orgId as string),
    });
    if (!org) {
      res.status(404).json({ error: "Not Found", message: "Organisation not found" });
      return;
    }
    res.json({
      webhookSecret: org.webhookSecret,
      inboundEmailAddress: org.inboundEmailAddress,
      fleetWebhookUrl: `/api/webhooks/fleet`,
      energyWebhookUrl: `/api/webhooks/energy`,
    });
  } catch (err) {
    req.log.error({ err }, "Get webhook credentials failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to get webhook credentials" });
  }
});

// POST /organisations/:orgId/webhook-credentials/rotate — org_admin can rotate the webhook secret
router.post("/:orgId/webhook-credentials/rotate", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const newSecret = generateWebhookSecret();
    const [org] = await db
      .update(organisationsTable)
      .set({ webhookSecret: newSecret, updatedAt: new Date() })
      .where(eq(organisationsTable.id, req.params.orgId as string))
      .returning();
    if (!org) {
      res.status(404).json({ error: "Not Found", message: "Organisation not found" });
      return;
    }
    await logAudit({ req, action: "organisation.rotate_webhook_secret", resourceType: "organisation", resourceId: req.params.orgId as string });
    res.json({ webhookSecret: org.webhookSecret });
  } catch (err) {
    req.log.error({ err }, "Rotate webhook secret failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to rotate webhook secret" });
  }
});

// GET /organisations/:orgId/summary
router.get("/:orgId/summary", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const period = (req.query.period as string) || "month";

    const now = new Date();
    let fromDate = new Date();
    switch (period) {
      case "day": fromDate.setDate(now.getDate() - 1); break;
      case "week": fromDate.setDate(now.getDate() - 7); break;
      case "month": fromDate.setMonth(now.getMonth() - 1); break;
      case "quarter": fromDate.setMonth(now.getMonth() - 3); break;
      case "year": fromDate.setFullYear(now.getFullYear() - 1); break;
    }

    // Get fleet emission totals
    const fleetResult = await db.execute(sql`
      SELECT COALESCE(SUM(co2e_kg), 0) as total_co2e, COALESCE(SUM(distance_km), 0) as total_distance
      FROM fleet_events
      WHERE organisation_id = ${orgId}
        AND recorded_at >= ${fromDate}
        AND recorded_at <= ${now}
    `);

    // Get energy emission totals
    const energyResult = await db.execute(sql`
      SELECT COALESCE(SUM(co2e_kg), 0) as total_co2e, COALESCE(SUM(usage_kwh), 0) as total_kwh
      FROM energy_readings
      WHERE organisation_id = ${orgId}
        AND period_start >= ${fromDate}
        AND period_end <= ${now}
    `);

    // Get active vehicles
    const [{ vc }] = await db.select({ vc: count() }).from(vehiclesTable)
      .where(eq(vehiclesTable.organisationId, orgId));

    // Get goals summary
    const goalsResult = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'on_track') as on_track,
        COUNT(*) FILTER (WHERE status = 'behind' OR status = 'at_risk') as behind,
        COUNT(*) as total
      FROM goals
      WHERE organisation_id = ${orgId}
    `);

    const fr = sqlRow(fleetResult);
    const er = sqlRow(energyResult);
    const gr = sqlRow(goalsResult);

    const fleetCo2e = numCol(fr, "total_co2e");
    const energyCo2e = numCol(er, "total_co2e");
    const fleetDistance = numCol(fr, "total_distance");
    const energyKwh = numCol(er, "total_kwh");
    const goalsOnTrack = intCol(gr, "on_track");
    const totalGoals = intCol(gr, "total");

    const score = calcSustainabilityScore({
      totalCo2eKg: fleetCo2e + energyCo2e,
      fleetDistanceKm: fleetDistance,
      goalsOnTrack,
      totalGoals,
    });

    res.json({
      organisationId: orgId,
      period,
      totalCo2eKg: fleetCo2e + energyCo2e,
      fleetCo2eKg: fleetCo2e,
      energyCo2eKg: energyCo2e,
      totalEnergyKwh: energyKwh,
      fleetDistanceKm: fleetDistance,
      activeVehicles: parseInt(String(vc)) || 0,
      sustainabilityScore: score,
      goalsOnTrack,
      goalsBehind: intCol(gr, "behind"),
      periodOverPeriodChange: 0,
      lastUpdated: now.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Get summary failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to get summary" });
  }
});

export default router;
