import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, documentArchivesTable } from "@workspace/db";
import { requireAuth, requireOrgAccess, requireOrgAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { listArchivesForOrg } from "../lib/documentArchive.js";

const router: Router = Router({ mergeParams: true });

// GET /organisations/:orgId/document-archives
// List archived docs (metadata only) for the org. Org members can view; only admins can download.
router.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const result = await listArchivesForOrg(orgId, { limit, offset });
    res.json({
      ...result,
      retentionPolicy: {
        defaultMonths: 6,
        description:
          "All ingested PDFs are held for 6 months from capture, then the file content is permanently purged. The metadata row (filename, size, hash, capture/purge timestamps) is retained as evidence the document was held and lawfully purged.",
      },
    });
  } catch (err) {
    req.log.error({ err }, "List document archives failed");
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
