import { Router } from "express";
import { randomBytes } from "crypto";
import { db, organisationsTable, usersTable, vehiclesTable, widgetConfigsTable, auditLogsTable, subscriptionsTable } from "@workspace/db";
import { htmlToPdf } from "../lib/pdf.js";
import { renderContractHtml, CONTRACT_TERMS_VERSION } from "../lib/contract-template.js";
import { eq, and, count, desc, sql } from "drizzle-orm";
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
router.get("/", requireAuth, requireRole("super_admin"), async (req, res) => {
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
router.post("/", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const { name, industry, country, adminEmail, adminName, onboardingBrief } = req.body;
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

    // The admin will sign up via Clerk using this email; on first sign-in,
    // requireAuth's resolver will match by email and link the Clerk user to
    // the org_admin row we just created.
    const appBase = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0]?.trim()}/app`;
    const magicUrl = `${appBase}/sign-up`;

    // Save onboarding brief if provided (from AI-guided setup wizard)
    if (onboardingBrief) {
      try {
        await db.execute(sql`UPDATE organisations SET onboarding_brief = ${onboardingBrief} WHERE id = ${orgId}`);
      } catch { /* non-critical — org already created */ }
    }

    try {
      await sendInviteEmail(adminEmail, adminName, name, magicUrl);
      req.log.info({ to: adminEmail, orgName: name }, "Invite email sent");
    } catch (emailErr) {
      req.log.error({ emailErr, to: adminEmail }, "Failed to send invite email — org created but no email sent");
    }

    await logAudit({ req, action: "organisation.create", resourceType: "organisation", resourceId: orgId, organisationId: orgId, details: { name, hasOnboardingBrief: !!onboardingBrief } });

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
    await logAudit({ req, action: "organisation.update", resourceType: "organisation", resourceId: req.params.orgId as string, organisationId: req.params.orgId as string });
    res.json(org);
  } catch (err) {
    req.log.error({ err }, "Update organisation failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to update organisation" });
  }
});

// ── SSO policy ─────────────────────────────────────────────────────────────
// GET /organisations/:orgId/sso-policy — read current SSO policy.
router.get("/:orgId/sso-policy", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const org = await db.query.organisationsTable.findFirst({
      where: eq(organisationsTable.id, req.params.orgId as string),
    });
    if (!org) {
      res.status(404).json({ error: "Not Found", message: "Organisation not found" });
      return;
    }
    res.json({
      googleSsoEnabled: org.googleSsoEnabled,
      microsoftSsoEnabled: org.microsoftSsoEnabled,
      allowedSignInMethods: org.allowedSignInMethods ?? [],
      requiredSsoProvider: org.requiredSsoProvider,
    });
  } catch (err) {
    req.log.error({ err }, "Get SSO policy failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to load SSO policy" });
  }
});

const VALID_SIGN_IN_METHODS = ["magic_link", "passkey", "google_sso", "microsoft_sso"] as const;
type ValidSignInMethod = (typeof VALID_SIGN_IN_METHODS)[number];

// PATCH /organisations/:orgId/sso-policy
router.patch("/:orgId/sso-policy", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const body = req.body as {
      googleSsoEnabled?: unknown;
      microsoftSsoEnabled?: unknown;
      allowedSignInMethods?: unknown;
      requiredSsoProvider?: unknown;
    };

    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (body.googleSsoEnabled !== undefined) {
      if (typeof body.googleSsoEnabled !== "boolean") {
        res.status(400).json({ error: "Bad Request", message: "googleSsoEnabled must be boolean" });
        return;
      }
      update.googleSsoEnabled = body.googleSsoEnabled;
    }
    if (body.microsoftSsoEnabled !== undefined) {
      if (typeof body.microsoftSsoEnabled !== "boolean") {
        res.status(400).json({ error: "Bad Request", message: "microsoftSsoEnabled must be boolean" });
        return;
      }
      update.microsoftSsoEnabled = body.microsoftSsoEnabled;
    }
    if (body.allowedSignInMethods !== undefined) {
      if (
        !Array.isArray(body.allowedSignInMethods) ||
        body.allowedSignInMethods.length === 0 ||
        !body.allowedSignInMethods.every(
          (m): m is ValidSignInMethod =>
            typeof m === "string" && (VALID_SIGN_IN_METHODS as readonly string[]).includes(m),
        )
      ) {
        res.status(400).json({
          error: "Bad Request",
          message: "allowedSignInMethods must be a non-empty array of: " + VALID_SIGN_IN_METHODS.join(", "),
        });
        return;
      }
      // Dedup
      update.allowedSignInMethods = Array.from(new Set(body.allowedSignInMethods)) as ValidSignInMethod[];
    }
    if (body.requiredSsoProvider !== undefined) {
      if (
        body.requiredSsoProvider !== null &&
        body.requiredSsoProvider !== "google" &&
        body.requiredSsoProvider !== "microsoft"
      ) {
        res.status(400).json({ error: "Bad Request", message: "requiredSsoProvider must be 'google', 'microsoft', or null" });
        return;
      }
      update.requiredSsoProvider = body.requiredSsoProvider;
    }

    const previous = await db.query.organisationsTable.findFirst({
      where: eq(organisationsTable.id, orgId),
    });
    if (!previous) {
      res.status(404).json({ error: "Not Found", message: "Organisation not found" });
      return;
    }

    // Effective-usability invariant: after applying changes, at least one
    // sign-in method in the allowed list must actually be reachable for
    // non-admin users. This blocks combinations like "only google_sso allowed
    // but Google is disabled" or "requiredSsoProvider=google with Google
    // disabled" which would silently lock users out (admins still have the
    // magic-link break-glass, but the UX would be broken).
    const effective = {
      googleSsoEnabled: update.googleSsoEnabled ?? previous.googleSsoEnabled,
      microsoftSsoEnabled: update.microsoftSsoEnabled ?? previous.microsoftSsoEnabled,
      allowedSignInMethods:
        (update.allowedSignInMethods as ValidSignInMethod[] | undefined) ??
        ((previous.allowedSignInMethods as ValidSignInMethod[] | null) ?? VALID_SIGN_IN_METHODS),
      requiredSsoProvider:
        update.requiredSsoProvider !== undefined
          ? update.requiredSsoProvider
          : previous.requiredSsoProvider,
    };
    const usable = effective.allowedSignInMethods.filter((m) => {
      if (m === "magic_link" || m === "passkey") {
        return effective.requiredSsoProvider === null || effective.requiredSsoProvider === undefined;
      }
      if (m === "google_sso") {
        return effective.googleSsoEnabled && (effective.requiredSsoProvider ?? "google") === "google";
      }
      if (m === "microsoft_sso") {
        return (
          effective.microsoftSsoEnabled &&
          (effective.requiredSsoProvider ?? "microsoft") === "microsoft"
        );
      }
      return false;
    });
    if (usable.length === 0) {
      res.status(400).json({
        error: "Bad Request",
        message:
          "These settings would lock out non-admin users — at least one allowed sign-in method must be effectively reachable. Adjust allowedSignInMethods, the provider toggles, or requiredSsoProvider so they are mutually consistent.",
      });
      return;
    }

    const [updated] = await db
      .update(organisationsTable)
      .set(update)
      .where(eq(organisationsTable.id, orgId))
      .returning();

    await logAudit({
      req,
      action: "sso.policy.changed",
      // Stamp organisationId explicitly so the audit row is correctly scoped
      // when the actor is a super_admin (whose session.organisationId is null).
      // Without this, the row's organisation_id would be NULL and the
      // /sso-policy/history filter (and the global audit log per-org view)
      // would not find it.
      organisationId: orgId,
      resourceType: "organisation",
      resourceId: orgId,
      previousValue: {
        googleSsoEnabled: previous.googleSsoEnabled,
        microsoftSsoEnabled: previous.microsoftSsoEnabled,
        allowedSignInMethods: previous.allowedSignInMethods,
        requiredSsoProvider: previous.requiredSsoProvider,
      },
      newValue: {
        googleSsoEnabled: updated.googleSsoEnabled,
        microsoftSsoEnabled: updated.microsoftSsoEnabled,
        allowedSignInMethods: updated.allowedSignInMethods,
        requiredSsoProvider: updated.requiredSsoProvider,
      },
    });

    res.json({
      googleSsoEnabled: updated.googleSsoEnabled,
      microsoftSsoEnabled: updated.microsoftSsoEnabled,
      allowedSignInMethods: updated.allowedSignInMethods ?? [],
      requiredSsoProvider: updated.requiredSsoProvider,
    });
  } catch (err) {
    req.log.error({ err }, "Update SSO policy failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to update SSO policy" });
  }
});

// GET /organisations/:orgId/sso-policy/history
// Returns recent `sso.policy.changed` audit entries for this org so the
// Settings → Sign-in & SSO card can render a timeline of who changed what
// and when, mirroring the per-user /sign-in-policy/history pattern.
router.get("/:orgId/sso-policy/history", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    // Accept ?limit but clamp to a sane positive range so a negative or
    // garbage value can't blow up the SQL driver.
    const rawLimit = parseInt(req.query.limit as string);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 25, 1), 100);

    const items = await db
      .select({
        id: auditLogsTable.id,
        createdAt: auditLogsTable.createdAt,
        actorUserId: auditLogsTable.userId,
        actorEmail: auditLogsTable.userEmail,
        actorType: auditLogsTable.actorType,
        previousValue: auditLogsTable.previousValue,
        newValue: auditLogsTable.newValue,
      })
      .from(auditLogsTable)
      .where(
        and(
          eq(auditLogsTable.organisationId, orgId),
          eq(auditLogsTable.action, "sso.policy.changed"),
          eq(auditLogsTable.resourceType, "organisation"),
          eq(auditLogsTable.resourceId, orgId),
        ),
      )
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit);

    res.json({ items });
  } catch (err) {
    req.log.error({ err }, "Get SSO policy history failed");
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to load SSO policy history",
    });
  }
});

// DELETE /organisations/:orgId
router.delete("/:orgId", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    await db.delete(organisationsTable).where(eq(organisationsTable.id, req.params.orgId as string));
    await logAudit({ req, action: "organisation.delete", resourceType: "organisation", resourceId: req.params.orgId as string, organisationId: req.params.orgId as string });
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
    await logAudit({ req, action: "organisation.rotate_webhook_secret", resourceType: "organisation", resourceId: req.params.orgId as string, organisationId: req.params.orgId as string });
    res.json({ webhookSecret: org.webhookSecret });
  } catch (err) {
    req.log.error({ err }, "Rotate webhook secret failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to rotate webhook secret" });
  }
});

// GET /organisations/:orgId/summary
// Query params:
//   period = "all" | "7d" | "30d" | "3m" | "12m"  (or legacy "day"|"week"|"month"|"quarter"|"year")
//   "all" removes all date filters and returns all-time totals.
//   Default: "all"
router.get("/:orgId/summary", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const period = (req.query.period as string) || "all";

    const now = new Date();
    // null = no date filter (all-time)
    let fromDate: Date | null = null;

    if (period !== "all") {
      fromDate = new Date(now);
      switch (period) {
        case "7d":  case "day":     fromDate.setDate(now.getDate() - 7);            break;
        case "30d": case "week":    fromDate.setDate(now.getDate() - 30);           break;
        case "month":               fromDate.setMonth(now.getMonth() - 1);          break;
        case "3m":  case "quarter": fromDate.setMonth(now.getMonth() - 3);          break;
        case "12m": case "year":    fromDate.setFullYear(now.getFullYear() - 1);    break;
        default:                    fromDate.setFullYear(now.getFullYear() - 1);    break;
      }
    }

    const fleetDateClause = fromDate
      ? sql`AND recorded_at >= ${fromDate} AND recorded_at <= ${now}`
      : sql``;
    const energyDateClause = fromDate
      ? sql`AND period_start >= ${fromDate} AND period_end <= ${now}`
      : sql``;

    // Get fleet emission totals + data quality (% events with real fuel data)
    const fleetResult = await db.execute(sql`
      SELECT
        COALESCE(SUM(co2e_kg), 0)       as total_co2e,
        COALESCE(SUM(distance_km), 0)   as total_distance,
        COUNT(*)                         as total_events,
        COUNT(*) FILTER (WHERE fuel_litres IS NOT NULL AND fuel_litres > 0) as events_with_fuel
      FROM fleet_events
      WHERE organisation_id = ${orgId}
        ${fleetDateClause}
    `);

    // Get energy emission totals
    const energyResult = await db.execute(sql`
      SELECT COALESCE(SUM(co2e_kg), 0) as total_co2e, COALESCE(SUM(usage_kwh), 0) as total_kwh
      FROM energy_readings
      WHERE organisation_id = ${orgId}
        ${energyDateClause}
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

    // Data quality — what % of fleet events have measured fuel litres?
    const totalFleetEvents = intCol(fr, "total_events");
    const fleetEventsWithFuel = intCol(fr, "events_with_fuel");
    const fuelCoveragePct = totalFleetEvents > 0 ? (fleetEventsWithFuel / totalFleetEvents) * 100 : 0;

    // Margin of error: distance-only estimates ±20%; real fuel data tightens to ±3%
    const fleetMarginPct =
      fuelCoveragePct === 100 ? 3 :
      fuelCoveragePct >= 70  ? 5 :
      fuelCoveragePct >= 30  ? 10 :
      fuelCoveragePct >= 1   ? 15 : 20;

    // Energy bills have measured kWh so only emission factor uncertainty (~5%)
    const energyMarginPct = energyKwh > 0 ? 5 : 0;

    // Weighted combined margin across fleet + energy
    const totalCo2e = fleetCo2e + energyCo2e;
    const co2eMarginPct = totalCo2e > 0
      ? Math.round((fleetCo2e * fleetMarginPct + energyCo2e * energyMarginPct) / totalCo2e)
      : 0;

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
      // Data quality & margin of error
      fleetMarginPct,
      energyMarginPct,
      co2eMarginPct,
      fuelCoveragePct: Math.round(fuelCoveragePct),
    });
  } catch (err) {
    req.log.error({ err }, "Get summary failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to get summary" });
  }
});

