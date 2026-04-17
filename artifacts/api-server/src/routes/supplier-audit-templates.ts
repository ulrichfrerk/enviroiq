import { Router } from "express";
import { db, supplierAuditTemplatesTable } from "@workspace/db";
import { and, eq, isNull, or } from "drizzle-orm";
import { requireAuth, requireOrgAccess, requireOrgAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";

const router = Router({ mergeParams: true });

// GET — list templates available to this org (org-specific + global default)
router.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const rows = await db.select().from(supplierAuditTemplatesTable)
      .where(or(
        eq(supplierAuditTemplatesTable.organisationId, orgId),
        isNull(supplierAuditTemplatesTable.organisationId),
      ));
    res.json(rows.map((t) => ({ ...t, schema: undefined }))); // omit heavy schema in list
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

// GET /:templateId — full template with parsed schema
router.get("/:templateId", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const row = await db.query.supplierAuditTemplatesTable.findFirst({
      where: and(
        eq(supplierAuditTemplatesTable.id, req.params.templateId),
        or(
          eq(supplierAuditTemplatesTable.organisationId, orgId),
          isNull(supplierAuditTemplatesTable.organisationId),
        ),
      ),
    });
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    let parsedSchema: unknown = null;
    try { parsedSchema = JSON.parse(row.schema); } catch { /* ignore */ }
    res.json({ ...row, schema: parsedSchema });
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

// PATCH /:templateId — adjust section weights (must sum to 100). Cannot edit global default.
router.patch("/:templateId", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const row = await db.query.supplierAuditTemplatesTable.findFirst({
      where: eq(supplierAuditTemplatesTable.id, req.params.templateId),
    });
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    if (row.organisationId !== orgId) {
      res.status(403).json({ error: "Forbidden", message: "Cannot edit a template you don't own" });
      return;
    }
    const { weightEnvironmental, weightSocial, weightGovernance, weightSupplyChain, isActive, name, description } = req.body ?? {};
    const sum = (weightEnvironmental ?? row.weightEnvironmental)
      + (weightSocial ?? row.weightSocial)
      + (weightGovernance ?? row.weightGovernance)
      + (weightSupplyChain ?? row.weightSupplyChain);
    if (sum !== 100) {
      res.status(400).json({ error: "Validation error", message: "Section weights must total 100" });
      return;
    }
    const [updated] = await db.update(supplierAuditTemplatesTable).set({
      weightEnvironmental: weightEnvironmental ?? row.weightEnvironmental,
      weightSocial: weightSocial ?? row.weightSocial,
      weightGovernance: weightGovernance ?? row.weightGovernance,
      weightSupplyChain: weightSupplyChain ?? row.weightSupplyChain,
      isActive: isActive ?? row.isActive,
      name: name ?? row.name,
      description: description ?? row.description,
      updatedAt: new Date(),
    }).where(eq(supplierAuditTemplatesTable.id, req.params.templateId)).returning();
    await logAudit({ req, action: "supplier_template.update", resourceType: "supplier_audit_template", resourceId: req.params.templateId });
    res.json(updated);
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

export default router;
