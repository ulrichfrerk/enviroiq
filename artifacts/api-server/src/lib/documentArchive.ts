import { createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db, documentArchivesTable, type DocumentArchive } from "@workspace/db";
import { logger } from "./logger.js";

export type ArchiveSourceType =
  | "energy_bill_upload"
  | "energy_bill_batch_upload"
  | "energy_bill_email"
  | "fleet_report_email";

export interface ArchiveDocumentInput {
  organisationId: string;
  sourceType: ArchiveSourceType;
  sourceId?: string | null;
  buffer: Buffer;
  filename: string;
  contentType: string;
  capturedByUserId?: string | null;
  capturedByEmail?: string | null;
  senderEmail?: string | null;
  retentionMonths?: number;
  notes?: string | null;
}

const DEFAULT_RETENTION_MONTHS = 6;
const MAX_BYTES = 25 * 1024 * 1024;

function addMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

export async function archiveDocument(input: ArchiveDocumentInput): Promise<DocumentArchive | null> {
  try {
    if (!input.buffer || input.buffer.length === 0) {
      logger.warn({ filename: input.filename, orgId: input.organisationId }, "archiveDocument: empty buffer, skipped");
      return null;
    }
    if (input.buffer.length > MAX_BYTES) {
      logger.warn(
        { filename: input.filename, sizeBytes: input.buffer.length, maxBytes: MAX_BYTES },
        "archiveDocument: file exceeds max size, skipped",
      );
      return null;
    }

    const sha256 = createHash("sha256").update(input.buffer).digest("hex");
    const months = input.retentionMonths ?? DEFAULT_RETENTION_MONTHS;
    const now = new Date();

    const [row] = await db
      .insert(documentArchivesTable)
      .values({
        id: uuidv4(),
        organisationId: input.organisationId,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        originalFilename: input.filename,
        contentType: input.contentType || "application/octet-stream",
        sizeBytes: input.buffer.length,
        sha256,
        content: input.buffer,
        expiresAt: addMonths(now, months),
        capturedByUserId: input.capturedByUserId ?? null,
        capturedByEmail: input.capturedByEmail ?? null,
        senderEmail: input.senderEmail ?? null,
        retentionPolicy: `${months}mo_default`,
        notes: input.notes ?? null,
      })
      .returning();

    logger.info(
      {
        archiveId: row.id,
        orgId: input.organisationId,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        filename: input.filename,
        sizeBytes: input.buffer.length,
        sha256: sha256.slice(0, 16),
        expiresAt: row.expiresAt,
      },
      "Document archived for compliance",
    );

    return row;
  } catch (err) {
    // Archival must never break the primary ingestion flow.
    logger.error(
      { err, filename: input.filename, orgId: input.organisationId, sourceType: input.sourceType },
      "archiveDocument failed (ingestion will continue)",
    );
    return null;
  }
}

export interface PruneResult {
  scanned: number;
  purged: number;
  bytesFreed: number;
}

/**
 * Hard-purge expired archives: nullifies the `content` blob and stamps `purged_at`.
 * The metadata row is retained as evidence the document was held + lawfully purged.
 *
 * Single atomic UPDATE…RETURNING — safe under concurrent runs (rows already
 * nullified by another process simply won't match the predicate).
 */
export async function pruneExpiredDocumentArchives(): Promise<PruneResult> {
  const now = new Date();

  const purgedRows = await db
    .update(documentArchivesTable)
    .set({ content: null, purgedAt: now })
    .where(
      and(
        lte(documentArchivesTable.expiresAt, now),
        isNotNull(documentArchivesTable.content),
      ),
    )
    .returning({ id: documentArchivesTable.id, sizeBytes: documentArchivesTable.sizeBytes });

  if (purgedRows.length === 0) {
    return { scanned: 0, purged: 0, bytesFreed: 0 };
  }

  const bytesFreed = purgedRows.reduce((sum, r) => sum + (r.sizeBytes ?? 0), 0);

  logger.info(
    { purged: purgedRows.length, bytesFreed, retentionMonths: 6 },
    "Document archive prune complete — expired blobs nullified",
  );

  return { scanned: purgedRows.length, purged: purgedRows.length, bytesFreed };
}

export async function getArchiveById(id: string): Promise<DocumentArchive | undefined> {
  const [row] = await db
    .select()
    .from(documentArchivesTable)
    .where(eq(documentArchivesTable.id, id))
    .limit(1);
  return row;
}

export async function listArchivesForOrg(
  organisationId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{
  rows: Array<Omit<DocumentArchive, "content"> & { isPurged: boolean }>;
  total: number;
  totalBytes: number;
  liveCount: number;
}> {
  const limit = Math.min(opts.limit ?? 100, 500);
  const offset = opts.offset ?? 0;

  const rows = await db
    .select({
      id: documentArchivesTable.id,
      organisationId: documentArchivesTable.organisationId,
      sourceType: documentArchivesTable.sourceType,
      sourceId: documentArchivesTable.sourceId,
      originalFilename: documentArchivesTable.originalFilename,
      contentType: documentArchivesTable.contentType,
      sizeBytes: documentArchivesTable.sizeBytes,
      sha256: documentArchivesTable.sha256,
      capturedAt: documentArchivesTable.capturedAt,
      expiresAt: documentArchivesTable.expiresAt,
      capturedByUserId: documentArchivesTable.capturedByUserId,
      capturedByEmail: documentArchivesTable.capturedByEmail,
      senderEmail: documentArchivesTable.senderEmail,
      retentionPolicy: documentArchivesTable.retentionPolicy,
      purgedAt: documentArchivesTable.purgedAt,
      notes: documentArchivesTable.notes,
    })
    .from(documentArchivesTable)
    .where(eq(documentArchivesTable.organisationId, organisationId))
    .orderBy(sql`${documentArchivesTable.capturedAt} desc`)
    .limit(limit)
    .offset(offset);

  const stats = await db
    .select({
      total: sql<number>`count(*)::int`,
      totalBytes: sql<number>`coalesce(sum(${documentArchivesTable.sizeBytes}), 0)::bigint`,
      liveCount: sql<number>`count(*) filter (where ${documentArchivesTable.purgedAt} is null and ${documentArchivesTable.content} is not null)::int`,
    })
    .from(documentArchivesTable)
    .where(eq(documentArchivesTable.organisationId, organisationId));

  const s = stats[0] ?? { total: 0, totalBytes: 0, liveCount: 0 };

  return {
    rows: rows.map((r) => ({ ...r, content: undefined, isPurged: r.purgedAt !== null } as unknown as Omit<DocumentArchive, "content"> & { isPurged: boolean })),
    total: Number(s.total),
    totalBytes: Number(s.totalBytes),
    liveCount: Number(s.liveCount),
  };
}