// ── Contract / Order Form ──────────────────────────────────────────────────
// The "contract" for an org is stored as a row in `subscriptions` plus an
// audit log entry recording acceptance metadata (signer, IP, user agent). The
// PDF is regenerated on demand from those two sources so it always reflects
// the source of truth — we do not stash a copy of the rendered PDF.

type ContractBody = {
  planName?: string;
  monthlyPriceMinor?: number; // store as integer cents to avoid float drift
  currency?: string;
  billingCadence?: "monthly" | "annual";
  termMonths?: number;
  startDate?: string; // ISO date
  customIntegration?: boolean;
  notes?: string | null;
  signerName?: string;
  signerEmail?: string;
  signerTitle?: string | null;
  signedAt?: string; // ISO datetime; defaults to now
};

function pickContractFromSubscription(sub: typeof subscriptionsTable.$inferSelect | undefined) {
  if (!sub) return null;
  const ent = (sub.entitlements ?? {}) as Record<string, unknown>;
  const sm = (ent.signerMeta ?? {}) as Record<string, unknown>;
  return {
    subscriptionId: sub.id,
    planName: (ent.planName as string) ?? sub.planCode ?? "Subscription",
    monthlyPriceMinor: Math.round(((sub.monthlyPrice ?? 0) as number) * 100),
    currency: sub.currency ?? "NZD",
    billingCadence: ((ent.billingCadence as string) ?? "monthly") as "monthly" | "annual",
    termMonths: (ent.termMonths as number) ?? 12,
    startDate: sub.startDate?.toISOString() ?? null,
    endDate: sub.endDate?.toISOString() ?? null,
    customIntegration: Boolean(ent.customIntegration),
    notes: (ent.notes as string | null) ?? null,
    signerName: (sm.name as string) ?? "",
    signerEmail: (sm.email as string) ?? "",
    signerTitle: (sm.title as string | null) ?? null,
    signedAt: (sm.signedAt as string | null) ?? null,
    signedIp: (sm.ip as string | null) ?? null,
    signedUserAgent: (sm.userAgent as string | null) ?? null,
    termsVersion: (ent.termsVersion as string) ?? CONTRACT_TERMS_VERSION,
  };
}

