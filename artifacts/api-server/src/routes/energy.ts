import { Router } from "express";
import { db, energyReadingsTable, organisationsTable } from "@workspace/db";
import { eq, and, gte, lte, count } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";
import { requireAuth, requireOrgAccess, requireOrgAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { calcEnergyCo2e, resolveElectricityFactor } from "../lib/emissions.js";
import { getCurrentGridIntensity } from "../lib/em6.js";

const router = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// GET /organisations/:orgId/energy/readings
router.get("/readings", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const { from, to } = req.query;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;

    const conditions = [eq(energyReadingsTable.organisationId, orgId)];
    if (from) conditions.push(gte(energyReadingsTable.periodStart, new Date(from as string)));
    if (to) conditions.push(lte(energyReadingsTable.periodEnd, new Date(to as string)));

    const [items, [{ total }]] = await Promise.all([
      db.select().from(energyReadingsTable).where(and(...conditions))
        .orderBy(energyReadingsTable.periodStart)
        .limit(limit).offset(offset),
      db.select({ total: count() }).from(energyReadingsTable).where(and(...conditions)),
    ]);

    res.json({ items, total, page, limit });
  } catch (err) {
    req.log.error({ err }, "List energy readings failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to list energy readings" });
  }
});

// POST /organisations/:orgId/energy/readings
router.post("/readings", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const { utilityType, provider, periodStart, periodEnd, usageKwh, usageMj, costAmount, costCurrency, supplierRenewablePct } = req.body;
    if (!utilityType || !periodStart || !periodEnd) {
      res.status(400).json({ error: "Bad Request", message: "utilityType, periodStart, periodEnd required" });
      return;
    }

    const periodStartDate = new Date(periodStart);
    const isCurrentPeriod = periodStartDate.getFullYear() >= new Date().getFullYear();
    const liveGrid = isCurrentPeriod ? await getCurrentGridIntensity() : null;

    const { factorKgCo2PerKwh, method, note } = resolveElectricityFactor({
      periodStart: periodStartDate,
      supplierRenewablePct: supplierRenewablePct !== undefined ? Number(supplierRenewablePct) : undefined,
      liveGridKgCo2PerKwh: liveGrid?.kgco2PerKwh,
    });

    const co2eKg = calcEnergyCo2e({ utilityType, usageKwh, usageMj, electricityFactorKgCo2PerKwh: factorKgCo2PerKwh });

    const [reading] = await db.insert(energyReadingsTable).values({
      id: uuidv4(),
      organisationId: orgId,
      utilityType,
      provider,
      periodStart: periodStartDate,
      periodEnd: new Date(periodEnd),
      usageKwh,
      usageMj,
      costAmount,
      costCurrency: costCurrency || "NZD",
      co2eKg,
      gridIntensityKgCo2PerKwh: utilityType === "electricity" ? factorKgCo2PerKwh : undefined,
      emissionMethod: utilityType === "electricity" ? method : undefined,
      emissionNote: utilityType === "electricity" ? note : undefined,
      supplierRenewablePct: supplierRenewablePct !== undefined ? Number(supplierRenewablePct) : undefined,
      source: "manual",
    }).returning();

    await logAudit({ req, action: "energy_reading.create", resourceType: "energy_reading", resourceId: reading.id });
    res.status(201).json(reading);
  } catch (err) {
    req.log.error({ err }, "Create energy reading failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to create energy reading" });
  }
});

