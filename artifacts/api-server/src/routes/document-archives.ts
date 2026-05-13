import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, documentArchivesTable, organisationsTable } from "@workspace/db";
import { requireAuth, requireOrgAccess, requireOrgAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import {
  listArchivesForOrg,
  getOrgArchiveRetentionMonths,
  DEFAULT_RETENTION_MONTHS,
  MIN_RETENTION_MONTHS,
  MAX_RETENTION_MONTHS,
} from "../lib/documentArchive.js";

const router: Router = Router({ mergeParams: true });

// GET /organisations/:orgId/document-archives
// List archived docs (metadata only) for the org. Org members can view; only admins can download.
router.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const [result, retentionMonths] = await Promise.all([
      listArchivesForOrg(orgId, { limit, offset }),
      getOrgArchiveRetentionMonths(orgId),
    ]);
    res.json({
      ...result,
      retentionPolicy: {
        retentionMonths,
        defaultMonths: DEFAULT_RETENTION_MONTHS,
        minMonths: MIN_RETENTION_MONTHS,
        maxMonths: MAX_RETENTION_MONTHS,
        configurable: true,
        description: `All ingested compliance documents are held for ${retentionMonths} month${retentionMonths === 1 ? "" : "s"} from capture, then the file content is permanently purged. The metadata row (filename, size, hash, capture/purge timestamps) is retained as evidence the document was held and lawfully purged. Org admins can change this from Settings → Compliance.`,
      },
    });
  } catch (err) {
    req.log.error({ err }, "List document archives failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// GET /organisations/:orgId/document-archives/policy
// Read the org's compliance archive retention setting. Admin-only —
// the policy itself is sensitive (controls audit-trail length).
router.get("/policy", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const retentionMonths = await getOrgArchiveRetentionMonths(orgId);
    res.json({
      retentionMonths,
      defaultMonths: DEFAULT_RETENTION_MONTHS,
      minMonths: MIN_RETENTION_MONTHS,
      maxMonths: MAX_RETENTION_MONTHS,
      note: "Applies at capture time. Changing this does NOT alter expires_at on already-archived documents — historical rows keep the retention they were captured under.",
    });
  } catch (err) {
    req.log.error({ err }, "Get document archive policy failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// PATCH /organisations/:orgId/document-archives/policy
// Update the org's compliance archive retention. Strictly org_admin (or
// super_admin) — note that requireOrgAdmin in this codebase also allows
// org_user, which is fine for downloads but too loose for a setting that
// controls how soon compliance evidence is destroyed. We re-check the role
// here so an org_user can't shorten retention to fast-forward a purge.
router.patch("/policy", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const role = req.user?.role;
    if (role !== "super_admin" && role !== "org_admin") {
      res.status(403).json({
        error: "Forbidden",
        message: "Only organisation admins can change the compliance archive retention policy",
      });
      return;
    }
    const body = req.body as { retentionMonths?: unknown };
    const months = Number(body.retentionMonths);
    if (
      !Number.isFinite(months) ||
      !Number.isInteger(months) ||
      months < MIN_RETENTION_MONTHS ||
      months > MAX_RETENTION_MONTHS
    ) {
      res.status(400).json({
        error: "Bad Request",
        message: `retentionMonths must be an integer between ${MIN_RETENTION_MONTHS} and ${MAX_RETENTION_MONTHS}`,
      });
      return;
    }

    // Capture previous value for the audit trail before mutating.
    const previous = await getOrgArchiveRetentionMonths(orgId);
    const [updated] = await db
      .update(organisationsTable)
      .set({ documentArchiveRetentionMonths: months, updatedAt: new Date() })
      .where(eq(organisationsTable.id, orgId))
      .returning({ id: organisationsTable.id });

    if (!updated) {
      res.status(404).json({ error: "Not Found", message: "Organisation not found" });
      return;
    }

    await logAudit({
      req,
      action: "document_archive.policy.update",
      resourceType: "organisation",
      resourceId: orgId,
      organisationId: orgId,
      details: {
        previousRetentionMonths: previous,
        newRetentionMonths: months,
        appliesTo: "future_captures_only",
      },
    });

    res.json({
      retentionMonths: months,
      previousRetentionMonths: previous,
      defaultMonths: DEFAULT_RETENTION_MONTHS,
      minMonths: MIN_RETENTION_MONTHS,
      maxMonths: MAX_RETENTION_MONTHS,
    });
  } catch (err) {
    req.log.error({ err }, "Update document archive policy failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// GET /organisations/:orgId/document-archives/:id/download
// Stream the original file content. Admin-only. Audit-logged.
router.get("/:id/download", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const id    = req.params.id  as string;

    const [row] = await db
      .select()
      .from(documentArchivesTable)
      .where(and(eq(documentArchivesTable.id, id), eq(documentArchivesTable.organisationId, orgId)))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    if (!row.content || row.purgedAt) {
      await logAudit({
        req,
        action: "document_archive.download",
        outcome: "failure",
        resourceType: "document_archive",
        resourceId: id,
        organisationId: orgId,
        details: { reason: "purged", purgedAt: row.purgedAt, originalFilename: row.originalFilename },
      });
      res.status(410).json({
        error: "Gone",
        message: "Document has been purged under the 6-month retention policy",
        purgedAt: row.purgedAt,
        originalFilename: row.originalFilename,
        sizeBytes: row.sizeBytes,
        sha256: row.sha256,
      });
      return;
    }

    await logAudit({
      req,
      action: "document_archive.download",
      resourceType: "document_archive",
      resourceId: id,
      organisationId: orgId,
      details: {
        originalFilename: row.originalFilename,
        sizeBytes: row.sizeBytes,
        sha256: row.sha256,
        sourceType: row.sourceType,
      },
    });

    res.setHeader("Content-Type", row.contentType || "application/octet-stream");
    res.setHeader("Content-Length", String(row.sizeBytes));
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${row.originalFilename.replace(/"/g, "")}"`,
    );
    res.setHeader("X-Document-SHA256", row.sha256);
    res.setHeader("X-Document-Captured-At", row.capturedAt.toISOString());
    res.setHeader("X-Document-Expires-At", row.expiresAt.toISOString());
    res.send(row.content);
  } catch (err) {
    req.log.error({ err }, "Download document archive failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
