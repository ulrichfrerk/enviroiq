import { Router } from "express";
import { db, energyReadingsTable, organisationsTable } from "@workspace/db";
import { eq, and, gte, lte, count } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";
import { requireAuth, requireOrgAccess, requireOrgAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { calcEnergyCo2e, resolveElectricityFactor } from "../lib/emissions.js";
import { getCurrentGridIntensity } from "../lib/em6.js";
import { parseBillText } from "../lib/billParser.js";
import { archiveDocument } from "../lib/documentArchive.js";
import { notify } from "../lib/notifications.js";
import { createRequire } from "module";
// pdf-parse v2 is ESM-first — load the CJS build via createRequire so it works from our ESM bundle
const { PDFParse } = createRequire(import.meta.url)("pdf-parse") as {
  PDFParse: new (opts: { data: Buffer }) => { getText: () => Promise<{ text: string; pages: unknown[] }> };
};

const router = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * Extract readable text from a PDF buffer using pdf-parse v2 (handles FlateDecode/compressed streams).
 * Falls back to latin1 stripping if pdf-parse fails (e.g. encrypted or corrupt PDFs).
 * Returns a string guaranteed safe for PostgreSQL UTF-8 text columns (no null bytes).
 */
async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return (result.text || "")
      .replace(/\0/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 12000); // generous limit for bill parsing
  } catch {
    // Fallback: latin1 decode + strip non-printable control chars
    return buffer
      .toString("latin1", 0, Math.min(buffer.length, 8000))
      .replace(/\0/g, "")
      .replace(/[\x01-\x08\x0E-\x1F\x7F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}

// GET /organisations/:orgId/energy/readings
router.get("/readings", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const { from, to } = req.query;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 500);
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

    await logAudit({ req, action: "energy_reading.create", resourceType: "energy_reading", resourceId: reading.id, organisationId: orgId });
    res.status(201).json(reading);
  } catch (err) {
    req.log.error({ err }, "Create energy reading failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to create energy reading" });
  }
});

// DELETE /organisations/:orgId/energy/readings/:id
router.delete("/readings/:id", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const id    = req.params.id as string;

    const [deleted] = await db
      .delete(energyReadingsTable)
      .where(and(eq(energyReadingsTable.id, id), eq(energyReadingsTable.organisationId, orgId)))
      .returning({ id: energyReadingsTable.id });

    if (!deleted) {
      res.status(404).json({ error: "Not Found", message: "Energy reading not found" });
      return;
    }

    await logAudit({ req, action: "energy_reading.delete", resourceType: "energy_reading", resourceId: id, organisationId: orgId });
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Delete energy reading failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to delete energy reading" });
  }
});

