import { Router } from "express";
import { db } from "@workspace/db";
import { subcontractorsTable, insertSubcontractorSchema, subcontractorHsRecordsTable, insertSubcontractorHsRecordSchema } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, requireOrgAccess } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { randomUUID } from "crypto";

const router = Router({ mergeParams: true });

// ── Subcontractors ────────────────────────────────────────────────────────────

router.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const rows = await db.select().from(subcontractorsTable)
      .where(eq(subcontractorsTable.organisationId, orgId))
      .orderBy(subcontractorsTable.companyName);
    res.json(rows);
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

router.post("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const parsed = insertSubcontractorSchema.safeParse({ ...req.body, id: randomUUID(), organisationId: orgId });
    if (!parsed.success) { res.status(400).json({ error: "Validation error", issues: parsed.error.issues }); return; }
    const [row] = await db.insert(subcontractorsTable).values(parsed.data).returning();
    await logAudit({ req, action: "subcontractor.create", resourceType: "subcontractor", resourceId: row.id });
    res.status(201).json(row);
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

router.patch("/:subId", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const { id: _id, organisationId: _oid, createdAt: _ca, updatedAt: _ua, ...updates } = req.body;
    const [row] = await db.update(subcontractorsTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(subcontractorsTable.id, req.params.subId), eq(subcontractorsTable.organisationId, orgId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await logAudit({ req, action: "subcontractor.update", resourceType: "subcontractor", resourceId: req.params.subId });
    res.json(row);
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

router.delete("/:subId", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    await db.delete(subcontractorsTable).where(and(eq(subcontractorsTable.id, req.params.subId), eq(subcontractorsTable.organisationId, orgId)));
    res.status(204).end();
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

// ── HS Records per subcontractor ──────────────────────────────────────────────

router.get("/:subId/records", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const rows = await db.select().from(subcontractorHsRecordsTable)
      .where(and(eq(subcontractorHsRecordsTable.subcontractorId, req.params.subId), eq(subcontractorHsRecordsTable.organisationId, orgId)))
      .orderBy(desc(subcontractorHsRecordsTable.recordDate));
    res.json(rows);
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

router.post("/:subId/records", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const parsed = insertSubcontractorHsRecordSchema.safeParse({
      ...req.body, id: randomUUID(), organisationId: orgId, subcontractorId: req.params.subId
    });
    if (!parsed.success) { res.status(400).json({ error: "Validation error", issues: parsed.error.issues }); return; }
    const [row] = await db.insert(subcontractorHsRecordsTable).values(parsed.data).returning();
    res.status(201).json(row);
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

export default router;
