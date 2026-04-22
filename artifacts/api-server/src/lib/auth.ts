import type { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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
 * Resolve the authenticated user from the express-session cookie.
 *
 * Auth is performed by /auth/magic-link/verify (email magic link) or
 * /auth/passkey/login/verify (WebAuthn assertion); both set
 * `req.session.userId`. Subsequent requests look up the user by that id and
 * always read fresh role + isActive from the DB so admin role/lock changes
 * take effect on the very next request.
 */
async function resolveUser(req: Request): Promise<AuthenticatedUser | null> {
  const userId = req.session?.userId;
  if (!userId) return null;

  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, userId),
  });

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
    // hitting tenant APIs with their existing session.
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
