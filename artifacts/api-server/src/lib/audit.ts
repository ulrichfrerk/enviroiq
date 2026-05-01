import { db, auditLogsTable } from "@workspace/db";
import { v4 as uuidv4 } from "uuid";
import type { Request } from "express";

export const SOURCE_SYSTEM = "enviroiq";

/**
 * FGC reason_code allow-list (Customer Operations API Standard v1).
 * Lifecycle endpoints (suspend/reactivate/archive/credit-hold/etc.) require
 * one of these codes — anything else returns 400 BAD_REQUEST.
 */
export const FGC_REASON_CODES = [
  "customer_request",
  "billing_non_payment",
  "security_event",
  "compliance_issue",
  "duplicate_record",
  "internal_admin_change",
  "failed_verification",
  "contract_end",
  "fraud_review",
] as const;

export type FgcReasonCode = (typeof FGC_REASON_CODES)[number];

export function isFgcReasonCode(value: unknown): value is FgcReasonCode {
  return typeof value === "string" && (FGC_REASON_CODES as readonly string[]).includes(value);
}

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
  actorType,
  previousValue,
  newValue,
  reasonCode,
  correlationId,
  sourceSystem,
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
  actorType?: "user" | "system" | "api_key" | "scheduler" | "webhook";
  previousValue?: unknown;
  newValue?: unknown;
  reasonCode?: string;
  correlationId?: string;
  sourceSystem?: string;
}) {
  const auditId = uuidv4();
  try {
    const session = req?.session;
    const resolvedActorType =
      actorType ?? (req?.crmApiKey ? "api_key" : session?.userId ? "user" : "system");
    await db.insert(auditLogsTable).values({
      id: auditId,
      organisationId: organisationId ?? session?.organisationId,
      userId: userId ?? session?.userId,
      userEmail: userEmail ?? session?.email,
      actorType: resolvedActorType,
      action,
      resourceType,
      resourceId,
      ipAddress: req
        ? (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress
        : undefined,
      userAgent: req?.headers["user-agent"],
      details: details ? JSON.stringify(details) : undefined,
      previousValue: previousValue !== undefined ? (previousValue as object) : undefined,
      newValue: newValue !== undefined ? (newValue as object) : undefined,
      reasonCode,
      correlationId: correlationId ?? req?.correlationId,
      sourceSystem: sourceSystem ?? SOURCE_SYSTEM,
      outcome,
    });
    return auditId;
  } catch {
    // Audit log failures must never crash the app
    return auditId;
  }
}
