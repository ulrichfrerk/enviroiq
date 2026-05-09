// Notification fan-out service. See replit.md → Notifications for contract.

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
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
  linkUrl?: string;
  sourceAuditId?: string;
  context?: Record<string, unknown>;
  /** Idempotency key. Repeat fires no-op. */
  dedupeKey: string;
}

export interface NotifyResult {
  /** False when the dedupeKey already existed. */
  created: boolean;
  eventId: string | null;
  recipientCount: number;
  emailsSent: number;
}

interface ResolvedRecipient {
  id: string;
  email: string;
  name: string | null;
  /** NULL = user has never signed in; email channel is suppressed. */
  lastLoginAt: Date | null;
  /** Recipient's home org — used to file orphan-fallback bell rows so they surface in-app. */
  organisationId: string | null;
}


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
      organisationId: usersTable.organisationId,
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

  const platform = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      lastLoginAt: usersTable.lastLoginAt,
      organisationId: usersTable.organisationId,
    })
    .from(usersTable)
    .where(and(eq(usersTable.role, "super_admin"), eq(usersTable.isActive, true)));

  return { recipients: platform, orphanFallback: true };
}

/** Fire a notification. Idempotent on `dedupeKey`. Never throws. */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
  try {
    const [{ recipients, orphanFallback }, org] = await Promise.all([
      resolveRecipients(input.organisationId),
      db.query.organisationsTable.findFirst({
        where: eq(organisationsTable.id, input.organisationId),
      }),
    ]);

    const eventId = randomUUID();
    const now = new Date();
    // For orphan fallback, file the bell row under the recipient's home org so
    // it surfaces in their normal in-app context (the source org is preserved
    // on the parent event row + in the category tag).
    const rows = recipients.map((r) => ({
      id: randomUUID(),
      organisationId: orphanFallback ? r.organisationId ?? input.organisationId : input.organisationId,
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

    // Event + fan-out atomic: dedupe row rolls back if recipient insert throws.
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
      return { created: false, eventId: null, recipientCount: 0, emailsSent: 0 };
    }

    if (recipients.length === 0) {
      logger.warn(
        { orgId: input.organisationId, category: input.category, dedupeKey: input.dedupeKey },
        "Notification has no recipients (no org admins, no platform super_admins) — event row kept for ops",
      );
      return { created: true, eventId, recipientCount: 0, emailsSent: 0 };
    }

    // severity=error → one batched Resend call. severity=warn → daily digest.
    // First-sign-in users are excluded from email; bell row still created.
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
          // Stamp only rows whose Resend dispatch was confirmed; failed rows roll into next digest.
          const stampIds = emailable
            .map((p, i) => ({ id: p.row.id, ok: result.results[i]?.ok === true }))
            .filter((x) => x.ok)
            .map((x) => x.id);
          if (stampIds.length > 0) {
            await db
              .update(notificationsTable)
              .set({ emailSentAt: new Date() })
              .where(inArray(notificationsTable.id, stampIds));
          }
          const failed = emailable.length - stampIds.length;
          if (failed > 0) {
            logger.warn(
              { failed, dedupeKey: input.dedupeKey },
              "Notification email batch had unconfirmed sends — rows left unstamped for retry",
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

/** Daily digest. Groups unsent severity=warn rows by recipient and emails one rollup per user. */
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

  // Track which row ids belong to each batch entry so we only stamp confirmed sends.
  const items: NotificationEmailItem[] = [];
  const stampGroups: string[][] = [];
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
    const intro = rows.length === 1
      ? `You have 1 item that needs your attention in EnviroIQ today:`
      : `You have ${rows.length} items that need your attention in EnviroIQ today:`;
    items.push({
      to: user.email,
      recipientName: user.name ?? user.email,
      orgName: org?.name ?? "your organisation",
      title: `Daily ESG data quality digest (${rows.length} item${rows.length === 1 ? "" : "s"})`,
      body: intro,
      items: rows.map((r) => ({
        title: r.title,
        body: r.body,
        linkUrl: r.linkUrl ?? undefined,
      })),
    });
    stampGroups.push(rows.map((r) => r.id));
    userCount++;
    rowCount += rows.length;
  }

  if (items.length === 0) {
    logger.info({ userCount: 0, rowCount: 0 }, "Notification digest had no eligible recipients");
    return { users: 0, rows: 0 };
  }

  try {
    const result = await sendNotificationEmailBatch(items);
    const confirmedIds: string[] = [];
    let failedUsers = 0;
    for (let i = 0; i < items.length; i++) {
      if (result.results[i]?.ok) {
        confirmedIds.push(...stampGroups[i]);
      } else {
        failedUsers++;
      }
    }
    if (confirmedIds.length > 0) {
      const now = new Date();
      await db
        .update(notificationsTable)
        .set({ emailSentAt: now })
        .where(inArray(notificationsTable.id, confirmedIds));
    }
    if (failedUsers > 0) {
      logger.warn(
        { failedUsers, totalUsers: items.length },
        "Daily digest had unconfirmed sends — those users' rows remain unstamped for next digest",
      );
    }
  } catch (err) {
    logger.warn({ err }, "Daily notification digest batch failed");
  }
  logger.info({ userCount, rowCount }, "Notification digest sent");
  return { users: userCount, rows: rowCount };
}

export type { Notification };