// GET /organisations/:orgId/contract — fetch latest stored contract (for prefill).
router.get("/:orgId/contract", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const org = await db.query.organisationsTable.findFirst({ where: eq(organisationsTable.id, orgId) });
    if (!org) { res.status(404).json({ error: "Not Found" }); return; }
    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(and(eq(subscriptionsTable.organisationId, orgId), eq(subscriptionsTable.contractStatus, "signed")))
      .orderBy(desc(subscriptionsTable.createdAt))
      .limit(1);
    res.json({
      organisation: { id: org.id, name: org.name, slug: org.slug, industry: org.industry, country: org.country, legalEntityName: (org as { legalEntityName?: string | null }).legalEntityName ?? null },
      contract: pickContractFromSubscription(sub),
    });
  } catch (err) {
    req.log.error({ err }, "Get contract failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// POST /organisations/:orgId/contract — record / replace the contract.
router.post("/:orgId/contract", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const body = (req.body ?? {}) as ContractBody;

    // Validate inputs strictly — contract data is legally relevant.
    const planName = (body.planName ?? "").trim();
    const currency = (body.currency ?? "NZD").trim().toUpperCase();
    const billingCadence = body.billingCadence === "annual" ? "annual" : "monthly";
    const termMonths = Number.isFinite(body.termMonths) ? Math.floor(body.termMonths!) : 0;
    const monthlyPriceMinor = Number.isFinite(body.monthlyPriceMinor) ? Math.round(body.monthlyPriceMinor!) : -1;
    const signerName = (body.signerName ?? "").trim();
    const signerEmail = (body.signerEmail ?? "").trim();
    const startDate = body.startDate ? new Date(body.startDate) : new Date();
    const signedAt = body.signedAt ? new Date(body.signedAt) : new Date();

    const problems: string[] = [];
    if (!planName) problems.push("planName is required");
    if (monthlyPriceMinor < 0) problems.push("monthlyPriceMinor must be ≥ 0 (cents)");
    if (!/^[A-Z]{3}$/.test(currency)) problems.push("currency must be a 3-letter ISO code");
    if (termMonths < 1 || termMonths > 120) problems.push("termMonths must be between 1 and 120");
    if (!signerName) problems.push("signerName is required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail)) problems.push("signerEmail must be a valid email");
    if (Number.isNaN(startDate.getTime())) problems.push("startDate is invalid");
    if (Number.isNaN(signedAt.getTime())) problems.push("signedAt is invalid");
    if (problems.length) { res.status(400).json({ error: "Bad Request", problems }); return; }

    const org = await db.query.organisationsTable.findFirst({ where: eq(organisationsTable.id, orgId) });
    if (!org) { res.status(404).json({ error: "Not Found" }); return; }

    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + termMonths);

    const entitlements = {
      planName,
      billingCadence,
      termMonths,
      customIntegration: Boolean(body.customIntegration),
      notes: body.notes ?? null,
      termsVersion: CONTRACT_TERMS_VERSION,
      signerMeta: {
        name: signerName,
        email: signerEmail,
        title: body.signerTitle ?? null,
        signedAt: signedAt.toISOString(),
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      },
    };

    const planCode = planName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "custom";
    const id = uuidv4();
    const [sub] = await db
      .insert(subscriptionsTable)
      .values({
        id,
        organisationId: orgId,
        planCode,
        status: "active",
        contractStatus: "signed",
        billingStatus: "active",
        startDate,
        endDate,
        monthlyPrice: monthlyPriceMinor / 100,
        currency,
        entitlements,
        sourceSystem: "admin_console",
        createdBy: req.session.userId ?? null,
        updatedBy: req.session.userId ?? null,
      })
      .returning();

    await logAudit({
      req,
      action: "organisation.contract.recorded",
      resourceType: "subscription",
      resourceId: sub.id,
      organisationId: orgId,
      details: {
        planName,
        monthlyPriceMinor,
        currency,
        billingCadence,
        termMonths,
        totalValueMinor: monthlyPriceMinor * termMonths,
        customIntegration: Boolean(body.customIntegration),
        signerEmail,
        signerName,
        termsVersion: CONTRACT_TERMS_VERSION,
      },
    });

    res.status(201).json({ ok: true, subscriptionId: sub.id });
  } catch (err) {
    req.log.error({ err }, "Record contract failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// GET /organisations/:orgId/contract.pdf — render the contract PDF.
router.get("/:orgId/contract.pdf", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const org = await db.query.organisationsTable.findFirst({ where: eq(organisationsTable.id, orgId) });
    if (!org) { res.status(404).json({ error: "Not Found" }); return; }

    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(and(eq(subscriptionsTable.organisationId, orgId), eq(subscriptionsTable.contractStatus, "signed")))
      .orderBy(desc(subscriptionsTable.createdAt))
      .limit(1);
    const picked = pickContractFromSubscription(sub);
    if (!picked) {
      res.status(404).json({ error: "Not Found", message: "No contract recorded for this organisation. Use the Contract dialog in the admin console to record one first." });
      return;
    }

    const html = renderContractHtml({
      orgName: org.name,
      orgSlug: org.slug,
      industry: org.industry ?? null,
      country: org.country ?? null,
      legalEntityName: (org as { legalEntityName?: string | null }).legalEntityName ?? null,
      planName: picked.planName,
      monthlyPriceMinor: picked.monthlyPriceMinor,
      currency: picked.currency,
      billingCadence: picked.billingCadence,
      termMonths: picked.termMonths,
      startDate: picked.startDate ? new Date(picked.startDate) : new Date(),
      customIntegration: picked.customIntegration,
      notes: picked.notes,
      signerName: picked.signerName,
      signerEmail: picked.signerEmail,
      signerTitle: picked.signerTitle,
      signedAt: picked.signedAt ? new Date(picked.signedAt) : new Date(),
      signedIp: picked.signedIp,
      signedUserAgent: picked.signedUserAgent,
      contractRef: picked.subscriptionId,
      generatedAt: new Date(),
    });

    const pdf = await htmlToPdf(html, {
      // CSS @page rules control margins: full-bleed cover, comfortable margins on inner pages.
      marginMm: { top: 0, right: 0, bottom: 0, left: 0 },
      showPageNumbers: false,
      preferCSSPageSize: true,
    });

    const filename = `enviroiq-contract-${org.slug}-${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(pdf);

    await logAudit({
      req,
      action: "organisation.contract.pdf_downloaded",
      resourceType: "subscription",
      resourceId: picked.subscriptionId,
      organisationId: orgId,
    });
  } catch (err) {
    req.log.error({ err }, "Render contract PDF failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to render contract PDF" });
  }
});

export default router;
