import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { checkOrgLoginAllowed } from "./org-active-guard.js";

/**
 * Authenticated user, populated by `requireAuth` and consumed by all
 * downstream guards (`requireRole`, `requireOrgAccess`, `requireOrgAdmin`)
 * and by route handlers via `req.user`.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  organisationId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Resolve the authenticated Clerk user to a local `users` row. On a user's
 * first sign-in via Clerk, match by email (passkey-era users keep their org +
 * role) and back-fill `clerk_user_id`. Subsequent requests look up by
 * `clerk_user_id` directly. Brand-new emails are auto-provisioned as
 * `org_viewer` with no organisation — they must be assigned to an org by an
 * admin before they can access tenant data.
 */
async function resolveUser(req: Request): Promise<AuthenticatedUser | null> {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) return null;

  // 1. Fast path — match by clerk_user_id
  let user = await db.query.usersTable.findFirst({
    where: eq(usersTable.clerkUserId, clerkUserId),
  });

  // 2. First sign-in path — match by email, back-fill clerk_user_id
  if (!user) {
    let email: string | undefined;
    let firstName = "";
    let lastName = "";
    try {
      const cu = await clerkClient.users.getUser(clerkUserId);
      email = cu.primaryEmailAddress?.emailAddress?.toLowerCase();
      firstName = cu.firstName ?? "";
      lastName = cu.lastName ?? "";
    } catch (err) {
      req.log?.error({ err, clerkUserId }, "clerkClient.users.getUser failed");
      return null;
    }
    if (!email) return null;

    const existing = await db.query.usersTable.findFirst({
      where: eq(usersTable.email, email),
    });

    // Atomic upsert keyed on `email` so two concurrent first-sign-in requests
    // cannot both insert a duplicate row. If the user already exists (passkey
    // era), we link the Clerk id; otherwise we create a fresh `org_viewer`
    // with no organisation. We still race-resolve against `clerk_user_id`
    // (e.g. an admin pre-created the user with a different email casing) by
    // re-selecting after the upsert.
    const displayName = `${firstName} ${lastName}`.trim() || email;
    try {
      const [upserted] = await db
        .insert(usersTable)
        .values({
          id: uuidv4(),
          email,
          name: displayName,
          role: "org_viewer",
          clerkUserId,
          lastLoginAt: new Date(),
        })
        .onConflictDoUpdate({
          target: usersTable.email,
          // Only set clerk_user_id when the existing row hasn't claimed a
          // *different* Clerk user already — protects against email-takeover.
          set: {
            clerkUserId: sql`COALESCE(${usersTable.clerkUserId}, ${clerkUserId})`,
            lastLoginAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning();
      user = upserted;
    } catch (err) {
      req.log?.error({ err, email, clerkUserId }, "first-signin upsert failed");
      return null;
    }

    // If the row's clerk_user_id ended up bound to a *different* Clerk user
    // (concurrent sign-in by a different person on the same email — should be
    // impossible because Clerk enforces email uniqueness, but we defend in
    // depth) reject this request.
    if (user && user.clerkUserId !== clerkUserId) {
      return null;
    }
  }

  if (!user || !user.isActive) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organisationId: user.organisationId,
  };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await resolveUser(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized", message: "Authentication required" });
      return;
    }
    // Centralised lock/suspension enforcement. Runs on EVERY authenticated
    // request so a user whose org is suspended after they signed in can't keep
    // hitting tenant APIs with their existing Clerk session.
    const orgCheck = await checkOrgLoginAllowed(user.organisationId);
    if (!orgCheck.ok) {
      res.status(403).json({
        error: "Forbidden",
        message: orgCheck.message,
        reason: orgCheck.reason,
      });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    req.log?.error({ err }, "requireAuth failed");
    res.status(500).json({ error: "Internal Server Error", message: "Auth resolution failed" });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized", message: "Authentication required" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden", message: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export function requireOrgAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized", message: "Authentication required" });
    return;
  }
  const orgId = req.params.orgId as string;
  const { role, organisationId } = req.user;
  if (role !== "super_admin" && organisationId !== orgId) {
    res.status(403).json({ error: "Forbidden", message: "Access denied to this organisation" });
    return;
  }
  next();
}

export function requireOrgAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized", message: "Authentication required" });
    return;
  }
  const orgId = req.params.orgId as string;
  const { role, organisationId } = req.user;
  if (role !== "super_admin" && organisationId !== orgId) {
    res.status(403).json({ error: "Forbidden", message: "Access denied to this organisation" });
    return;
  }
  if (role === "org_viewer" || role === "org_auditor") {
    res.status(403).json({ error: "Forbidden", message: "Admin access required (read-only role)" });
    return;
  }
  next();
}

/**
 * Roles in EnviroIQ:
 *   super_admin   - cross-tenant, all access (system operator)
 *   org_admin     - full read+write within their organisation
 *   org_user      - read+write for operational data within their organisation
 *   org_viewer    - read-only within their organisation (limited dashboards)
 *   org_auditor   - read-only across all organisation data INCLUDING audit logs
 *                   (purpose-built for external auditors / SOC 2 reviewers)
 */
export const READ_ONLY_ROLES = ["org_viewer", "org_auditor"] as const;
export const ALL_ROLES = ["super_admin", "org_admin", "org_user", "org_viewer", "org_auditor"] as const;
