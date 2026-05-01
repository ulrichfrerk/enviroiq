// Foundation notification system — fans out a single domain event into
// per-recipient `notifications` rows, with idempotency keyed on `dedupeKey`,
// and dispatches an email via Resend when the severity warrants immediate
// delivery (severity=error). Severity=warn rows are picked up by the daily
// 8am NZ digest scheduler in scheduler.ts.
//
// v1 contract (no per-user prefs UI yet):
//   * recipients = every active org_admin/super_admin in the org.
//   * If the org has zero eligible recipients we fall back to platform
//     super_admins and tag the email/notification with category
//     `orphaned_org_no_admins` so platform ops can investigate.
//   * Users without a clerkUserId (pre-existing passkey-era users who haven't
//     signed in via Clerk yet) still receive notifications; the email channel
//     uses the email column, the bell icon binds to user id.

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  notificationEventsTable,
  notificationsTable,
  organisationsTable,
  usersTable,
  type Notification,
} from "@workspace/db";
import { logger } from "./logger.js";
import { sendNotificationEmail } from "./mailer.js";

export type NotificationSeverity = "info" | "warn" | "error";

export interface NotifyInput {
  organisationId: string;
  category: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  /** Deep link into the app (e.g. `/energy?tab=upload`). Optional. */
  linkUrl?: string;
  /** Audit row this event was raised from. Optional but strongly recommended. */
  sourceAuditId?: string;
  /** Free-form structured context surfaced in the digest email. */
  context?: Record<string, unknown>;
  /**
   * Idempotency key. Typical patterns:
   *   - `upload.energy_bill:${orgId}:${auditId}` for one-off events
   *   - `webhook.fleet.invalid_api_key:${orgId}:${ymd}` for noisy daily caps
   * Repeat fires of the same key produce no rows.
   */
  dedupeKey: string;
}

export interface NotifyResult {
  /** False when the dedupeKey already existed (no fan-out, no emails). */
  created: boolean;
  eventId: string | null;
  recipientCount: number;
  emailsSent: number;
}

interface ResolvedRecipient {
  id: string;
  email: string;
  name: string | null;
}

/**
 * Resolve the set of users who should receive a notification for `orgId`.
 * v1: every active org_admin / super_admin in the org. If zero, fall back to
 * platform super_admins so the event isn't lost.
 */
async function resolveRecipients(orgId: string): Promise<{
  recipients: ResolvedRecipient[];
  orphanFallback: boolean;
}> {
  const admins = await db
    .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.organisationId, orgId),
        eq(usersTable.isActive, true),
        inArray(usersTable.role, ["org_admin", "super_admin"]),
      ),
    );

  if (admins.length > 0) return { recipients: admins, orphanFallback: false };

  // Fall back to platform super_admins (no orgId or any orgId), filtered to
  // active. These rows are typically the EnviroIQ ops team.
  const platform = await db
    .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(and(eq(usersTable.role, "super_admin"), eq(usersTable.isActive, true)));

  return { recipients: platform, orphanFallback: true };
}

