// Notification read API. Backs the bell icon (popover + badge) and the
// /notifications page in the EnviroIQ web app.
//
// Routes mounted under /api/organisations/:orgId/notifications:
//   GET    /                — paginated list, filterable by category/severity
//   GET    /unread-count    — single integer used by the bell badge
//   POST   /:id/read        — mark one read
//   POST   /:id/dismiss     — soft-delete one (drops out of bell + page)
//   POST   /mark-all-read   — bulk mark every notification read
//
// Authorisation: every route requires requireAuth + requireOrgAccess. We
// then narrow the WHERE clause to recipientUserId = req.user.id so users in
// the same org can only read their own rows. The bell intentionally never
// shows another admin's read/dismiss state.

import { Router } from "express";
import { db, notificationsTable } from "@workspace/db";
import { eq, and, desc, isNull, count, inArray } from "drizzle-orm";
import { requireAuth, requireOrgAccess } from "../lib/auth.js";

const router = Router({ mergeParams: true });

// GET /organisations/:orgId/notifications
router.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const userId = req.user!.id;
    const { category, severity, status } = req.query as {
      category?: string;
      severity?: string;
      status?: "unread" | "read" | "all";
    };
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
    const offset = (page - 1) * limit;

    const conditions = [
      eq(notificationsTable.organisationId, orgId),
      eq(notificationsTable.recipientUserId, userId),
      isNull(notificationsTable.dismissedAt),
    ];
    if (category) conditions.push(eq(notificationsTable.category, category));
    if (severity) conditions.push(eq(notificationsTable.severity, severity));
    if (status === "unread") conditions.push(isNull(notificationsTable.readAt));

    const [items, [{ total }]] = await Promise.all([
      db.select().from(notificationsTable)
        .where(and(...conditions))
        .orderBy(desc(notificationsTable.createdAt))
        .limit(limit).offset(offset),
      db.select({ total: count() }).from(notificationsTable).where(and(...conditions)),
    ]);

    res.json({ items, total, page, limit });
  } catch (err) {
    req.log.error({ err }, "List notifications failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to list notifications" });
  }
});

// GET /organisations/:orgId/notifications/unread-count
router.get("/unread-count", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const userId = req.user!.id;
    const [{ total }] = await db.select({ total: count() }).from(notificationsTable).where(
      and(
        eq(notificationsTable.organisationId, orgId),
        eq(notificationsTable.recipientUserId, userId),
        isNull(notificationsTable.dismissedAt),
        isNull(notificationsTable.readAt),
      ),
    );
    res.json({ count: total });
  } catch (err) {
    req.log.error({ err }, "Unread notification count failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to count unread notifications" });
  }
});

// POST /organisations/:orgId/notifications/:id/read
router.post("/:id/read", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const userId = req.user!.id;
    const id = req.params.id as string;
    const result = await db.update(notificationsTable)
      .set({ readAt: new Date() })
      .where(and(
        eq(notificationsTable.id, id),
        eq(notificationsTable.organisationId, orgId),
        eq(notificationsTable.recipientUserId, userId),
      ))
      .returning({ id: notificationsTable.id });
    if (result.length === 0) {
      res.status(404).json({ error: "Not Found", message: "Notification not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Mark notification read failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to mark notification read" });
  }
});

// POST /organisations/:orgId/notifications/:id/dismiss
router.post("/:id/dismiss", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const userId = req.user!.id;
    const id = req.params.id as string;
    const now = new Date();
    const result = await db.update(notificationsTable)
      .set({ dismissedAt: now, readAt: now })
      .where(and(
        eq(notificationsTable.id, id),
        eq(notificationsTable.organisationId, orgId),
        eq(notificationsTable.recipientUserId, userId),
      ))
      .returning({ id: notificationsTable.id });
    if (result.length === 0) {
      res.status(404).json({ error: "Not Found", message: "Notification not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Dismiss notification failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to dismiss notification" });
  }
});

// POST /organisations/:orgId/notifications/mark-all-read
router.post("/mark-all-read", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const userId = req.user!.id;
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : null;
    const baseConditions = [
      eq(notificationsTable.organisationId, orgId),
      eq(notificationsTable.recipientUserId, userId),
      isNull(notificationsTable.readAt),
    ];
    const whereClause = ids && ids.length > 0
      ? and(...baseConditions, inArray(notificationsTable.id, ids))
      : and(...baseConditions);
    const result = await db.update(notificationsTable)
      .set({ readAt: new Date() })
      .where(whereClause)
      .returning({ id: notificationsTable.id });
    res.json({ ok: true, updated: result.length });
  } catch (err) {
    req.log.error({ err }, "Mark all notifications read failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to mark notifications read" });
  }
});

export default router;
