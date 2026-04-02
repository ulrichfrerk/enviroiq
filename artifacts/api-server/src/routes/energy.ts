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

    // Extract text from PDF (best-effort from first 8KB)
    const fileText = req.file.buffer.toString("utf8", 0, Math.min(req.file.buffer.length, 8000));

    // Auto-detect from bill text; caller may override any field
    const parsed = parseBillText(fileText);
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

    await logAudit({
      req,
      action: "energy_bill.upload",
      resourceType: "energy_reading",
      resourceId: reading.id,
      details: { filename: req.file.originalname, period: `${periodStart.toISOString().slice(0, 7)}`, emissionMethod: method, autoDetected: !utilityTypeOverride },
    });

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
    const batchRenewablePct = req.body.supplierRenewablePct !== undefined
      ? Number(req.body.supplierRenewablePct)
      : undefined;

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
        // Extract readable text from PDF buffer (best-effort from first 8KB)
        const fileText = file.buffer.toString("utf8", 0, Math.min(file.buffer.length, 8000));

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
      filename: string;
      content_type: string;
      size: number;
      download_url: string;
    }
    interface ResendEmailBody {
      text?: string;
      html?: string;
    }

    // Fetch attachment list and email body in parallel
    const [attachResp, emailResp] = await Promise.all([
      fetch(`https://api.resend.com/emails/received/${emailId}/attachments`, {
        headers: { Authorization: `Bearer ${resendApiKey}` },
      }),
      fetch(`https://api.resend.com/emails/received/${emailId}`, {
        headers: { Authorization: `Bearer ${resendApiKey}` },
      }),
    ]);

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
        const pdfText = await dlResp.text(); // text extraction from PDF bytes (best-effort)

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
  } catch (err) {
    req.log?.error({ err }, "Inbound email webhook error");
    // Response already sent (200 Accepted above), so don't send again
  }
});

export default router;
