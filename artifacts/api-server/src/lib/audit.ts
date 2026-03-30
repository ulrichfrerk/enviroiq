import { db, auditLogsTable } from "@workspace/db";
import { v4 as uuidv4 } from "uuid";
import type { Request } from "express";

export async function logAudit({
  req,
  action,
  resourceType,
  resourceId,
  details,
  outcome = "success",
  organisationId,
  userId,
  userEmail,
}: {
  req?: Request;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  outcome?: "success" | "failure";
  organisationId?: string;
  userId?: string;
  userEmail?: string;
}) {
  try {
    const session = req?.session;
    await db.insert(auditLogsTable).values({
      id: uuidv4(),
      organisationId: organisationId ?? session?.organisationId,
      userId: userId ?? session?.userId,
      userEmail: userEmail ?? session?.email,
      action,
      resourceType,
      resourceId,
      ipAddress: req ? (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress : undefined,
      userAgent: req?.headers["user-agent"],
      details: details ? JSON.stringify(details) : undefined,
      outcome,
    });
  } catch {
    // Audit log failures must never crash the app
  }
}
