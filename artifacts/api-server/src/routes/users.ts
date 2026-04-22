import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireOrgAccess, requireRole } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";

const router = Router({ mergeParams: true });

const VALID_ORG_ROLES = ["org_admin", "org_viewer"] as const;
type OrgRole = (typeof VALID_ORG_ROLES)[number];

function resolveAllowedRoles(callerRole: string | undefined): OrgRole[] {
  // Super admins and org admins can both invite/promote users to any in-org role.
  // Viewers and other read-only roles cannot manage users at all.
  if (callerRole === "super_admin") return ["org_admin", "org_viewer"];
  if (callerRole === "org_admin")   return ["org_admin", "org_viewer"];
  return [];
}

// GET /organisations/:orgId/users
router.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
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
    const orgId = req.params.orgId as string;
    const { email, name, role } = req.body;
    if (!email || !name || !role) {
      res.status(400).json({ error: "Bad Request", message: "email, name, role required" });
      return;
    }

    const callerRole = req.user?.role;
    const allowedRoles = resolveAllowedRoles(callerRole);
    if (!allowedRoles.includes(role as OrgRole)) {
      res.status(403).json({
        error: "Forbidden",
        message: `Cannot assign role '${role}'. Allowed roles for your level: ${allowedRoles.join(", ")}`,
      });
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
    const orgId = req.params.orgId as string;
    const userId = req.params.userId as string;
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
    const orgId = req.params.orgId as string;
    const userId = req.params.userId as string;
    const { name, role, isActive } = req.body;

    if (role !== undefined) {
      const callerRole = req.user?.role;
      const allowedRoles = resolveAllowedRoles(callerRole);
      if (!allowedRoles.includes(role as OrgRole)) {
        res.status(403).json({
          error: "Forbidden",
          message: `Cannot assign role '${role}'. Allowed roles for your level: ${allowedRoles.join(", ")}`,
        });
        return;
      }
    }

    const updateFields: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updateFields.name = name;
    if (role !== undefined) updateFields.role = role;
    if (isActive !== undefined) updateFields.isActive = isActive;

    const [user] = await db
      .update(usersTable)
      .set(updateFields)
      .where(and(eq(usersTable.id, userId), eq(usersTable.organisationId, orgId)))
      .returning();

    if (!user) {
      res.status(404).json({ error: "Not Found", message: "User not found" });
      return;
    }
    await logAudit({ req, action: "user.update", resourceType: "user", resourceId: userId, details: { role } });
    res.json(user);
  } catch (err) {
    req.log.error({ err }, "Update user failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to update user" });
  }
});

// DELETE /organisations/:orgId/users/:userId
router.delete("/:userId", requireAuth, requireRole("super_admin", "org_admin"), requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const userId = req.params.userId as string;

    const existing = await db.query.usersTable.findFirst({
      where: and(eq(usersTable.id, userId), eq(usersTable.organisationId, orgId)),
    });
    if (!existing) {
      res.status(404).json({ error: "Not Found", message: "User not found" });
      return;
    }

    if (existing.role === "super_admin") {
      res.status(403).json({ error: "Forbidden", message: "Cannot delete a super_admin user" });
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
