import { pgTable, text, timestamp, integer, index, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const documentArchivesTable = pgTable(
  "document_archives",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id"),
    originalFilename: text("original_filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    content: bytea("content"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    capturedByUserId: text("captured_by_user_id"),
    capturedByEmail: text("captured_by_email"),
    retentionPolicy: text("retention_policy").notNull().default("6mo_default"),
    senderEmail: text("sender_email"),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    notes: text("notes"),
  },
  (t) => [
    index("doc_archives_org_idx").on(t.organisationId, t.capturedAt),
    index("doc_archives_expires_idx").on(t.expiresAt),
    index("doc_archives_source_idx").on(t.sourceType, t.sourceId),
  ],
);

export const insertDocumentArchiveSchema = createInsertSchema(documentArchivesTable).omit({
  capturedAt: true,
});
export type InsertDocumentArchive = z.infer<typeof insertDocumentArchiveSchema>;
export type DocumentArchive = typeof documentArchivesTable.$inferSelect;
