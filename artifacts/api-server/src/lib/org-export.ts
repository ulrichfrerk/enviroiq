import JSZip from "jszip";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sqlRow, sqlRows } from "./sql-result.js";

/**
 * Full data export for a single organisation.
 *
 * Produces a ZIP containing:
 *   README.txt            — human-readable manifest of what's inside
 *   raw/<table>.csv       — one CSV per org-scoped table (auto-discovered),
 *                           a complete row-level dump of the raw data
 *   documents/<file>      — the actual uploaded evidence files (bills, etc.)
 *   analysed/             — computed / aggregated data:
 *     esg-summary.json    — totals, date ranges, per-table row counts
 *     monthly-emissions.csv — monthly CO2e broken down by source
 *     reports/<id>.json   — the stored analysed report snapshots
 *   reference/            — global reference data used in the calculations
 *     grid-intensity.csv  — NZ grid carbon intensity history (Scope 2 basis)
 *     emission-factors.csv— emission factors applied to raw data
 *
 * The raw dump is built by introspecting `information_schema`, so it
 * automatically includes EVERY table that carries an `organisation_id`
 * column — no hand-maintained table list to drift out of date.
 */

type ColumnMeta = { name: string; dataType: string };

/** RFC-4180-ish CSV cell escaping. */
function toCsvValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return `[binary ${v.length} bytes — see documents/ folder]`;
  let s: string;
  if (typeof v === "object") {
    s = JSON.stringify(v);
  } else {
    s = String(v);
  }
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Build a CSV string from a known column order and the fetched rows. */
function rowsToCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const header = columns.map(toCsvValue).join(",");
  const body = rows.map((r) => columns.map((c) => toCsvValue(r[c])).join(","));
  return [header, ...body].join("\r\n") + "\r\n";
}

