import { Router } from "express";
import { db, energyReadingsTable, organisationsTable } from "@workspace/db";
import { eq, and, gte, lte, count } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";
import { requireAuth, requireOrgAccess, requireOrgAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { calcEnergyCo2e } from "../lib/emissions.js";

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
    const { utilityType, provider, periodStart, periodEnd, usageKwh, usageMj, costAmount, costCurrency } = req.body;
    if (!utilityType || !periodStart || !periodEnd) {
      res.status(400).json({ error: "Bad Request", message: "utilityType, periodStart, periodEnd required" });
      return;
    }

    const co2eKg = calcEnergyCo2e({ utilityType, usageKwh, usageMj });

    const [reading] = await db.insert(energyReadingsTable).values({
      id: uuidv4(),
      organisationId: orgId,
      utilityType,
      provider,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      usageKwh,
      usageMj,
      costAmount,
      costCurrency: costCurrency || "NZD",
      co2eKg,
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
    const { utilityType } = req.body;

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

    // Default period: last month
    const now = new Date();
    const periodEnd = new Date(now.getFullYear(), now.getMonth(), 0); // last day of prev month
    const periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1); // first day of prev month

    const co2eKg = calcEnergyCo2e({ utilityType, usageKwh });

    const [reading] = await db.insert(energyReadingsTable).values({
      id: uuidv4(),
      organisationId: orgId,
      utilityType,
      periodStart,
      periodEnd,
      usageKwh,
      costAmount,
      co2eKg,
      source: "pdf_upload",
      originalFileName: req.file.originalname,
      rawText: fileText.substring(0, 1000),
    }).returning();

    await logAudit({
      req,
      action: "energy_bill.upload",
      resourceType: "energy_reading",
      resourceId: reading.id,
      details: { filename: req.file.originalname },
    });

    res.status(201).json({
      reading,
      parsedFields: { usageKwh, cost: costAmount, periodStart, periodEnd },
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
    if (expectedSecret) {
      const authHeader = req.headers["authorization"] || req.headers["x-webhook-secret"];
      const providedSecret = typeof authHeader === "string"
        ? authHeader.replace(/^Bearer\s+/i, "")
        : "";
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

    const org = await db.query.organisationsTable.findFirst({
      where: eq(organisationsTable.inboundEmailAddress, to),
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
    for (const attachment of pdfAttachments) {
      const content = attachment.content || "";
      const kwhMatch = content.match(/(\d+(?:\.\d+)?)\s*(?:kWh|KWH)/i);
      const usageKwh = kwhMatch ? parseFloat(kwhMatch[1]) : undefined;

      const now = new Date();
      const periodEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      const periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

      const readingId = uuidv4();
      await db.insert(energyReadingsTable).values({
        id: readingId,
        organisationId: org.id,
        utilityType: "electricity",
        periodStart,
        periodEnd,
        usageKwh,
        co2eKg: calcEnergyCo2e({ utilityType: "electricity", usageKwh }),
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
