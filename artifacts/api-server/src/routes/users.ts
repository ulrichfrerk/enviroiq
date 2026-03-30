import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireOrgAccess, requireRole } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";

const router = Router({ mergeParams: true });

// GET /organisations/:orgId/users
router.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string as string;
    const users = await db.query.usersTable.findMany({
      where: eq(usersTable.organisationId, orgId),
    });
    const [{ total }] = await db
      .select({ total: count() })
      .from(usersTable)
      .where(eq(usersTable.organisationId, orgId));
    res.json({ items: users, total });
  } catch (err) {
    req.log.error({ err }, "List users failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to list users" });
  }
});

// POST /organisations/:orgId/users
router.post("/", requireAuth, requireRole("super_admin", "org_admin"), requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string as string;
    const { email, name, role } = req.body;
    if (!email || !name || !role) {
      res.status(400).json({ error: "Bad Request", message: "email, name, role required" });
      return;
    }

    const existing = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email) });
    if (existing) {
      res.status(409).json({ error: "Conflict", message: "User with this email already exists" });
      return;
    }

    const [user] = await db
      .insert(usersTable)
      .values({ id: uuidv4(), email, name, role, organisationId: orgId })
      .returning();

    await logAudit({ req, action: "user.create", resourceType: "user", resourceId: user.id, details: { email, role } });
    res.status(201).json(user);
  } catch (err) {
    req.log.error({ err }, "Create user failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to create user" });
  }
});

// GET /organisations/:orgId/users/:userId
router.get("/:userId", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string as string; const userId = req.params.userId as string as string;
    const user = await db.query.usersTable.findFirst({
      where: and(eq(usersTable.id, userId), eq(usersTable.organisationId, orgId)),
    });
    if (!user) {
      res.status(404).json({ error: "Not Found", message: "User not found" });
      return;
    }
    res.json(user);
  } catch (err) {
    req.log.error({ err }, "Get user failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to get user" });
  }
});

// PATCH /organisations/:orgId/users/:userId
router.patch("/:userId", requireAuth, requireRole("super_admin", "org_admin"), requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string as string; const userId = req.params.userId as string as string;
    const { name, role, isActive } = req.body;

    const [user] = await db
      .update(usersTable)
      .set({ name, role, isActive, updatedAt: new Date() })
      .where(and(eq(usersTable.id, userId), eq(usersTable.organisationId, orgId)))
      .returning();

    if (!user) {
      res.status(404).json({ error: "Not Found", message: "User not found" });
      return;
    }
    await logAudit({ req, action: "user.update", resourceType: "user", resourceId: userId });
    res.json(user);
  } catch (err) {
    req.log.error({ err }, "Update user failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to update user" });
  }
});

// DELETE /organisations/:orgId/users/:userId
router.delete("/:userId", requireAuth, requireRole("super_admin", "org_admin"), requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string as string; const userId = req.params.userId as string as string;

    const existing = await db.query.usersTable.findFirst({
      where: and(eq(usersTable.id, userId), eq(usersTable.organisationId, orgId)),
    });
    if (!existing) {
      res.status(404).json({ error: "Not Found", message: "User not found" });
      return;
    }

    await db.delete(usersTable).where(and(eq(usersTable.id, userId), eq(usersTable.organisationId, orgId)));
    await logAudit({ req, action: "user.delete", resourceType: "user", resourceId: userId });
    res.json({ message: "User removed" });
  } catch (err) {
    req.log.error({ err }, "Delete user failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to delete user" });
  }
});

export default router;
