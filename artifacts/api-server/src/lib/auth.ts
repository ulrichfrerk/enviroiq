import type { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = (req as any).session;
  if (!session?.userId) {
    res.status(401).json({ error: "Unauthorized", message: "Authentication required" });
    return;
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const session = (req as any).session;
    if (!session?.userId) {
      res.status(401).json({ error: "Unauthorized", message: "Authentication required" });
      return;
    }
    if (!roles.includes(session.role)) {
      res.status(403).json({ error: "Forbidden", message: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export function requireOrgAccess(req: Request, res: Response, next: NextFunction) {
  const session = (req as any).session;
  if (!session?.userId) {
    res.status(401).json({ error: "Unauthorized", message: "Authentication required" });
    return;
  }
  const { orgId } = req.params;
  if (session.role !== "super_admin" && session.organisationId !== orgId) {
    res.status(403).json({ error: "Forbidden", message: "Access denied to this organisation" });
    return;
  }
  next();
}
