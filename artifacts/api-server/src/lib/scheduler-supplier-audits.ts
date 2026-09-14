// Background scheduler for the supplier ESG audit lifecycle.
// Responsibilities:
//   1. Auto-create + send audits when a supplier's nextAuditDueAt enters the
//      "due in 30 days" window and there is no open audit on file.
//   2. Send 7-day reminder for open audits whose dueAt is within 7 days.
//   3. Send overdue alerts and mark audits expired once dueAt passes.
//
// Runs hourly. Idempotent — uses the audit's `remindersSent` JSON to avoid
// duplicate emails, and per-cycle uniqueness via `nextAuditDueAt` window.

import { and, desc, eq, isNull, lt, lte, gt, gte, or } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  db,
  suppliersTable,
  supplierAuditsTable,
  supplierAuditTemplatesTable,
  organisationsTable,
} from "@workspace/db";
import { logger } from "./logger.js";
import { sendSupplierAuditInviteEmail, sendSupplierAuditReminderEmail } from "./mailer.js";
import { recordSupplierAuditEvent } from "./supplier-audit-events.js";

function appBase(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const dom = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (dom) return `https://${dom}/app`;
  return "http://localhost:5173";
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function buildAuditUrl(auditId: string, secret: string): string {
  return `${appBase()}/audits/${auditId}/${secret}`;
}

interface ReminderRecord { type: "30d" | "7d" | "overdue"; sentAt: string; }

function parseReminders(raw: string | null): ReminderRecord[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as ReminderRecord[]; } catch { return []; }
}

async function autoCreateDueAudits(now: Date) {
  const horizon = new Date(now.getTime() + 30 * 86400_000);
  // Suppliers due in the FUTURE 0-30 day window only.
  // Excluding overdue suppliers (nextAuditDueAt < now) is intentional: those
  // are handled by the manual "Send audit" UI (or the operator has already
  // chosen not to chase them). Including them here would create a tight loop
  // with `expireOverdue` — auto-create + auto-expire on every tick + spam.
  const dueSuppliers = await db.select().from(suppliersTable).where(and(
    eq(suppliersTable.status, "active"),
    gte(suppliersTable.nextAuditDueAt, now),
    lte(suppliersTable.nextAuditDueAt, horizon),
  ));
  for (const sup of dueSuppliers) {
    if (!sup.primaryContactEmail) continue;
    // Skip if there's already an open audit for this supplier
    const open = await db.query.supplierAuditsTable.findFirst({
      where: and(
        eq(supplierAuditsTable.supplierId, sup.id),
        or(
          eq(supplierAuditsTable.status, "sent"),
          eq(supplierAuditsTable.status, "in_progress"),
          eq(supplierAuditsTable.status, "draft"),
        ),
      ),
    });
    if (open) continue;

    const tpl = await db.query.supplierAuditTemplatesTable.findFirst({
      where: and(isNull(supplierAuditTemplatesTable.organisationId), eq(supplierAuditTemplatesTable.isDefault, true)),
    });
    if (!tpl) { logger.warn("Default template missing — cannot auto-create audit"); continue; }

    const org = await db.query.organisationsTable.findFirst({ where: eq(organisationsTable.id, sup.organisationId) });
    if (!org) continue;

    const id = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const dueAt = sup.nextAuditDueAt ?? new Date(now.getTime() + 30 * 86400_000);
    // Bump the supplier's nextAuditDueAt forward by the cycle now so the next
    // tick won't try to create another audit while this one is still open.
    // The actual final nextAuditDueAt is reset on submission inside public-audits.ts.
    const tentativeNext = new Date(dueAt);
    tentativeNext.setMonth(tentativeNext.getMonth() + (sup.auditFrequencyMonths || 12));
    await db.update(suppliersTable)
      .set({ nextAuditDueAt: tentativeNext, updatedAt: new Date() })
      .where(eq(suppliersTable.id, sup.id));
    // Fail-closed: if the effective question set cannot be computed we skip
    // this supplier for this tick rather than ship the full template. The
    // scheduler runs hourly so transient errors auto-recover; persistent
    // failures stay visible in logs.
    let questionsSnapshot: string[];
    try {
      const { computeEffectiveQuestionIds, getOverridesForOrg } =
        await import("./supplier-question-overrides.js");
      const schemaParsed = JSON.parse(tpl.schema);
      const overrides = await getOverridesForOrg(sup.organisationId, tpl.id, sup.id);
      questionsSnapshot = computeEffectiveQuestionIds(schemaParsed, overrides, sup.id);
    } catch (err) {
      logger.error({ err, supplierId: sup.id }, "Failed to compute effective question set — skipping auto-send this tick");
      // Roll back the tentative nextAuditDueAt bump so we retry next cycle.
      await db.update(suppliersTable)
        .set({ nextAuditDueAt: sup.nextAuditDueAt, updatedAt: new Date() })
        .where(eq(suppliersTable.id, sup.id));
      continue;
    }
    await db.insert(supplierAuditsTable).values({
      id,
      organisationId: sup.organisationId,
      supplierId: sup.id,
      templateId: tpl.id,
      templateVersion: tpl.version,
      status: "sent",
      tokenHash: sha256(secret),
      recipientEmail: sup.primaryContactEmail,
      recipientName: sup.primaryContactName,
      dueAt,
      sentAt: new Date(),
      remindersSent: JSON.stringify([{ type: "30d", sentAt: now.toISOString() }] satisfies ReminderRecord[]),
      questionsSnapshot,
    });
    const url = buildAuditUrl(id, secret);
    const dueLabel = dueAt.toLocaleDateString("en-NZ", { dateStyle: "long" });
    await sendSupplierAuditInviteEmail(
      sup.primaryContactEmail,
      sup.primaryContactName ?? sup.legalName,
      org.name,
      url,
      dueLabel,
    ).catch((err) => logger.warn({ err, supplierId: sup.id }, "Auto-send invite email failed"));
    await recordSupplierAuditEvent({
      organisationId: sup.organisationId, auditId: id,
      eventType: "created", actorType: "system",
      payload: { autoCreated: true, dueAt: dueAt.toISOString() },
    });
    await recordSupplierAuditEvent({
      organisationId: sup.organisationId, auditId: id,
      eventType: "sent", actorType: "system",
    });
    logger.info({ supplierId: sup.id, auditId: id }, "Auto-created supplier audit");
  }
}