// POST /organisations/:orgId/energy/upload
router.post("/upload", requireAuth, requireOrgAdmin, upload.single("file"), async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const { utilityType, supplierRenewablePct, periodStartOverride, periodEndOverride, provider } = req.body;

    if (!req.file) {
      res.status(400).json({ error: "Bad Request", message: "File required" });
      return;
    }
    if (!utilityType) {
      res.status(400).json({ error: "Bad Request", message: "utilityType required" });
      return;
    }

    // Basic PDF text extraction (for full parsing, a PDF library would be needed in production)
    const fileText = req.file.buffer.toString("utf8", 0, Math.min(req.file.buffer.length, 5000));

    // Simple heuristic parsing - look for common patterns
    const kwhMatch = fileText.match(/(\d+(?:\.\d+)?)\s*(?:kWh|KWH|kwh)/i);
    const costMatch = fileText.match(/\$\s*(\d+(?:\.\d+)?)/);
    const usageKwh = kwhMatch ? parseFloat(kwhMatch[1]) : undefined;
    const costAmount = costMatch ? parseFloat(costMatch[1]) : undefined;

    // Use user-supplied dates if provided, otherwise default to last month
    const now = new Date();
    const periodStart = periodStartOverride
      ? new Date(periodStartOverride)
      : new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const periodEnd = periodEndOverride
      ? new Date(periodEndOverride)
      : new Date(now.getFullYear(), now.getMonth(), 0);

    // Determine the correct emission factor for the billing period
    const isCurrentYear = periodStart.getFullYear() >= now.getFullYear();
    const liveGrid = isCurrentYear ? await getCurrentGridIntensity() : null;
    const renewablePct = supplierRenewablePct !== undefined ? Number(supplierRenewablePct) : undefined;

    const { factorKgCo2PerKwh, method, note } = resolveElectricityFactor({
      periodStart,
      supplierRenewablePct: renewablePct,
      liveGridKgCo2PerKwh: liveGrid?.kgco2PerKwh,
    });

    const co2eKg = calcEnergyCo2e({ utilityType, usageKwh, electricityFactorKgCo2PerKwh: factorKgCo2PerKwh });

    const [reading] = await db.insert(energyReadingsTable).values({
      id: uuidv4(),
      organisationId: orgId,
      utilityType,
      provider: provider || undefined,
      periodStart,
      periodEnd,
      usageKwh,
      costAmount,
      co2eKg,
      gridIntensityKgCo2PerKwh: utilityType === "electricity" ? factorKgCo2PerKwh : undefined,
      emissionMethod: utilityType === "electricity" ? method : undefined,
      emissionNote: utilityType === "electricity" ? note : undefined,
      supplierRenewablePct: renewablePct,
      source: "pdf_upload",
      originalFileName: req.file.originalname,
      rawText: fileText.substring(0, 1000),
    }).returning();

    await logAudit({
      req,
      action: "energy_bill.upload",
      resourceType: "energy_reading",
      resourceId: reading.id,
      details: { filename: req.file.originalname, period: `${periodStart.toISOString().slice(0, 7)}`, emissionMethod: method },
    });

    res.status(201).json({
      reading,
      parsedFields: { usageKwh, cost: costAmount, periodStart, periodEnd },
      emissionFactorUsed: { factorKgCo2PerKwh, method, note },
      confidence: usageKwh ? 0.7 : 0.2,
      requiresReview: !usageKwh,
    });
  } catch (err) {
    req.log.error({ err }, "Upload energy bill failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to upload bill" });
  }
});

// GET /organisations/:orgId/energy/email-address
router.get("/email-address", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const org = await db.query.organisationsTable.findFirst({
      where: eq(organisationsTable.id, orgId),
    });
    if (!org) {
      res.status(404).json({ error: "Not Found", message: "Organisation not found" });
      return;
    }
    res.json({
      emailAddress: org.inboundEmailAddress,
      instructions:
        "Forward or email your energy bill PDFs to this address. Bills are automatically processed and added to your energy readings. Ensure the PDF is attached to the email.",
    });
  } catch (err) {
    req.log.error({ err }, "Get email address failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to get email address" });
  }
});

// POST /webhooks/energy/inbound-email (external router)
export const energyEmailWebhookRouter = Router();

