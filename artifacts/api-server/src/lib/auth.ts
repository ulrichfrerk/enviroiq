import type { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Unauthorized", message: "Authentication required" });
    return;
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.userId) {
      res.status(401).json({ error: "Unauthorized", message: "Authentication required" });
      return;
    }
    const role = req.session.role ?? "";
    if (!roles.includes(role)) {
      res.status(403).json({ error: "Forbidden", message: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export function requireOrgAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Unauthorized", message: "Authentication required" });
    return;
  }
  const orgId = req.params.orgId as string;
  const { role, organisationId } = req.session;
  if (role !== "super_admin" && organisationId !== orgId) {
    res.status(403).json({ error: "Forbidden", message: "Access denied to this organisation" });
    return;
  }
  next();
}

export function requireOrgAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Unauthorized", message: "Authentication required" });
    return;
  }
  const orgId = req.params.orgId as string;
  const { role, organisationId } = req.session;
  if (role !== "super_admin" && organisationId !== orgId) {
    res.status(403).json({ error: "Forbidden", message: "Access denied to this organisation" });
    return;
  }
  // Read-only roles cannot mutate
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
