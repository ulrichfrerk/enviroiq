import { Router } from "express";
import { db, usersTable, magicLinksTable, organisationsTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { randomBytes, createHash } from "node:crypto";
import { requireAuth, requireOrgAccess, requireRole } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { sendInviteEmail } from "../lib/mailer.js";

const VALID_SIGN_IN_METHODS = ["magic_link", "passkey", "google_sso", "microsoft_sso"] as const;
type ValidSignInMethod = (typeof VALID_SIGN_IN_METHODS)[number];
const VALID_REQUIRED_PROVIDERS = ["none", "google", "microsoft"] as const;

const router = Router({ mergeParams: true });

const INVITE_LINK_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — matches invite email copy.

function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function appBaseUrl(req: { get(name: string): string | undefined; protocol: string; headers: Record<string, unknown> }): string {
  const host = req.get("host");
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  return `${proto}://${host}`;
}

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

    // Issue an invite magic-link and email it. Failure here must NOT roll back
    // the user record (the admin can re-trigger by inviting again or the user
    // can request a sign-in link themselves), but we surface the email status
    // in the response so the UI can show "invite sent" vs "user created — email failed".
    let inviteEmailSent = false;
    let inviteEmailError: string | null = null;
    try {
      const org = await db.query.organisationsTable.findFirst({
        where: eq(organisationsTable.id, orgId),
      });
      const orgName = org?.name || "your organisation";

      const token = newToken(32);
      const expiresAt = new Date(Date.now() + INVITE_LINK_TTL_MS);
      await db.insert(magicLinksTable).values({
        id: uuidv4(),
        userId: user.id,
        token: hashToken(token),
        expiresAt,
      });

      const url = `${appBaseUrl(req)}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`;
      const result = await sendInviteEmail(email, name, orgName, url);
      inviteEmailSent = result.sent;
      await logAudit({
        req,
        action: "user.invite_email",
        outcome: result.sent ? "success" : "failure",
        userId: user.id,
        details: { devMode: result.devMode },
      });
    } catch (err) {
      inviteEmailError = err instanceof Error ? err.message : "unknown";
      req.log.error({ err, userId: user.id, email }, "Invite email send failed");
      await logAudit({
        req,
        action: "user.invite_email",
        outcome: "failure",
        userId: user.id,
        details: { error: inviteEmailError },
      });
    }

    res.status(201).json({ ...user, inviteEmailSent, inviteEmailError });
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

// GET /organisations/:orgId/users/:userId/sign-in-policy
// Returns the per-user override (NULLs mean "inherit org") plus the org policy
// snapshot, so the admin UI can render the inherited values as placeholders.
router.get("/:userId/sign-in-policy", requireAuth, requireRole("super_admin", "org_admin"), requireOrgAccess, async (req, res) => {
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
    const org = await db.query.organisationsTable.findFirst({
      where: eq(organisationsTable.id, orgId),
    });
    res.json({
      userId: user.id,
      requiredSignInProvider: user.requiredSignInProvider, // null | "none" | "google" | "microsoft"
      allowedSignInMethods: user.allowedSignInMethods,     // null | array
      orgPolicy: {
        googleSsoEnabled: org?.googleSsoEnabled ?? true,
        microsoftSsoEnabled: org?.microsoftSsoEnabled ?? true,
        allowedSignInMethods: org?.allowedSignInMethods ?? [],
        requiredSsoProvider: org?.requiredSsoProvider ?? null,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Get user sign-in policy failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to load sign-in policy" });
  }
});

// PATCH /organisations/:orgId/users/:userId/sign-in-policy
// Accepts { requiredSignInProvider, allowedSignInMethods }. Either field may be:
//   - omitted          → leave unchanged
//   - explicitly null  → clear override (inherit org)
//   - a value          → set override
// Audit event `user.sign_in_policy.changed` is emitted with previous/new values.
router.patch("/:userId/sign-in-policy", requireAuth, requireRole("super_admin", "org_admin"), requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const userId = req.params.userId as string;
    const body = req.body as {
      requiredSignInProvider?: unknown;
      allowedSignInMethods?: unknown;
    };

    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (Object.prototype.hasOwnProperty.call(body, "requiredSignInProvider")) {
      const v = body.requiredSignInProvider;
      if (v !== null && (typeof v !== "string" || !(VALID_REQUIRED_PROVIDERS as readonly string[]).includes(v))) {
        res.status(400).json({
          error: "Bad Request",
          message: "requiredSignInProvider must be null, 'none', 'google', or 'microsoft'",
        });
        return;
      }
      update.requiredSignInProvider = v;
    }

    if (Object.prototype.hasOwnProperty.call(body, "allowedSignInMethods")) {
      const v = body.allowedSignInMethods;
      if (v !== null) {
        if (
          !Array.isArray(v) ||
          v.length === 0 ||
          !v.every(
            (m): m is ValidSignInMethod =>
              typeof m === "string" && (VALID_SIGN_IN_METHODS as readonly string[]).includes(m),
          )
        ) {
          res.status(400).json({
            error: "Bad Request",
            message:
              "allowedSignInMethods must be null (inherit) or a non-empty array of: " +
              VALID_SIGN_IN_METHODS.join(", "),
          });
          return;
        }
        update.allowedSignInMethods = Array.from(new Set(v)) as ValidSignInMethod[];
      } else {
        update.allowedSignInMethods = null;
      }
    }

    const previous = await db.query.usersTable.findFirst({
      where: and(eq(usersTable.id, userId), eq(usersTable.organisationId, orgId)),
    });
    if (!previous) {
      res.status(404).json({ error: "Not Found", message: "User not found" });
      return;
    }

    // Effective-usability invariant: don't let an admin save an override that
    // would lock this user out (e.g. allowedSignInMethods=["google_sso"] when
    // the org has Google disabled, or requiredSignInProvider="google" with
    // the chosen allow-list excluding google_sso). Mirrors the org-level
    // check in PATCH /organisations/:orgId/sso-policy.
    const org = await db.query.organisationsTable.findFirst({
      where: eq(organisationsTable.id, orgId),
    });
    if (!org) {
      res.status(404).json({ error: "Not Found", message: "Organisation not found" });
      return;
    }
    const nextRequired = (Object.prototype.hasOwnProperty.call(update, "requiredSignInProvider")
      ? (update.requiredSignInProvider as string | null)
      : (previous.requiredSignInProvider as string | null)) ?? null;
    const nextAllowedRaw = Object.prototype.hasOwnProperty.call(update, "allowedSignInMethods")
      ? (update.allowedSignInMethods as ValidSignInMethod[] | null)
      : (previous.allowedSignInMethods as ValidSignInMethod[] | null);
    const effectiveRequired: "google" | "microsoft" | null =
      nextRequired === "google" || nextRequired === "microsoft"
        ? nextRequired
        : nextRequired === "none"
          ? null
          : ((org.requiredSsoProvider as "google" | "microsoft" | null) ?? null);
    const effectiveAllowed: ValidSignInMethod[] =
      nextAllowedRaw && nextAllowedRaw.length > 0
        ? nextAllowedRaw
        : ((org.allowedSignInMethods as ValidSignInMethod[] | null) ?? [...VALID_SIGN_IN_METHODS]);

    const usable = effectiveAllowed.filter((m) => {
      if (m === "magic_link" || m === "passkey") return effectiveRequired === null;
      if (m === "google_sso") return org.googleSsoEnabled && (effectiveRequired ?? "google") === "google";
      if (m === "microsoft_sso") return org.microsoftSsoEnabled && (effectiveRequired ?? "microsoft") === "microsoft";
      return false;
    });
    // Allow admins to be saved into a state that ordinarily would lock out a
    // non-admin, since they retain magic-link break-glass anyway.
    if (usable.length === 0 && previous.role !== "org_admin" && previous.role !== "super_admin") {
      res.status(400).json({
        error: "Bad Request",
        message:
          "These restrictions would lock this user out — at least one allowed sign-in method must be effectively reachable. Adjust allowedSignInMethods or requiredSignInProvider so they are mutually consistent with the organisation policy.",
      });
      return;
    }

    const [updated] = await db
      .update(usersTable)
      .set(update)
      .where(and(eq(usersTable.id, userId), eq(usersTable.organisationId, orgId)))
      .returning();

    await logAudit({
      req,
      action: "user.sign_in_policy.changed",
      resourceType: "user",
      resourceId: userId,
      previousValue: {
        requiredSignInProvider: previous.requiredSignInProvider,
        allowedSignInMethods: previous.allowedSignInMethods,
      },
      newValue: {
        requiredSignInProvider: updated.requiredSignInProvider,
        allowedSignInMethods: updated.allowedSignInMethods,
      },
    });

    res.json({
      userId: updated.id,
      requiredSignInProvider: updated.requiredSignInProvider,
      allowedSignInMethods: updated.allowedSignInMethods,
      orgPolicy: {
        googleSsoEnabled: org.googleSsoEnabled,
        microsoftSsoEnabled: org.microsoftSsoEnabled,
        allowedSignInMethods: org.allowedSignInMethods ?? [],
        requiredSsoProvider: org.requiredSsoProvider,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Update user sign-in policy failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to update sign-in policy" });
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
