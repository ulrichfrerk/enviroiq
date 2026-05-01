import { pgTable, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * notification_events — one row per underlying domain event (upload failure,
 * import error, webhook rejection, etc.). The dedupeKey is the idempotency
 * guard: the same event fired multiple times must produce only one event row
 * (and therefore only one fan-out of per-recipient notifications). Callers are
 * responsible for choosing a deterministic key — typically
 * `${category}:${sourceAuditId}` or `${category}:${orgId}:${day}`.
 */
export const notificationEventsTable = pgTable(
  "notification_events",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id").notNull(),
    /** e.g. "upload.energy_bill", "import.fleet_csv", "webhook.fleet" */
    category: text("category").notNull(),
    /** "info" | "warn" | "error" — drives email cadence (errors: immediate, warns: digest). */
    severity: text("severity").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    linkUrl: text("link_url"),
    /** Audit row this event was raised from, when applicable. */
    sourceAuditId: text("source_audit_id"),
    /** Free-form structured context (filename, errors[], deviceId, etc.). */
    context: jsonb("context").$type<Record<string, unknown>>(),
    /** Idempotency key — UNIQUE. Repeat fires of `notify()` no-op. */
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dedupeKeyUq: uniqueIndex("notification_events_dedupe_key_uq").on(t.dedupeKey),
    orgCreatedIdx: index("notification_events_org_created_idx").on(t.organisationId, t.createdAt),
  }),
);

/**
 * notifications — per-recipient fan-out of an event. Drives the bell icon
 * (read/dismissed flags), and tracks whether the email side-channel has
 * been delivered (immediate for severity=error, batched in the daily 8am
 * digest for severity=warn).
 */
export const notificationsTable = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id").notNull(),
    recipientUserId: text("recipient_user_id").notNull(),
    /** Mirror of the event's category for cheap filtering on the read API. */
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    linkUrl: text("link_url"),
    sourceAuditId: text("source_audit_id"),
    sourceEventId: text("source_event_id").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    /** Set when the email side-channel has been delivered (or skipped on dev). */
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    recipientCreatedIdx: index("notifications_recipient_created_idx").on(
      t.recipientUserId,
      t.createdAt,
    ),
    orgCreatedIdx: index("notifications_org_created_idx").on(t.organisationId, t.createdAt),
  }),
);

export type NotificationEvent = typeof notificationEventsTable.$inferSelect;
export type Notification = typeof notificationsTable.$inferSelect;