async function sendDueReminders(now: Date) {
  const sevenDays = new Date(now.getTime() + 7 * 86400_000);
  const open = await db.select().from(supplierAuditsTable).where(and(
    or(eq(supplierAuditsTable.status, "sent"), eq(supplierAuditsTable.status, "in_progress")),
    lte(supplierAuditsTable.dueAt, sevenDays),
    gt(supplierAuditsTable.dueAt, now),
  ));
  for (const audit of open) {
    const reminders = parseReminders(audit.remindersSent);
    if (reminders.some((r) => r.type === "7d")) continue;
    const org = await db.query.organisationsTable.findFirst({ where: eq(organisationsTable.id, audit.organisationId) });
    if (!org) continue;
    // Re-issue a fresh secret-only-token so we don't email an actual reusable link
    // (the original secret was hashed, we don't have plaintext). Spec the link as
    // an invite to "open via the email you received" — but in practice we mint a
    // new token and update tokenHash so the reminder link is functional.
    const secret = randomBytes(32).toString("base64url");
    await db.update(supplierAuditsTable).set({
      tokenHash: sha256(secret),
      remindersSent: JSON.stringify([...reminders, { type: "7d", sentAt: now.toISOString() }]),
      updatedAt: new Date(),
    }).where(eq(supplierAuditsTable.id, audit.id));
    const url = buildAuditUrl(audit.id, secret);
    const dueLabel = new Date(audit.dueAt).toLocaleDateString("en-NZ", { dateStyle: "long" });
    await sendSupplierAuditReminderEmail(audit.recipientEmail, org.name, url, dueLabel, "7d")
      .catch((err) => logger.warn({ err, auditId: audit.id }, "7-day reminder email failed"));
    await recordSupplierAuditEvent({
      organisationId: audit.organisationId, auditId: audit.id,
      eventType: "reminder_sent", actorType: "system",
      payload: { type: "7d" },
    });
  }
}

async function expireOverdue(now: Date) {
  const overdue = await db.select().from(supplierAuditsTable).where(and(
    or(eq(supplierAuditsTable.status, "sent"), eq(supplierAuditsTable.status, "in_progress")),
    lt(supplierAuditsTable.dueAt, now),
  ));
  for (const audit of overdue) {
    const reminders = parseReminders(audit.remindersSent);
    const alreadyOverdue = reminders.some((r) => r.type === "overdue");
    await db.update(supplierAuditsTable).set({
      status: "expired",
      expiredAt: now,
      remindersSent: alreadyOverdue ? audit.remindersSent : JSON.stringify([...reminders, { type: "overdue", sentAt: now.toISOString() }]),
      updatedAt: new Date(),
    }).where(eq(supplierAuditsTable.id, audit.id));
    if (!alreadyOverdue) {
      const org = await db.query.organisationsTable.findFirst({ where: eq(organisationsTable.id, audit.organisationId) });
      const secret = randomBytes(32).toString("base64url");
      // Mint new token in case the supplier still wants to act on it.
      await db.update(supplierAuditsTable).set({ tokenHash: sha256(secret) }).where(eq(supplierAuditsTable.id, audit.id));
      const url = buildAuditUrl(audit.id, secret);
      const dueLabel = new Date(audit.dueAt).toLocaleDateString("en-NZ", { dateStyle: "long" });
      if (org) {
        await sendSupplierAuditReminderEmail(audit.recipientEmail, org.name, url, dueLabel, "overdue")
          .catch((err) => logger.warn({ err, auditId: audit.id }, "Overdue notice email failed"));
      }
    }
    await recordSupplierAuditEvent({
      organisationId: audit.organisationId, auditId: audit.id,
      eventType: "expired", actorType: "system",
    });
  }
}

let running = false;

export async function runSupplierAuditTick(): Promise<void> {
  await tick();
}

async function tick() {
  if (running) return; // skip overlapping ticks
  running = true;
  const now = new Date();
  try {
    await autoCreateDueAudits(now);
    await sendDueReminders(now);
    await expireOverdue(now);
  } catch (err) {
    logger.error({ err }, "Supplier audit scheduler tick failed");
  } finally {
    running = false;
  }
}

export function startSupplierAuditScheduler(intervalMs = 60 * 60 * 1000) {
  logger.info({ intervalMs }, "Supplier ESG audit scheduler started");
  // Kick the first tick on boot, then on a fixed interval.
  void tick();
  setInterval(() => { void tick(); }, intervalMs);
}
