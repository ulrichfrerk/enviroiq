import type { Request, Response, NextFunction } from "express";
import { db, usersTable, organisationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { checkOrgLoginAllowed } from "./org-active-guard.js";

export type SignInMethod = "magic_link" | "passkey" | "google_sso" | "microsoft_sso";

export interface SignInPolicyResult {
  ok: boolean;
  /** True when this allow-through is the org_admin break-glass path. */
  breakGlass?: boolean;
  /** Source of the deciding policy when ok=false (or when an override is present). */
  source?: "user" | "org";
  reason?:
    | "org_missing"
    | "method_not_allowed"
    | "required_provider_mismatch"
    | "provider_disabled";
  message?: string;
}

/**
 * Per-user override snapshot. Either field may be NULL meaning "inherit org".
 * `requiredSignInProvider` accepts the sentinel "none" to explicitly clear an
 * org-level requirement for this user (e.g. an org-wide `requiredSsoProvider`
 * of "google" can be lifted just for one contractor).
 */
export interface UserSignInOverrides {
  requiredSignInProvider?: string | null;
  allowedSignInMethods?: SignInMethod[] | null;
}

/**
 * Check whether `userRole` in `organisationId` may sign in via `method`.
 *
 * Effective policy is computed by overlaying any per-user override on top of
 * the org policy:
 *  - `userOverrides.requiredSignInProvider`:
 *       NULL    → inherit org.requiredSsoProvider
 *       "none"  → user is exempted from any required SSO provider
 *       "google" / "microsoft" → user MUST use that provider
 *  - `userOverrides.allowedSignInMethods`:
 *       NULL    → inherit org.allowedSignInMethods
 *       array   → use this user-specific allow list
 *
 * Org-level rules still apply on top:
 *  - If `googleSsoEnabled` / `microsoftSsoEnabled` is false at the org, that
 *    provider is refused — a per-user override cannot re-enable a master-off
 *    provider (the OAuth client may not even be configured).
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
  userOverrides: UserSignInOverrides = {},
): Promise<SignInPolicyResult> {
  if (userRole === "super_admin" || !organisationId) return { ok: true };

  const org = await db.query.organisationsTable.findFirst({
    where: eq(organisationsTable.id, organisationId),
  });
  if (!org) return { ok: false, reason: "org_missing", message: "Organisation not found" };

  // Per-provider master switch (always org-level — a per-user override cannot
  // re-enable a provider the org has turned off).
  if (method === "google_sso" && org.googleSsoEnabled === false) {
    return { ok: false, source: "org", reason: "provider_disabled", message: "Google sign-in is disabled for this organisation." };
  }
  if (method === "microsoft_sso" && org.microsoftSsoEnabled === false) {
    return { ok: false, source: "org", reason: "provider_disabled", message: "Microsoft sign-in is disabled for this organisation." };
  }

  // Effective allow-list — user override supersedes org list when present.
  // An array (including the empty array) is an explicit user override:
  //   - non-empty → use this user-specific allow list
  //   - empty []  → user is denied every method (defensive: PATCH validation
  //     should already prevent this, but if corrupted/legacy data ever lands
  //     in the row we honour the strictest interpretation rather than silently
  //     falling back to the org list and granting more access than intended).
  // Only `null`/`undefined` means "inherit org".
  const userAllowed = userOverrides.allowedSignInMethods;
  const usingUserAllowed = Array.isArray(userAllowed);
  const allowed: SignInMethod[] = usingUserAllowed
    ? (userAllowed as SignInMethod[])
    : ((org.allowedSignInMethods ?? []) as SignInMethod[]);
  const isInAllowList = allowed.includes(method);

  // Effective required provider — user override supersedes org. The sentinel
  // "none" explicitly clears an org-level requirement for this single user.
  let effectiveRequired: "google" | "microsoft" | null;
  let requiredSource: "user" | "org" = "org";
  const userRequired = userOverrides.requiredSignInProvider;
  if (userRequired === "google" || userRequired === "microsoft") {
    effectiveRequired = userRequired;
    requiredSource = "user";
  } else if (userRequired === "none") {
    effectiveRequired = null;
    requiredSource = "user";
  } else {
    effectiveRequired = (org.requiredSsoProvider as "google" | "microsoft" | null) ?? null;
  }

  if (effectiveRequired) {
    const requiredMethod: SignInMethod =
      effectiveRequired === "google" ? "google_sso" : "microsoft_sso";
    if (method !== requiredMethod) {
      // Break-glass: admins can still magic-link in.
      if (userRole === "org_admin" && method === "magic_link") {
        return { ok: true, breakGlass: true, source: requiredSource };
      }
      return {
        ok: false,
        source: requiredSource,
        reason: "required_provider_mismatch",
        message:
          requiredSource === "user"
            ? `Your account is restricted to sign-in with ${effectiveRequired === "google" ? "Google" : "Microsoft"}.`
            : `This organisation requires sign-in with ${effectiveRequired === "google" ? "Google" : "Microsoft"}.`,
      };
    }
  }

  if (!isInAllowList) {
    if (userRole === "org_admin" && method === "magic_link") {
      return { ok: true, breakGlass: true, source: usingUserAllowed ? "user" : "org" };
    }
    return {
      ok: false,
      source: usingUserAllowed ? "user" : "org",
      reason: "method_not_allowed",
      message: usingUserAllowed
        ? "This sign-in method is not enabled for your account. Contact your administrator."
        : "This sign-in method is not enabled for your organisation. Contact your administrator.",
    };
  }
  return { ok: true, source: usingUserAllowed || requiredSource === "user" ? "user" : "org" };
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
