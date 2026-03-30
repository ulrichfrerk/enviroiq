import { Router } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { eq, and, gte, lte, count } from "drizzle-orm";
import { requireAuth, requireOrgAccess, requireRole } from "../lib/auth.js";

const router = Router({ mergeParams: true });
export const globalAuditRouter = Router();

// GET /organisations/:orgId/audit-logs
router.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { userId, action, from, to } = req.query;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = (page - 1) * limit;

    const conditions = [eq(auditLogsTable.organisationId, orgId)];
    if (userId) conditions.push(eq(auditLogsTable.userId, userId as string));
    if (action) conditions.push(eq(auditLogsTable.action, action as string));
    if (from) conditions.push(gte(auditLogsTable.createdAt, new Date(from as string)));
    if (to) conditions.push(lte(auditLogsTable.createdAt, new Date(to as string)));

    const [items, [{ total }]] = await Promise.all([
      db.select().from(auditLogsTable)
        .where(and(...conditions))
        .orderBy(auditLogsTable.createdAt)
        .limit(limit).offset(offset),
      db.select({ total: count() }).from(auditLogsTable).where(and(...conditions)),
    ]);

    res.json({ items, total, page, limit });
  } catch (err) {
    req.log.error({ err }, "List audit logs failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to list audit logs" });
  }
});

// GET /admin/audit-logs — super admin global view
globalAuditRouter.get("/", requireRole("super_admin"), async (req, res) => {
  try {
    const { orgId } = req.query;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = (page - 1) * limit;

    const conditions = [];
    if (orgId) conditions.push(eq(auditLogsTable.organisationId, orgId as string));

    const [items, [{ total }]] = await Promise.all([
      db.select().from(auditLogsTable)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(auditLogsTable.createdAt)
        .limit(limit).offset(offset),
      db.select({ total: count() }).from(auditLogsTable)
        .where(conditions.length > 0 ? and(...conditions) : undefined),
    ]);

    res.json({ items, total, page, limit });
  } catch (err) {
    req.log.error({ err }, "List all audit logs failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to list audit logs" });
  }
});

export default router;
