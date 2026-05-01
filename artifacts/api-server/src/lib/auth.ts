import type { Request, Response, NextFunction } from "express";
import { db, usersTable, organisationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { checkOrgLoginAllowed } from "./org-active-guard.js";

export type SignInMethod = "magic_link" | "passkey" | "google_sso" | "microsoft_sso";

export interface SignInPolicyResult {
  ok: boolean;
  /** True when this allow-through is the org_admin break-glass path. */
  breakGlass?: boolean;
  reason?:
    | "org_missing"
    | "method_not_allowed"
    | "required_provider_mismatch"
    | "provider_disabled";
  message?: string;
}

/**
 * Check whether `userRole` in `organisationId` may sign in via `method`.
 *
 * Org policy rules:
 *  - If `googleSsoEnabled` / `microsoftSsoEnabled` is false, that provider is refused.
 *  - The method must be in `allowedSignInMethods`.
 *  - If `requiredSsoProvider` is set, only that provider's SSO is allowed.
 *
 * Break-glass: an `org_admin` (or higher) is ALWAYS permitted to sign in via
 * `magic_link` regardless of the policy — this prevents an admin from locking
 * themselves out of their own tenant. Callers must audit the break-glass path
 * (`auth.break_glass_magic_link`).
 *
 * Super admins bypass org policy entirely (no organisation).
 */
export async function checkSignInMethodAllowed(
  organisationId: string | null,
  userRole: string,
  method: SignInMethod,
): Promise<SignInPolicyResult> {
  if (userRole === "super_admin" || !organisationId) return { ok: true };

  const org = await db.query.organisationsTable.findFirst({
    where: eq(organisationsTable.id, organisationId),
  });
  if (!org) return { ok: false, reason: "org_missing", message: "Organisation not found" };

  // Per-provider master switch
  if (method === "google_sso" && org.googleSsoEnabled === false) {
    return { ok: false, reason: "provider_disabled", message: "Google sign-in is disabled for this organisation." };
  }
  if (method === "microsoft_sso" && org.microsoftSsoEnabled === false) {
    return { ok: false, reason: "provider_disabled", message: "Microsoft sign-in is disabled for this organisation." };
  }

  const allowed = (org.allowedSignInMethods ?? []) as SignInMethod[];
  const isInAllowList = allowed.includes(method);

  // Required SSO provider — overrides the allow-list for non-SSO methods.
  if (org.requiredSsoProvider) {
    const requiredMethod: SignInMethod =
      org.requiredSsoProvider === "google" ? "google_sso" : "microsoft_sso";
    if (method !== requiredMethod) {
      // Break-glass: admins can still magic-link in.
      if (userRole === "org_admin" && method === "magic_link") {
        return { ok: true, breakGlass: true };
      }
      return {
        ok: false,
        reason: "required_provider_mismatch",
        message: `This organisation requires sign-in with ${org.requiredSsoProvider === "google" ? "Google" : "Microsoft"}.`,
      };
    }
  }

  if (!isInAllowList) {
    if (userRole === "org_admin" && method === "magic_link") {
      return { ok: true, breakGlass: true };
    }
    return {
      ok: false,
      reason: "method_not_allowed",
      message: "This sign-in method is not enabled for your organisation. Contact your administrator.",
    };
  }
  return { ok: true };
}

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
