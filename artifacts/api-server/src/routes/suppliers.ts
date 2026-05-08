import { Router } from "express";
import { db, suppliersTable, insertSupplierSchema } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { requireAuth, requireOrgAccess, requireOrgAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";

const router = Router({ mergeParams: true });

// GET /organisations/:orgId/suppliers
router.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const rows = await db.select().from(suppliersTable)
      .where(eq(suppliersTable.organisationId, orgId))
      .orderBy(suppliersTable.legalName);
    res.json(rows);
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

// GET /organisations/:orgId/suppliers/:id
router.get("/:id", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const row = await db.query.suppliersTable.findFirst({
      where: and(eq(suppliersTable.id, req.params.id), eq(suppliersTable.organisationId, orgId)),
    });
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

// POST /organisations/:orgId/suppliers
router.post("/", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const parsed = insertSupplierSchema.safeParse({
      ...req.body,
      id: randomUUID(),
      organisationId: orgId,
    });
    if (!parsed.success) { res.status(400).json({ error: "Validation error", issues: parsed.error.issues }); return; }
    const [row] = await db.insert(suppliersTable).values(parsed.data).returning();
    await logAudit({ req, action: "supplier.create", resourceType: "supplier", resourceId: row.id, organisationId: orgId });
    res.status(201).json(row);
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

// PATCH /organisations/:orgId/suppliers/:id
router.patch("/:id", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const { id: _i, organisationId: _o, createdAt: _c, updatedAt: _u, ...updates } = req.body;
    const [row] = await db.update(suppliersTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(suppliersTable.id, req.params.id), eq(suppliersTable.organisationId, orgId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await logAudit({ req, action: "supplier.update", resourceType: "supplier", resourceId: row.id, organisationId: orgId });
    res.json(row);
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

// DELETE /organisations/:orgId/suppliers/:id
router.delete("/:id", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const result = await db.delete(suppliersTable)
      .where(and(eq(suppliersTable.id, req.params.id), eq(suppliersTable.organisationId, orgId)))
      .returning();
    if (result.length === 0) { res.status(404).json({ error: "Not found" }); return; }
    await logAudit({ req, action: "supplier.delete", resourceType: "supplier", resourceId: req.params.id, organisationId: orgId });
    res.status(204).end();
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

export default router;