// POST /organisations/:orgId/energy/upload
// Accepts a single PDF bill. When utilityType is omitted the bill parser auto-detects
// utility type, provider, billing period, and usage from the PDF text.
router.post("/upload", requireAuth, requireOrgAdmin, upload.single("file"), async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const { utilityType: utilityTypeOverride, supplierRenewablePct, periodStartOverride, periodEndOverride, provider: providerOverride } = req.body;

    if (!req.file) {
      res.status(400).json({ error: "Bad Request", message: "File required" });
      return;
    }

    // Extract text from PDF using pdf-parse (handles compressed content streams)
    const fileText = await extractPdfText(req.file.buffer);
    req.log.debug({ filename: req.file.originalname, textLength: fileText.length, textPreview: fileText.slice(0, 300) }, "PDF text extracted");

    // Auto-detect from bill text; caller may override any field
    const parsed = parseBillText(fileText);

    // Detect image/scanned PDFs — pdf-parse extracts no text from them
    if (fileText.trim().length < 120) {
      parsed.reviewFlags = [
        "PDF appears to be scanned or image-only — no text could be extracted. Try a digital/email bill instead.",
        ...parsed.reviewFlags,
      ];
      parsed.confidence = Math.max(0.05, (parsed.confidence ?? 0.5) - 0.3);
    }
    req.log.info({ filename: req.file.originalname, provider: parsed.provider, periodStart: parsed.periodStart, periodEnd: parsed.periodEnd, usageKwh: parsed.usageKwh, confidence: parsed.confidence, reviewFlags: parsed.reviewFlags }, "Bill parsed");
    const utilityType = utilityTypeOverride || parsed.utilityType;
    const provider    = providerOverride    || parsed.provider;

    const now = new Date();
    const defaultPeriodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const defaultPeriodEnd   = new Date(now.getFullYear(), now.getMonth(), 0);

    const periodStart = periodStartOverride
      ? new Date(periodStartOverride)
      : (parsed.periodStart ?? defaultPeriodStart);
    const periodEnd   = periodEndOverride
      ? new Date(periodEndOverride)
      : (parsed.periodEnd ?? defaultPeriodEnd);

    const isCurrentYear = periodStart.getFullYear() >= now.getFullYear();
    const liveGrid = isCurrentYear ? await getCurrentGridIntensity() : null;
    const renewablePct = supplierRenewablePct !== undefined ? Number(supplierRenewablePct) : undefined;

    const { factorKgCo2PerKwh, method, note } = resolveElectricityFactor({
      periodStart,
      supplierRenewablePct: renewablePct,
      liveGridKgCo2PerKwh: liveGrid?.kgco2PerKwh,
    });

    const co2eKg = calcEnergyCo2e({
      utilityType,
      usageKwh: parsed.usageKwh,
      usageMj: parsed.usageMj,
      electricityFactorKgCo2PerKwh: factorKgCo2PerKwh,
    });

    const [reading] = await db.insert(energyReadingsTable).values({
      id: uuidv4(),
      organisationId: orgId,
      utilityType,
      provider: provider || undefined,
      periodStart,
      periodEnd,
      usageKwh: parsed.usageKwh,
      usageMj: parsed.usageMj,
      costAmount: parsed.costAmount,
      co2eKg,
      gridIntensityKgCo2PerKwh: utilityType === "electricity" ? factorKgCo2PerKwh : undefined,
      emissionMethod: utilityType === "electricity" ? method : undefined,
      emissionNote: utilityType === "electricity" ? note : undefined,
      supplierRenewablePct: renewablePct,
      source: "pdf_upload",
      originalFileName: req.file.originalname,
      rawText: fileText.substring(0, 1000),
    }).returning();

    // Compliance archive — store original PDF (auto-purge after 6 months)
    await archiveDocument({
      organisationId: orgId,
      sourceType: "energy_bill_upload",
      sourceId: reading.id,
      buffer: req.file.buffer,
      filename: req.file.originalname,
      contentType: req.file.mimetype || "application/pdf",
      capturedByUserId: req.user?.id ?? null,
      capturedByEmail: req.user?.email ?? null,
    });

    const uploadAuditId = await logAudit({
      req,
      action: "energy_bill.upload",
      resourceType: "energy_reading",
      resourceId: reading.id,
      organisationId: orgId,
      details: { filename: req.file.originalname, period: `${periodStart.toISOString().slice(0, 7)}`, emissionMethod: method, autoDetected: !utilityTypeOverride, reviewFlags: parsed.reviewFlags },
    });

    // If the parser surfaced any review flags (low confidence, scanned PDF,
    // missing fields), queue a warn-level notification. Goes into the daily
    // 8am NZ digest rather than firing immediately so a 40-bill batch
    // produces one summary email per admin instead of forty. Dedupe is
    // keyed on the audit row id so the same upload event never produces
    // two warn rows even if the route is replayed.
    if (parsed.reviewFlags.length > 0) {
      void notify({
        organisationId: orgId,
        category: "upload.energy_bill.review",
        severity: "warn",
        title: "Energy bill needs review",
        body: `"${req.file.originalname}" was uploaded but flagged for review:\n${parsed.reviewFlags.map((f) => `- ${f}`).join("\n")}`,
        linkUrl: "/energy",
        sourceAuditId: uploadAuditId,
        dedupeKey: `upload.energy_bill.review:${uploadAuditId}`,
        context: { readingId: reading.id, filename: req.file.originalname, confidence: parsed.confidence, reviewFlags: parsed.reviewFlags },
      });
    }

    res.status(201).json({
      reading,
      parsedFields: {
        utilityType,
        provider,
        usageKwh: parsed.usageKwh,
        usageMj: parsed.usageMj,
        cost: parsed.costAmount,
        periodStart,
        periodEnd,
      },
      emissionFactorUsed: { factorKgCo2PerKwh, method, note },
      confidence: parsed.confidence,
      reviewFlags: parsed.reviewFlags,
      requiresReview: parsed.reviewFlags.length > 0,
    });
  } catch (err) {
    req.log.error({ err }, "Upload energy bill failed");
    const orgId = req.params.orgId as string;
    const filename = req.file?.originalname ?? "unknown.pdf";
    const failAuditId = await logAudit({
      req,
      action: "energy_bill.upload",
      outcome: "failure",
      resourceType: "energy_reading",
      organisationId: orgId,
      details: { filename, error: err instanceof Error ? err.message : String(err) },
    });
    void notify({
      organisationId: orgId,
      category: "upload.energy_bill",
      severity: "error",
      title: "Energy bill upload failed",
      body: `Uploading "${filename}" failed and no reading was created. Please retry, or contact support if the issue persists.`,
      linkUrl: "/energy",
      sourceAuditId: failAuditId,
      dedupeKey: `upload.energy_bill:${failAuditId}`,
      context: { filename, error: err instanceof Error ? err.message : String(err) },
    });
    res.status(500).json({ error: "Internal Server Error", message: "Failed to upload bill" });
  }
});