energyEmailWebhookRouter.post("/inbound-email", async (req, res) => {
  try {
    const expectedSecret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
    const isDev = process.env.NODE_ENV !== "production";
    if (!expectedSecret && !isDev) {
      await logAudit({ req, action: "webhook.energy.inbound_email", outcome: "failure", details: { reason: "secret_not_configured" } });
      res.status(503).json({ error: "Service Unavailable", message: "Webhook secret not configured" });
      return;
    }
    if (expectedSecret) {
      // Accept secret in Authorization header, x-webhook-secret header, or ?secret= query param
      const authHeader = req.headers["authorization"] || req.headers["x-webhook-secret"];
      const headerSecret = typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/i, "") : "";
      const querySecret = typeof req.query.secret === "string" ? req.query.secret : "";
      const providedSecret = headerSecret || querySecret;
      if (providedSecret !== expectedSecret) {
        await logAudit({ req, action: "webhook.energy.inbound_email", outcome: "failure", details: { reason: "invalid_secret" } });
        res.status(401).json({ error: "Unauthorized", message: "Invalid webhook secret" });
        return;
      }
    }

    const { to, from, subject, text, attachments } = req.body;
    if (!to) {
      await logAudit({ req, action: "webhook.energy.inbound_email", outcome: "failure", details: { reason: "missing_to_field" } });
      res.status(400).json({ error: "Bad Request", message: "Missing 'to' field" });
      return;
    }

    // Extract bare email address — email services sometimes send "Display Name <addr>" or ["addr1","addr2"]
    function extractEmail(raw: string | string[]): string {
      const str = Array.isArray(raw) ? raw[0] : raw;
      const match = str.match(/<([^>]+)>/);
      return (match ? match[1] : str).trim().toLowerCase();
    }
    const toEmail = extractEmail(to);

    const org = await db.query.organisationsTable.findFirst({
      where: eq(organisationsTable.inboundEmailAddress, toEmail),
    });

    if (!org) {
      await logAudit({ req, action: "webhook.energy.inbound_email", outcome: "failure", details: { reason: "org_not_found", to } });
      res.json({ message: "Email address not matched to any organisation" });
      return;
    }

    interface EmailAttachment { contentType?: string; filename?: string; content?: string; }
    const pdfAttachments = ((attachments || []) as EmailAttachment[]).filter((a) =>
      a.contentType?.includes("pdf") || a.filename?.toLowerCase().endsWith(".pdf"),
    );

    const insertedIds: string[] = [];
    const liveGrid = await getCurrentGridIntensity();

    for (const attachment of pdfAttachments) {
      const content = attachment.content || "";
      const kwhMatch = content.match(/(\d+(?:\.\d+)?)\s*(?:kWh|KWH)/i);
      const usageKwh = kwhMatch ? parseFloat(kwhMatch[1]) : undefined;

      const now = new Date();
      const periodEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      const periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

      const { factorKgCo2PerKwh, method, note } = resolveElectricityFactor({
        periodStart,
        liveGridKgCo2PerKwh: liveGrid?.kgco2PerKwh,
      });

      const readingId = uuidv4();
      await db.insert(energyReadingsTable).values({
        id: readingId,
        organisationId: org.id,
        utilityType: "electricity",
        periodStart,
        periodEnd,
        usageKwh,
        co2eKg: calcEnergyCo2e({ utilityType: "electricity", usageKwh, electricityFactorKgCo2PerKwh: factorKgCo2PerKwh }),
        gridIntensityKgCo2PerKwh: factorKgCo2PerKwh,
        emissionMethod: method,
        emissionNote: note,
        source: "email_inbound",
        originalFileName: attachment.filename,
        rawText: `From: ${from}\nSubject: ${subject}\n${text || ""}`.substring(0, 1000),
      });
      insertedIds.push(readingId);
    }

    await logAudit({
      req,
      action: "webhook.energy.inbound_email",
      outcome: "success",
      resourceType: "energy_reading",
      organisationId: org.id,
      details: { from, subject, attachmentsProcessed: pdfAttachments.length, readingIds: insertedIds },
    });
    res.json({ message: "Email processed" });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error", message: "Failed to process email" });
  }
});

export default router;