/**
 * Fire a notification. Idempotent on `dedupeKey`. Safe to call from request
 * handlers — never throws (errors are logged so they don't crash the parent
 * audit/upload flow).
 */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
  try {
    // Step 1 (outside tx): resolve recipients + load org for email branding.
    // These are read-only and we don't want them inside the tx — they widen
    // the lock window and the data wouldn't change inside a single fan-out.
    const [{ recipients, orphanFallback }, org] = await Promise.all([
      resolveRecipients(input.organisationId),
      db.query.organisationsTable.findFirst({
        where: eq(organisationsTable.id, input.organisationId),
      }),
    ]);

    const eventId = randomUUID();
    const now = new Date();
    const rows = recipients.map((r) => ({
      id: randomUUID(),
      organisationId: input.organisationId,
      recipientUserId: r.id,
      category: orphanFallback ? `${input.category} (orphaned_org_no_admins)` : input.category,
      severity: input.severity,
      title: input.title,
      body: input.body,
      linkUrl: input.linkUrl,
      sourceAuditId: input.sourceAuditId,
      sourceEventId: eventId,
      createdAt: now,
    }));

    // Step 2 (inside tx): insert event row + fan out recipient rows
    // atomically. If the dedupeKey already exists, the event insert returns
    // 0 rows and we short-circuit. If the recipient-row insert *throws*,
    // the event row rolls back too — so a retry with the same dedupeKey
    // can re-attempt the full fan-out instead of being silently skipped
    // (the bug the architect flagged on review).
    const txResult = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(notificationEventsTable)
        .values({
          id: eventId,
          organisationId: input.organisationId,
          category: input.category,
          severity: input.severity,
          title: input.title,
          body: input.body,
          linkUrl: input.linkUrl,
          sourceAuditId: input.sourceAuditId,
          context: input.context,
          dedupeKey: input.dedupeKey,
        })
        .onConflictDoNothing({ target: notificationEventsTable.dedupeKey })
        .returning({ id: notificationEventsTable.id });

      if (inserted.length === 0) return { duplicated: true as const };
      if (rows.length > 0) await tx.insert(notificationsTable).values(rows);
      return { duplicated: false as const };
    });

    if (txResult.duplicated) {
      // Already fanned out for this dedupeKey.
      return { created: false, eventId: null, recipientCount: 0, emailsSent: 0 };
    }

    if (recipients.length === 0) {
      logger.warn(
        { orgId: input.organisationId, category: input.category, dedupeKey: input.dedupeKey },
        "Notification has no recipients (no org admins, no platform super_admins) — event row kept for ops",
      );
      return { created: true, eventId, recipientCount: 0, emailsSent: 0 };
    }

    // Step 4: email side-channel — immediate for severity=error, batched
    // for severity=warn via the daily digest scheduler.
    let emailsSent = 0;
    if (input.severity === "error") {
      const orgName = org?.name ?? "your organisation";
      await Promise.all(
        rows.map(async (row, i) => {
          const recipient = recipients[i];
          try {
            const result = await sendNotificationEmail(
              recipient.email,
              recipient.name ?? recipient.email,
              orgName,
              input.title,
              input.body,
              input.linkUrl,
            );
            if (result.sent) emailsSent++;
            await db
              .update(notificationsTable)
              .set({ emailSentAt: new Date() })
              .where(eq(notificationsTable.id, row.id));
          } catch (err) {
            logger.warn(
              { err, recipient: recipient.email, dedupeKey: input.dedupeKey },
              "Notification email failed — bell icon row still created",
            );
          }
        }),
      );
    }

    logger.info(
      {
        orgId: input.organisationId,
        category: input.category,
        severity: input.severity,
        recipients: recipients.length,
        emailsSent,
        dedupeKey: input.dedupeKey,
        orphanFallback,
      },
      "Notification fanned out",
    );

    return { created: true, eventId, recipientCount: recipients.length, emailsSent };
  } catch (err) {
    logger.error({ err, input }, "notify() failed — failure swallowed to protect caller flow");
    return { created: false, eventId: null, recipientCount: 0, emailsSent: 0 };
  }
}

/**
 * Daily digest tick. Picks every notification row created since the last
 * tick where severity=warn AND email_sent_at IS NULL, groups by recipient,
 * and sends one rollup email per user. Called from scheduler.ts at 8am NZ.
 */
export async function sendNotificationDigests(): Promise<{ users: number; rows: number }> {
  const pending = await db
    .select({
      id: notificationsTable.id,
      recipientUserId: notificationsTable.recipientUserId,
      organisationId: notificationsTable.organisationId,
      category: notificationsTable.category,
      title: notificationsTable.title,
      body: notificationsTable.body,
      linkUrl: notificationsTable.linkUrl,
      createdAt: notificationsTable.createdAt,
    })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.severity, "warn"),
        isNull(notificationsTable.emailSentAt),
        isNull(notificationsTable.dismissedAt),
      ),
    );

  if (pending.length === 0) return { users: 0, rows: 0 };

  const byRecipient = new Map<string, typeof pending>();
  for (const row of pending) {
    const arr = byRecipient.get(row.recipientUserId) ?? [];
    arr.push(row);
    byRecipient.set(row.recipientUserId, arr);
  }

  let userCount = 0;
  let rowCount = 0;
  for (const [userId, rows] of byRecipient) {
    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
    if (!user || !user.isActive) continue;
    const org = await db.query.organisationsTable.findFirst({
      where: eq(organisationsTable.id, rows[0].organisationId),
    });
    const summary = rows
      .map((r) => `• ${r.title} — ${r.body}`)
      .join("\n");
    try {
      await sendNotificationEmail(
        user.email,
        user.name ?? user.email,
        org?.name ?? "your organisation",
        `Daily ESG data quality digest (${rows.length} item${rows.length === 1 ? "" : "s"})`,
        summary,
        undefined,
      );
      const now = new Date();
      await db
        .update(notificationsTable)
        .set({ emailSentAt: now })
        .where(
          inArray(
            notificationsTable.id,
            rows.map((r) => r.id),
          ),
        );
      userCount++;
      rowCount += rows.length;
    } catch (err) {
      logger.warn({ err, userId }, "Daily notification digest email failed");
    }
  }
  logger.info({ userCount, rowCount }, "Notification digest sent");
  return { users: userCount, rows: rowCount };
}

export type { Notification };

// Drizzle import is referenced through the SQL helper in some queries; keep
// to avoid unused-import noise if tree-shaken differently in tests.
void sql;