// POST /organisations/:orgId/energy/upload-batch
// Smart bulk upload: accepts up to 40 PDFs, auto-detects all metadata from each bill.
const uploadBatch = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 40 } });

router.post("/upload-batch", requireAuth, requireOrgAdmin, uploadBatch.array("files", 40), async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const files = req.files as Express.Multer.File[] | undefined;

    // Validate optional renewable % override
    let batchRenewablePct: number | undefined;
    if (req.body.supplierRenewablePct !== undefined && req.body.supplierRenewablePct !== "") {
      const parsed = Number(req.body.supplierRenewablePct);
      if (isNaN(parsed) || parsed < 0 || parsed > 100) {
        res.status(400).json({ error: "Bad Request", message: "supplierRenewablePct must be a number between 0 and 100" });
        return;
      }
      batchRenewablePct = parsed;
    }

    if (!files || files.length === 0) {
      res.status(400).json({ error: "Bad Request", message: "At least one file required" });
      return;
    }

    const now = new Date();
    const defaultPeriodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const defaultPeriodEnd   = new Date(now.getFullYear(), now.getMonth(), 0);

    // Fetch live grid intensity once for all current-period bills
    const liveGrid = await getCurrentGridIntensity();

    interface BatchFileResult {
      filename: string;
      status: "success" | "review" | "error";
      utilityType?: string;
      provider?: string;
      periodStart?: string;
      periodEnd?: string;
      usageKwh?: number;
      usageMj?: number;
      costAmount?: number;
      co2eKg?: number;
      confidence?: number;
      reviewFlags?: string[];
      readingId?: string;
      error?: string;
    }

    const results: BatchFileResult[] = [];

    for (const file of files) {
      try {
        // Extract text from PDF using pdf-parse (handles compressed content streams)
        const fileText = await extractPdfText(file.buffer);

        const parsed = parseBillText(fileText);

        const periodStart = parsed.periodStart ?? defaultPeriodStart;
        const periodEnd   = parsed.periodEnd   ?? defaultPeriodEnd;
        const renewablePct = batchRenewablePct;

        const isCurrentYear = periodStart.getFullYear() >= now.getFullYear();
        const gridForPeriod = isCurrentYear ? liveGrid : null;

        const { factorKgCo2PerKwh, method, note } = resolveElectricityFactor({
          periodStart,
          supplierRenewablePct: renewablePct,
          liveGridKgCo2PerKwh: gridForPeriod?.kgco2PerKwh,
        });

        const co2eKg = calcEnergyCo2e({
          utilityType: parsed.utilityType,
          usageKwh: parsed.usageKwh,
          usageMj: parsed.usageMj,
          electricityFactorKgCo2PerKwh: factorKgCo2PerKwh,
        });

        const readingId = uuidv4();
        await db.insert(energyReadingsTable).values({
          id: readingId,
          organisationId: orgId,
          utilityType: parsed.utilityType,
          provider: parsed.provider,
          periodStart,
          periodEnd,
          usageKwh: parsed.usageKwh,
          usageMj: parsed.usageMj,
          costAmount: parsed.costAmount,
          co2eKg,
          gridIntensityKgCo2PerKwh: parsed.utilityType === "electricity" ? factorKgCo2PerKwh : undefined,
          emissionMethod: parsed.utilityType === "electricity" ? method : undefined,
          emissionNote: parsed.utilityType === "electricity" ? note : undefined,
          supplierRenewablePct: renewablePct,
          source: "pdf_upload",
          originalFileName: file.originalname,
          rawText: fileText.substring(0, 1000),
        });

        // Compliance archive — store original PDF (auto-purge after 6 months)
        await archiveDocument({
          organisationId: orgId,
          sourceType: "energy_bill_batch_upload",
          sourceId: readingId,
          buffer: file.buffer,
          filename: file.originalname,
          contentType: file.mimetype || "application/pdf",
          capturedByUserId: req.user?.id ?? null,
          capturedByEmail: req.user?.email ?? null,
        });

        results.push({
          filename: file.originalname,
          status: parsed.reviewFlags.length > 0 ? "review" : "success",
          utilityType: parsed.utilityType,
          provider: parsed.provider,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          usageKwh: parsed.usageKwh,
          usageMj: parsed.usageMj,
          costAmount: parsed.costAmount,
          co2eKg,
          confidence: parsed.confidence,
          reviewFlags: parsed.reviewFlags,
          readingId,
        });
      } catch (fileErr) {
        req.log.error({ fileErr, filename: file.originalname }, "Batch upload: file processing failed");
        results.push({
          filename: file.originalname,
          status: "error",
          error: fileErr instanceof Error ? fileErr.message : "Processing failed",
        });
      }
    }

    await logAudit({
      req,
      action: "energy_bill.batch_upload",
      resourceType: "energy_reading",
      organisationId: orgId,
      details: {
        totalFiles: files.length,
        success: results.filter(r => r.status === "success").length,
        review: results.filter(r => r.status === "review").length,
        error: results.filter(r => r.status === "error").length,
      },
    });

    res.status(201).json({ results });
  } catch (err) {
    req.log.error({ err }, "Batch upload failed");
    res.status(500).json({ error: "Internal Server Error", message: "Batch upload failed" });
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
// Receives Resend `email.received` webhook events.
// Per Resend docs, the webhook payload contains only metadata — NOT attachment content.
// We must call the Resend API to fetch attachment download URLs, then download the files.
export const energyEmailWebhookRouter = Router();

energyEmailWebhookRouter.post("/inbound-email", async (req, res) => {
  try {
    // ── Auth: accept secret via ?secret= query param (Resend can't send custom headers) ──
    const expectedSecret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
    const isDev = process.env.NODE_ENV !== "production";
    if (expectedSecret) {
      const querySecret = typeof req.query.secret === "string" ? req.query.secret : "";
      const headerSecret = (req.headers["x-webhook-secret"] as string | undefined) ?? "";
      if (querySecret !== expectedSecret && headerSecret !== expectedSecret) {
        await logAudit({ req, action: "webhook.energy.inbound_email", outcome: "failure", details: { reason: "invalid_secret" } });
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    } else if (!isDev) {
      res.status(503).json({ error: "Webhook secret not configured" });
      return;
    }

    // ── Parse Resend webhook envelope ──────────────────────────────────────────
    // Resend sends: { type: "email.received", data: { email_id, from, to, subject, ... } }
    const body = req.body as Record<string, unknown>;
    if (body.type !== "email.received" || !body.data) {
      res.json({ message: "Ignored — not an email.received event" });
      return;
    }

    const data = body.data as {
      email_id: string;
      from: string;
      to: string[];
      subject?: string;
    };

    const emailId = data.email_id;
    const from    = data.from ?? "";
    const subject = data.subject ?? "";
    // `to` is an array of recipient addresses
    const toAddresses: string[] = Array.isArray(data.to) ? data.to : [String(data.to ?? "")];

    // ── DEBUG: one-time capture of the raw Resend webhook shape so we can ────
    // diagnose why every inbound email is reporting `attachmentsProcessed: 0`.
    // Earlier probing showed `GET /emails/received/{id}/attachments` returns
    // 405 Method Not Allowed — Resend's Inbound API has likely moved to
    // delivering attachments inline in the webhook body. This snapshot lets
    // us see what's actually arriving so we can rewire the parser.
    // Remove this block once the Resend payload shape is confirmed.
    try {
      const dataRec = data as Record<string, unknown>;
      const inlineAtts = Array.isArray(dataRec.attachments) ? (dataRec.attachments as Array<Record<string, unknown>>) : null;
      const snapshot = {
        bodyKeys: Object.keys(body),
        dataKeys: Object.keys(dataRec),
        hasInlineAttachments: inlineAtts !== null,
        inlineAttachmentCount: inlineAtts?.length ?? 0,
        inlineAttachmentMeta: inlineAtts?.slice(0, 5).map((a) => ({
          filename: a.filename ?? a.name,
          content_type: a.content_type ?? a.contentType,
          size: a.size,
          contentType: typeof a.content,
          contentLength: typeof a.content === "string" ? a.content.length : undefined,
          hasUrl: typeof a.url === "string" || typeof a.download_url === "string",
          urlPreview: typeof a.url === "string" ? (a.url as string).slice(0, 100) : (typeof a.download_url === "string" ? (a.download_url as string).slice(0, 100) : undefined),
          allKeys: Object.keys(a),
        })) ?? null,
        rawBodySample: JSON.stringify(body, (_k, v) => (typeof v === "string" && v.length > 800 ? `${v.slice(0, 200)}…[+${v.length - 200} chars]` : v)).slice(0, 4500),
      };
      await logAudit({
        req,
        action: "webhook.energy.inbound_email_debug_snapshot",
        outcome: "success",
        details: { emailId, from, subject, toAddresses, snapshot },
      });
    } catch (snapErr) {
      req.log?.warn({ snapErr }, "Failed to record inbound webhook debug snapshot");
    }

    // ── Match to an organisation by inbound email address ─────────────────────
    function bareEmail(s: string): string {
      const m = s.match(/<([^>]+)>/);
      return (m ? m[1] : s).trim().toLowerCase();
    }

    let org: typeof import("@workspace/db")["organisationsTable"]["$inferSelect"] | undefined;
    for (const addr of toAddresses) {
      const candidate = bareEmail(addr);
      const found = await db.query.organisationsTable.findFirst({
        where: eq(organisationsTable.inboundEmailAddress, candidate),
      });
      if (found) { org = found; break; }
    }

    if (!org) {
      req.log?.info({ toAddresses, emailId }, "Inbound email: no org matched");
      await logAudit({ req, action: "webhook.energy.inbound_email", outcome: "failure", details: { reason: "org_not_found", toAddresses } });
      res.json({ message: "No matching organisation" });
      return;
    }

    // ── Sender-based routing: fleet-provider scheduled emails are NOT energy ──
    // bills. Telematics providers (Navman, Geotab, Verizon Connect, Samsara,
    // EROAD, etc.) send recurring fleet/mileage reports as scheduled emails
    // that the customer has often configured to forward to their EnviroIQ
    // inbox. The energy parser would silently produce zero readings and the
    // customer would have no idea their report didn't land. Detect these by
    // sender domain, notify the org admins with clear "import this manually"
    // guidance, and audit the routing decision so we can spot patterns.
    const fromBare = bareEmail(from);
    const fleetSenderRules: Array<{ provider: string; matches: (addr: string) => boolean }> = [
      { provider: "Teletrac Navman", matches: (a) => /(^|@|\.)teletracnavman\.com$/i.test(a) || /(^|@|\.)navman(fleet)?\.com$/i.test(a) },
      { provider: "Geotab",          matches: (a) => /(^|@|\.)geotab\.com$/i.test(a) || /(^|@|\.)mygeotab\.com$/i.test(a) },
      { provider: "Verizon Connect", matches: (a) => /(^|@|\.)verizonconnect\.com$/i.test(a) },
      { provider: "Samsara",         matches: (a) => /(^|@|\.)samsara\.com$/i.test(a) },
      { provider: "EROAD",           matches: (a) => /(^|@|\.)eroad\.(com|co\.nz|com\.au)$/i.test(a) },
    ];
    let fleetProvider = fleetSenderRules.find((r) => r.matches(fromBare))?.provider;
    let fleetMatchedBy: "sender" | "content" = "sender";

    // ── Content-based fallback ────────────────────────────────────────────────
    // Customers often *forward* the scheduled fleet report from their own
    // mailbox (e.g. an exec forwards it from Outlook). The sender then becomes
    // the human, not the provider, so the sender rules above miss it. Detect
    // these by subject + attachment filename patterns and route them the same
    // way — surface the "import manually" notification rather than silently
    // falling into the energy-bill pipeline that produces zero readings.
    if (!fleetProvider) {
      const dataRec = data as Record<string, unknown>;
      const inlineAtts = Array.isArray(dataRec.attachments) ? (dataRec.attachments as Array<Record<string, unknown>>) : [];
      const filenames = inlineAtts
        .map((a) => (typeof a.filename === "string" ? a.filename : (typeof a.name === "string" ? a.name : "")))
        .filter(Boolean)
        .join(" | ");
      const haystack = `${subject}\n${filenames}`.toLowerCase();
      const contentRules: Array<{ provider: string; pattern: RegExp }> = [
        // Navman ships these report names verbatim:
        //   "daily 'Trip Report Daily' report attached" + "Distance Trip ….xlsx"
        //   "monthly 'State Mil(e)age to EnviroIQ' report attached" + "State Mileage ….pdf"
        { provider: "Teletrac Navman", pattern: /\b(distance trip|trip report|state mil(e)?age|teletrac|navman)\b/i },
        { provider: "Geotab",          pattern: /\bgeotab\b/i },
        { provider: "Verizon Connect", pattern: /\bverizon connect\b/i },
        { provider: "Samsara",         pattern: /\bsamsara\b/i },
        { provider: "EROAD",           pattern: /\beroad\b/i },
      ];
      const contentMatch = contentRules.find((r) => r.pattern.test(haystack));
      if (contentMatch) {
        fleetProvider = contentMatch.provider;
        fleetMatchedBy = "content";
      }
    }

    if (fleetProvider) {
      const auditId = await logAudit({
        req,
        action: "webhook.energy.inbound_email",
        outcome: "failure",
        organisationId: org.id,
        details: { reason: "fleet_report_routed_to_energy", from, subject, emailId, fleetProvider, matchedBy: fleetMatchedBy },
      });
      void notify({
        organisationId: org.id,
        category: "webhook.energy.fleet_report_received",
        severity: "warn",
        title: `${fleetProvider} report received — please import manually`,
        body: `${fleetMatchedBy === "content" ? "A forwarded" : "An automatic"} ${fleetProvider} report ("${subject || "(no subject)"}") arrived at your EnviroIQ inbox. ${fleetProvider} fleet reports can't be ingested through the energy-bill pipeline — please import the spreadsheet under Fleet → Import to add it to your emissions data.`,
        linkUrl: "/fleet",
        sourceAuditId: auditId,
        // Dedupe per-email so a Resend retry can't double-fire, but include
        // emailId so a fresh report from the same sender does fire again.
        dedupeKey: `webhook.energy.fleet_report_received:${org.id}:${emailId}`,
        context: { provider: fleetProvider, from, subject, emailId },
      });
      res.json({ message: "Fleet report received — admin notified" });
      return;
    }

    // Acknowledge immediately so Resend doesn't retry while we do API calls
    res.json({ message: "Accepted" });

    // ── Fetch attachment list from Resend API ──────────────────────────────────
    // Resend docs: GET https://api.resend.com/emails/received/{emailId}/attachments
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      req.log?.error("RESEND_API_KEY not set — cannot fetch attachments");
      return;
    }

    interface ResendAttachmentMeta {
      id: string;
      filename?: string | null;
      content_type: string;
      content_id?: string | null;
      content_disposition?: string | null;
      size: number;
      download_url: string;
      expires_at?: string;
    }
    interface ResendEmailBody {
      text?: string;
      html?: string;
    }

    // Fetch attachment list and email body in parallel.
    // Endpoint paths per https://resend.com/docs/api-reference/emails/list-received-email-attachments
    // (the URL segment is `inbound`, NOT `received` — the docs nav says
    // "Received" but the live REST path is `/emails/inbound/{id}/...`).
    const [attachResp, emailResp] = await Promise.all([
      fetch(`https://api.resend.com/emails/inbound/${emailId}/attachments`, {
        headers: { Authorization: `Bearer ${resendApiKey}` },
      }),
      fetch(`https://api.resend.com/emails/inbound/${emailId}`, {
        headers: { Authorization: `Bearer ${resendApiKey}` },
      }),
    ]);

    if (!attachResp.ok) {
      // Loud log so the silent "0 attachments processed" mystery is surfaced.
      const attachErrText = await attachResp.text().catch(() => "");
      req.log?.warn({ emailId, status: attachResp.status, body: attachErrText.slice(0, 500) }, "Resend attachments API call failed — treating as zero attachments");
    }
    if (!emailResp.ok) {
      const emailErrText = await emailResp.text().catch(() => "");
      req.log?.warn({ emailId, status: emailResp.status, body: emailErrText.slice(0, 500) }, "Resend email body API call failed — proceeding with empty body");
    }

    const attachData = attachResp.ok ? (await attachResp.json() as { data?: ResendAttachmentMeta[] }) : { data: [] };
    const emailData  = emailResp.ok  ? (await emailResp.json()  as ResendEmailBody) : {};

    const emailText = emailData.text ?? emailData.html ?? "";
    const allAttachments: ResendAttachmentMeta[] = attachData.data ?? [];
    const pdfAttachments = allAttachments.filter(
      (a) => a.content_type?.includes("pdf") || a.filename?.toLowerCase().endsWith(".pdf"),
    );

    req.log?.info({ emailId, orgId: org.id, totalAttachments: allAttachments.length, pdfCount: pdfAttachments.length }, "Inbound email received");

    const insertedIds: string[] = [];
    const liveGrid = await getCurrentGridIntensity();

    for (const attachment of pdfAttachments) {
      try {
        // Download the actual PDF bytes via the time-limited download_url
        const dlResp = await fetch(attachment.download_url, { signal: AbortSignal.timeout(15000) });
        if (!dlResp.ok) {
          req.log?.warn({ filename: attachment.filename }, "Failed to download attachment");
          continue;
        }
        const pdfBytes = Buffer.from(await dlResp.arrayBuffer());
        // Proper PDF text extraction (handles compressed/FlateDecode streams)
        const pdfText  = await extractPdfText(pdfBytes).catch((e) => {
          req.log?.warn({ err: e, filename: attachment.filename }, "extractPdfText failed for inbound attachment");
          return "";
        });

        // Extract kWh from PDF text content (NZ electricity bill patterns)
        const combinedText = pdfText + "\n" + emailText;
        const kwhPatterns = [
          /total\s+(?:usage|consumption)[^\d]*(\d[\d,]*(?:\.\d+)?)\s*kWh/i,
          /(\d[\d,]*(?:\.\d+)?)\s*kWh/i,
          /kWh[^\d]*(\d[\d,]*(?:\.\d+)?)/i,
        ];
        let usageKwh: number | undefined;
        for (const pattern of kwhPatterns) {
          const m = combinedText.match(pattern);
          if (m) {
            usageKwh = parseFloat(m[1].replace(/,/g, ""));
            break;
          }
        }

        // Attempt to extract billing period from PDF text
        // Pattern: "01 Jan 2026 to 31 Jan 2026" or "January 2026"
        const now = new Date();
        let periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        let periodEnd   = new Date(now.getFullYear(), now.getMonth(), 0);
        const periodMatch = combinedText.match(/(\d{1,2}\s+\w+\s+\d{4})\s+to\s+(\d{1,2}\s+\w+\s+\d{4})/i);
        if (periodMatch) {
          const ps = new Date(periodMatch[1]);
          const pe = new Date(periodMatch[2]);
          if (!isNaN(ps.getTime()) && !isNaN(pe.getTime())) {
            periodStart = ps;
            periodEnd   = pe;
          }
        }

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
          rawText: `From: ${from}\nSubject: ${subject}\n${emailText}`.substring(0, 1000),
        });
        insertedIds.push(readingId);

        // Compliance archive — store original PDF (auto-purge after 6 months)
        await archiveDocument({
          organisationId: org.id,
          sourceType: "energy_bill_email",
          sourceId: readingId,
          buffer: pdfBytes,
          filename: attachment.filename ?? `attachment-${attachment.id}.pdf`,
          contentType: attachment.content_type || "application/pdf",
          senderEmail: bareEmail(from),
          notes: subject ? `Email subject: ${subject}` : null,
        });

        req.log?.info({ readingId, filename: attachment.filename, usageKwh }, "Energy reading created from email attachment");
      } catch (attachErr) {
        req.log?.error({ attachErr, filename: attachment.filename }, "Failed to process attachment");
      }
    }

    await logAudit({
      req,
      action: "webhook.energy.inbound_email",
      outcome: "success",
      resourceType: "energy_reading",
      organisationId: org.id,
      details: { from, subject, emailId, attachmentsProcessed: pdfAttachments.length, readingIds: insertedIds },
    });

    // ── Visibility for the silent-zero case ───────────────────────────────────
    // Up until now, an inbound email that matched an org but produced no
    // readings (no PDF attachment, or a PDF with no parseable kWh, or a
    // forwarded mail whose original PDF lives in a nested message part)
    // logged "success" with `attachmentsProcessed: 0` and the customer never
    // knew. Notify the org admins so they can re-send the bill, attach the
    // PDF directly, or import it manually under Energy → Upload bill.
    if (insertedIds.length === 0) {
      const reason =
        allAttachments.length === 0
          ? "no_attachment"
          : pdfAttachments.length === 0
          ? "no_pdf_attachment"
          : "no_kwh_extracted";
      const reasonBody: Record<typeof reason, string> = {
        no_attachment: `An email from ${from} ("${subject || "(no subject)"}") arrived at your EnviroIQ inbox but had no attachment. If this was a forwarded bill, the original PDF may have been kept as a nested attachment that we can't see — please send the bill PDF directly (not as a forward) or upload it under Energy → Upload bill.`,
        no_pdf_attachment: `An email from ${from} ("${subject || "(no subject)"}") arrived at your EnviroIQ inbox but contained no PDF attachment (we found ${allAttachments.length} non-PDF file${allAttachments.length === 1 ? "" : "s"}). Please re-send with the bill PDF attached, or upload it under Energy → Upload bill.`,
        no_kwh_extracted: `An email from ${from} ("${subject || "(no subject)"}") arrived with ${pdfAttachments.length} PDF attachment${pdfAttachments.length === 1 ? "" : "s"} but we couldn't find a kWh figure to extract. Please review the bill and add the reading manually under Energy → Upload bill.`,
      };
      void notify({
        organisationId: org.id,
        category: "webhook.energy.inbound_email_no_readings",
        severity: "warn",
        title: "Inbound bill email — no readings extracted",
        body: reasonBody[reason],
        linkUrl: "/energy",
        // Dedupe per-email so a Resend retry never double-fires.
        dedupeKey: `webhook.energy.inbound_email_no_readings:${org.id}:${emailId}`,
        context: { from, subject, emailId, reason, totalAttachments: allAttachments.length, pdfCount: pdfAttachments.length },
      });
    }
  } catch (err) {
    req.log?.error({ err }, "Inbound email webhook error");
    // Response already sent (200 Accepted above), so don't send again
  }
});

// POST /organisations/:orgId/energy/debug-parse
// Accepts a PDF and returns the extracted text + parsed fields WITHOUT saving.
// Super-admin diagnostic tool — safe to expose only to org admins.
router.post("/debug-parse", requireAuth, requireOrgAdmin, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "File required" });
      return;
    }
    const fileText = await extractPdfText(req.file.buffer);
    const parsed   = parseBillText(fileText);
    res.json({
      filename: req.file.originalname,
      extractedTextLength: fileText.length,
      extractedTextPreview: fileText.slice(0, 2000),
      parsed,
    });
  } catch (err) {
    req.log.error({ err }, "debug-parse failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
