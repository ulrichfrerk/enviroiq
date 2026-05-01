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
import { sendNotificationEmailBatch, type NotificationEmailItem } from "./mailer.js";

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
  /**
   * Last successful sign-in. NULL means the user has never completed first
   * sign-in (e.g. an admin invited yesterday but who hasn't clicked their
   * magic link yet). The email channel is suppressed for these users — they
   * still get the in-app bell row, so when they do sign in the alert is
   * waiting in the inbox.
   */
  lastLoginAt: Date | null;
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
    .select({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      lastLoginAt: usersTable.lastLoginAt,
    })
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
    .select({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      lastLoginAt: usersTable.lastLoginAt,
    })
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

    // Step 4: email side-channel — one batched Resend call for severity=error
    // (warns are rolled into the per-user daily digest by the scheduler).
    // First-sign-in gate: users whose lastLoginAt is NULL haven't completed
    // sign-in yet, so we skip their email and rely on the bell icon waiting
    // for them. The bell row IS still created above for everyone.
    let emailsSent = 0;
    if (input.severity === "error") {
      const orgName = org?.name ?? "your organisation";
      const emailable = recipients
        .map((recipient, i) => ({ recipient, row: rows[i] }))
        .filter((p) => p.recipient.lastLoginAt !== null);
      const skipped = recipients.length - emailable.length;
      if (skipped > 0) {
        logger.info(
          { orgId: input.organisationId, skipped, dedupeKey: input.dedupeKey },
          "Skipped email channel for recipients who haven't completed first sign-in",
        );
      }

      if (emailable.length > 0) {
        const items: NotificationEmailItem[] = emailable.map((p) => ({
          to: p.recipient.email,
          recipientName: p.recipient.name ?? p.recipient.email,
          orgName,
          title: input.title,
          body: input.body,
          linkUrl: input.linkUrl,
        }));
        try {
          const result = await sendNotificationEmailBatch(items);
          emailsSent = result.sent;
          if (emailsSent > 0) {
            await db
              .update(notificationsTable)
              .set({ emailSentAt: new Date() })
              .where(
                inArray(
                  notificationsTable.id,
                  emailable.map((p) => p.row.id),
                ),
              );
          }
        } catch (err) {
          logger.warn(
            { err, dedupeKey: input.dedupeKey },
            "Notification email batch failed — bell icon rows still created",
          );
        }
      }
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
 * Daily digest tick. Picks every notification row where severity=warn AND
 * email_sent_at IS NULL, optionally restricted to a single organisationId
 * (used by the per-org-time scheduler to fire at the right local 8am for
 * each org), groups by recipient, and sends one rollup email per user.
 */
export async function sendNotificationDigests(
  options: { organisationId?: string } = {},
): Promise<{ users: number; rows: number }> {
  const filters = [
    eq(notificationsTable.severity, "warn"),
    isNull(notificationsTable.emailSentAt),
    isNull(notificationsTable.dismissedAt),
  ];
  if (options.organisationId) {
    filters.push(eq(notificationsTable.organisationId, options.organisationId));
  }
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
    .where(and(...filters));

  if (pending.length === 0) return { users: 0, rows: 0 };

  const byRecipient = new Map<string, typeof pending>();
  for (const row of pending) {
    const arr = byRecipient.get(row.recipientUserId) ?? [];
    arr.push(row);
    byRecipient.set(row.recipientUserId, arr);
  }

  // Build one batch payload across all recipients, then send in a single
  // Resend call (chunked at 100 by the mailer). Bell rows are stamped as
  // emailed only for users we actually emailed; users who haven't completed
  // first sign-in are skipped on the email channel and remain unstamped so
  // they roll into tomorrow's digest (giving them a chance to sign in and
  // see them in the bell first).
  const items: NotificationEmailItem[] = [];
  const stampIds: string[] = [];
  let userCount = 0;
  let rowCount = 0;

  for (const [userId, rows] of byRecipient) {
    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
    if (!user || !user.isActive) continue;
    if (!user.lastLoginAt) {
      logger.info({ userId }, "Digest skipped — recipient has not completed first sign-in");
      continue;
    }
    const org = await db.query.organisationsTable.findFirst({
      where: eq(organisationsTable.id, rows[0].organisationId),
    });
    const summary = rows.map((r) => `• ${r.title} — ${r.body}`).join("\n");
    items.push({
      to: user.email,
      recipientName: user.name ?? user.email,
      orgName: org?.name ?? "your organisation",
      title: `Daily ESG data quality digest (${rows.length} item${rows.length === 1 ? "" : "s"})`,
      body: summary,
    });
    stampIds.push(...rows.map((r) => r.id));
    userCount++;
    rowCount += rows.length;
  }

  if (items.length === 0) {
    logger.info({ userCount: 0, rowCount: 0 }, "Notification digest had no eligible recipients");
    return { users: 0, rows: 0 };
  }

  try {
    await sendNotificationEmailBatch(items);
    const now = new Date();
    await db
      .update(notificationsTable)
      .set({ emailSentAt: now })
      .where(inArray(notificationsTable.id, stampIds));
  } catch (err) {
    logger.warn({ err }, "Daily notification digest batch failed");
  }
  logger.info({ userCount, rowCount }, "Notification digest sent");
  return { users: userCount, rows: rowCount };
}

export type { Notification };

// Drizzle import is referenced through the SQL helper in some queries; keep
// to avoid unused-import noise if tree-shaken differently in tests.
void sql;
