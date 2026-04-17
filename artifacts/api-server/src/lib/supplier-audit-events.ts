// Helper that writes immutable rows into supplier_audit_events.
// Always best-effort: failure to log MUST NOT block the underlying mutation.
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import { db, supplierAuditEventsTable } from "@workspace/db";
import { logger } from "./logger.js";

export type SupplierAuditEventType =
  | "created"
  | "sent"
  | "opened"
  | "saved"
  | "submitted"
  | "approved"
  | "reminder_sent"
  | "locked"
  | "expired"
  | "revoked"
  | "reopened"
  | "file_uploaded";

export interface RecordEventInput {
  organisationId: string;
  auditId: string;
  eventType: SupplierAuditEventType;
  actorType: "user" | "supplier" | "system";
  actorId?: string | null;
  payload?: Record<string, unknown>;
  req?: Request;
}

export async function recordSupplierAuditEvent(input: RecordEventInput): Promise<void> {
  try {
    await db.insert(supplierAuditEventsTable).values({
      id: randomUUID(),
      organisationId: input.organisationId,
      auditId: input.auditId,
      eventType: input.eventType,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      payload: input.payload ? JSON.stringify(input.payload) : null,
      ipAddress: input.req?.ip ?? null,
      userAgent: input.req?.get("user-agent") ?? null,
    });
  } catch (err) {
    logger.warn({ err, auditId: input.auditId, eventType: input.eventType },
      "Failed to record supplier audit event");
  }
}