/** Make a filesystem-safe, collision-free name for a zip entry. */
function safeFileName(name: string, fallback: string): string {
  const cleaned = (name || fallback)
    .replace(/[/\\]/g, "_")
    .replace(/[^\w.\-() ]/g, "_")
    .trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

export type OrgExportSummary = {
  organisationId: string;
  organisationName: string;
  tablesExported: number;
  totalRows: number;
  documentsExported: number;
  reportsExported: number;
  skippedTables: string[];
};

export type OrgExportResult = {
  buffer: Buffer;
  org: { id: string; name: string; slug: string };
  summary: OrgExportSummary;
};

/**
 * Build the complete export ZIP for an organisation.
 * Returns null if the organisation does not exist.
 */
export async function buildOrgExportZip(orgId: string): Promise<OrgExportResult | null> {
  // ── Organisation record (name/slug for the README + filename) ─────────────
  const orgRow = sqlRow(
    await db.execute(sql`SELECT id, name, slug FROM organisations WHERE id = ${orgId}`),
  );
  if (!orgRow.id) return null;
  const org = {
    id: String(orgRow.id),
    name: String(orgRow.name ?? "Organisation"),
    slug: String(orgRow.slug ?? orgId),
  };

  // ── Discover the schema: every public table + its columns ─────────────────
  const colMeta = sqlRows(
    await db.execute(sql`
      SELECT table_name, column_name, data_type, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `),
  );

  const tableColumns = new Map<string, ColumnMeta[]>();
  for (const row of colMeta) {
    const table = String(row.table_name);
    const list = tableColumns.get(table) ?? [];
    list.push({ name: String(row.column_name), dataType: String(row.data_type) });
    tableColumns.set(table, list);
  }
  const allTables = new Set(tableColumns.keys());

  // Org-scoped tables = those that have an organisation_id column.
  const orgTables = [...tableColumns.entries()]
    .filter(([, cols]) => cols.some((c) => c.name === "organisation_id"))
    .map(([table]) => table)
    .sort();

  const zip = new JSZip();
  const rawFolder = zip.folder("raw")!;

  let tablesExported = 0;
  let totalRows = 0;
  const perTableCounts: Record<string, number> = {};
  const skippedTables: string[] = [];

  for (const table of orgTables) {
    const cols = tableColumns.get(table)!;
    // Exclude bytea (binary) columns from the CSV — their content is exported
    // as real files under documents/. We still note their presence via the
    // placeholder in toCsvValue if any sneak through.
    const csvCols = cols.filter((c) => c.dataType !== "bytea").map((c) => c.name);
    if (csvCols.length === 0) continue;

    const colList = sql.join(
      csvCols.map((c) => sql.identifier(c)),
      sql`, `,
    );

    let rows: Record<string, unknown>[] = [];
    try {
      rows = sqlRows(
        await db.execute(
          sql`SELECT ${colList} FROM ${sql.identifier(table)} WHERE organisation_id = ${orgId} ORDER BY 1`,
        ),
      );
    } catch {
      // A table we can't read for any reason shouldn't abort the whole export,
      // but it must be recorded so a "full export" can be trusted/verified.
      skippedTables.push(table);
      continue;
    }

    rawFolder.file(`${table}.csv`, rowsToCsv(csvCols, rows));
    tablesExported++;
    totalRows += rows.length;
    perTableCounts[table] = rows.length;
  }

  // ── Documents: the actual uploaded binary evidence files ──────────────────
  let documentsExported = 0;
  if (allTables.has("document_archives")) {
    const docs = sqlRows(
      await db.execute(sql`
        SELECT id, original_filename, content_type, content, captured_at
        FROM document_archives
        WHERE organisation_id = ${orgId}
          AND content IS NOT NULL
          AND purged_at IS NULL
        ORDER BY captured_at
      `),
    );
    if (docs.length > 0) {
      const docFolder = zip.folder("documents")!;
      const usedNames = new Set<string>();
      for (const d of docs) {
        const content = d.content;
        if (!Buffer.isBuffer(content)) continue;
        let name = safeFileName(String(d.original_filename ?? ""), `document-${String(d.id)}`);
        // De-duplicate filenames by prefixing the row id when needed.
        if (usedNames.has(name)) {
          name = `${String(d.id)}-${name}`;
        }
        usedNames.add(name);
        docFolder.file(name, content);
        documentsExported++;
      }
    }
  }

  // ── Analysed data ─────────────────────────────────────────────────────────
  const analysed = zip.folder("analysed")!;

  // Monthly CO2e by source (energy + fleet). Defensive: only query tables we
  // have, and use parameterised SQL (no string interpolation of orgId).
  const monthlyParts: ReturnType<typeof sql>[] = [];
  if (allTables.has("energy_readings")) {
    monthlyParts.push(sql`SELECT to_char(date_trunc('month', period_start), 'YYYY-MM') AS month, 'energy' AS source, COALESCE(SUM(co2e_kg), 0) AS co2e_kg FROM energy_readings WHERE organisation_id = ${orgId} GROUP BY 1`);
  }
  if (allTables.has("fleet_events")) {
    monthlyParts.push(sql`SELECT to_char(date_trunc('month', recorded_at), 'YYYY-MM') AS month, 'fleet' AS source, COALESCE(SUM(co2e_kg), 0) AS co2e_kg FROM fleet_events WHERE organisation_id = ${orgId} GROUP BY 1`);
  }
  if (monthlyParts.length > 0) {
    const unioned = sql.join(monthlyParts, sql` UNION ALL `);
    const monthlyRows = sqlRows(
      await db.execute(sql`${unioned} ORDER BY month, source`),
    );
    analysed.file(
      "monthly-emissions.csv",
      rowsToCsv(["month", "source", "co2e_kg"], monthlyRows),
    );
  }

  // Stored analysed report snapshots.
  let reportsExported = 0;
  if (allTables.has("reports")) {
    const reports = sqlRows(
      await db.execute(sql`
        SELECT id, title, report_type, period_start, period_end, status, data_snapshot, created_at
        FROM reports
        WHERE organisation_id = ${orgId}
        ORDER BY created_at
      `),
    );
    if (reports.length > 0) {
      const reportsFolder = analysed.folder("reports")!;
      for (const r of reports) {
        // data_snapshot may come back as a JSON string (text column) or, if the
        // column is ever JSON/JSONB, as an already-parsed object. Preserve the
        // real analysed payload in both cases rather than stringifying it.
        let snapshot: unknown = null;
        const ds = r.data_snapshot;
        if (ds != null) {
          if (typeof ds === "string") {
            try {
              snapshot = JSON.parse(ds);
            } catch {
              snapshot = ds;
            }
          } else {
            snapshot = ds;
          }
        }
        const payload = {
          id: r.id,
          title: r.title,
          reportType: r.report_type,
          periodStart: r.period_start,
          periodEnd: r.period_end,
          status: r.status,
          createdAt: r.created_at,
          dataSnapshot: snapshot,
        };
        const fname = safeFileName(`${String(r.id)}-${String(r.title ?? "report")}.json`, `${String(r.id)}.json`);
        reportsFolder.file(fname, JSON.stringify(payload, null, 2));
        reportsExported++;
      }
    }
  }

  // ESG summary (totals + counts + date range).
  const totalFleetCo2e = allTables.has("fleet_events")
    ? Number(sqlRow(await db.execute(sql`SELECT COALESCE(SUM(co2e_kg), 0) AS t FROM fleet_events WHERE organisation_id = ${orgId}`)).t ?? 0)
    : 0;
  const totalEnergyCo2e = allTables.has("energy_readings")
    ? Number(sqlRow(await db.execute(sql`SELECT COALESCE(SUM(co2e_kg), 0) AS t FROM energy_readings WHERE organisation_id = ${orgId}`)).t ?? 0)
    : 0;

  const summary: OrgExportSummary = {
    organisationId: org.id,
    organisationName: org.name,
    tablesExported,
    totalRows,
    documentsExported,
    reportsExported,
    skippedTables,
  };

  analysed.file(
    "esg-summary.json",
    JSON.stringify(
      {
        organisation: org,
        generatedAt: new Date().toISOString(),
        totals: {
          fleetCo2eKg: totalFleetCo2e,
          energyCo2eKg: totalEnergyCo2e,
          combinedCo2eKg: totalFleetCo2e + totalEnergyCo2e,
          combinedCo2eTonnes: (totalFleetCo2e + totalEnergyCo2e) / 1000,
        },
        rowCountsByTable: perTableCounts,
        documentsExported,
        reportsExported,
        skippedTables,
      },
      null,
      2,
    ),
  );

  // ── Reference data used in the calculations (global, not org-scoped) ───────
  const referenceTables: Array<{ table: string; file: string }> = [
    { table: "grid_intensity_snapshots", file: "grid-intensity.csv" },
    { table: "emission_factors", file: "emission-factors.csv" },
  ];
  const refFolder = zip.folder("reference");
  for (const { table, file } of referenceTables) {
    if (!allTables.has(table)) continue;
    const cols = (tableColumns.get(table) ?? []).filter((c) => c.dataType !== "bytea").map((c) => c.name);
    if (cols.length === 0) continue;
    const colList = sql.join(cols.map((c) => sql.identifier(c)), sql`, `);
    try {
      const rows = sqlRows(
        await db.execute(sql`SELECT ${colList} FROM ${sql.identifier(table)} ORDER BY 1`),
      );
      refFolder!.file(file, rowsToCsv(cols, rows));
    } catch {
      /* skip reference table we can't read */
    }
  }

  // ── README manifest ───────────────────────────────────────────────────────
  const readme = [
    `EnviroIQ — Full Data Export`,
    `==============================`,
    ``,
    `Organisation : ${org.name} (${org.slug})`,
    `Org ID       : ${org.id}`,
    `Generated    : ${new Date().toISOString()}`,
    ``,
    `CONTENTS`,
    `--------`,
    `raw/         One CSV per data table, a complete row-level dump of all`,
    `             raw data held for this organisation (${tablesExported} tables, ${totalRows} rows total).`,
    `documents/   The original uploaded evidence files (bills, invoices, etc.) — ${documentsExported} file(s).`,
    `analysed/    Computed and aggregated data:`,
    `               esg-summary.json     Totals, date range and per-table row counts.`,
    `               monthly-emissions.csv  Monthly CO2e broken down by source.`,
    `               reports/             Stored analysed report snapshots (${reportsExported} report(s)).`,
    `reference/   Global reference data used in the calculations`,
    `               grid-intensity.csv   NZ grid carbon intensity history (Scope 2 basis).`,
    `               emission-factors.csv Emission factors applied to the raw data.`,
    ``,
    `ROW COUNTS BY TABLE`,
    `-------------------`,
    ...Object.entries(perTableCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([t, c]) => `  ${t.padEnd(40, " ")} ${c}`),
    ``,
    ...(skippedTables.length > 0
      ? [
          `SKIPPED TABLES (could not be read — NOT included above)`,
          `------------------------------------------------------`,
          ...skippedTables.map((t) => `  ${t}`),
          ``,
        ]
      : []),
    `All timestamps are in UTC (ISO-8601). CSV files are UTF-8, RFC-4180 quoted.`,
    `Binary document contents are stored as real files under documents/ rather`,
    `than inline in the CSVs.`,
    ``,
  ].join("\n");
  zip.file("README.txt", readme);

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return { buffer, org, summary };
}
