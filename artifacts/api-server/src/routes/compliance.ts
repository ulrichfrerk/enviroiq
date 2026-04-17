import { Router } from "express";
import {
  db, auditLogsTable, fleetEventsTable, energyReadingsTable,
  emissionFactorsTable, organisationsTable, vehiclesTable,
} from "@workspace/db";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { requireAuth, requireOrgAccess } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import JSZip from "jszip";
import crypto from "crypto";

const router = Router({ mergeParams: true });

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : (v instanceof Date ? v.toISOString() : JSON.stringify(v));
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.join(",");
  const body = rows.map(r => columns.map(c => csvEscape(r[c])).join(",")).join("\n");
  return rows.length ? `${header}\n${body}\n` : `${header}\n`;
}

// POST /organisations/:orgId/compliance/evidence-pack
router.post("/evidence-pack", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const { from, to } = req.body as { from?: string; to?: string };
    const fromDate = from ? new Date(from) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(to) : new Date();

    const [[org], audits, fleet, energy] = await Promise.all([
      db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId)).limit(1),
      db.select().from(auditLogsTable).where(and(
        eq(auditLogsTable.organisationId, orgId),
        gte(auditLogsTable.createdAt, fromDate),
        lte(auditLogsTable.createdAt, toDate),
      )),
      db.select().from(fleetEventsTable).where(and(
        eq(fleetEventsTable.organisationId, orgId),
        gte(fleetEventsTable.recordedAt, fromDate),
        lte(fleetEventsTable.recordedAt, toDate),
      )),
      db.select().from(energyReadingsTable).where(and(
        eq(energyReadingsTable.organisationId, orgId),
        gte(energyReadingsTable.periodEnd, fromDate),
        lte(energyReadingsTable.periodEnd, toDate),
      )),
    ]);

    if (!org) {
      res.status(404).json({ error: "Not Found", message: "Organisation not found" });
      return;
    }

    // Vehicles for fleet event resolution
    const vehicleIds = Array.from(new Set(fleet.map(f => f.vehicleId)));
    const vehicles = vehicleIds.length
      ? await db.select().from(vehiclesTable).where(inArray(vehiclesTable.id, vehicleIds))
      : [];
    const vehicleMap = new Map(vehicles.map(v => [v.id, v]));

    // Emission factors used in this date range
    const factorIds = Array.from(new Set([
      ...fleet.map(f => f.emissionFactorId).filter(Boolean) as string[],
      ...energy.map(e => e.emissionFactorId).filter(Boolean) as string[],
    ]));
    const factors = factorIds.length
      ? await db.select().from(emissionFactorsTable).where(inArray(emissionFactorsTable.id, factorIds))
      : [];

    // Build CSVs
    const auditCsv = rowsToCsv(audits as Record<string, unknown>[], [
      "id", "createdAt", "action", "userEmail", "userId", "resourceType", "resourceId",
      "outcome", "ipAddress", "userAgent", "details",
    ]);

    const fleetCsv = rowsToCsv(fleet.map(f => ({
      ...f,
      vehicle_registration: vehicleMap.get(f.vehicleId)?.registration ?? "",
      vehicle_make: vehicleMap.get(f.vehicleId)?.make ?? "",
      vehicle_model: vehicleMap.get(f.vehicleId)?.model ?? "",
    })) as Record<string, unknown>[], [
      "id", "recordedAt", "vehicleId", "vehicle_registration", "vehicle_make", "vehicle_model",
      "eventType", "fuelLitres", "co2eKg", "distanceKm", "source",
      "emissionFactorId", "importBatchId", "ingestedByUserId", "createdAt",
    ]);

    const energyCsv = rowsToCsv(energy as Record<string, unknown>[], [
      "id", "utilityType", "provider", "periodStart", "periodEnd",
      "usageKwh", "costAmount", "costCurrency", "co2eKg",
      "gridIntensityKgCo2PerKwh", "emissionMethod", "emissionNote", "supplierRenewablePct",
      "source", "originalFileName", "emissionFactorId", "importBatchId",
      "ingestedByUserId", "createdAt",
    ]);

    const factorsCsv = rowsToCsv(factors as Record<string, unknown>[], [
      "id", "factorKey", "version", "effectiveFrom", "effectiveTo",
      "value", "unit", "category", "source", "methodology", "notes",
    ]);

    // Generate manifest with SHA-256 hashes
    const sha = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
    const manifest = {
      pack_format_version: "1.0",
      organisation: { id: org.id, name: org.name, slug: org.slug, dataResidency: org.dataResidency },
      period: { from: fromDate.toISOString(), to: toDate.toISOString() },
      generated_at: new Date().toISOString(),
      generated_by: { userId: req.session?.userId, email: req.session?.email },
      counts: {
        audit_logs: audits.length,
        fleet_events: fleet.length,
        energy_readings: energy.length,
        emission_factors_used: factors.length,
      },
      files: {
        "audit_logs.csv": { sha256: sha(auditCsv), bytes: Buffer.byteLength(auditCsv) },
        "fleet_events.csv": { sha256: sha(fleetCsv), bytes: Buffer.byteLength(fleetCsv) },
        "energy_readings.csv": { sha256: sha(energyCsv), bytes: Buffer.byteLength(energyCsv) },
        "emission_factors_used.csv": { sha256: sha(factorsCsv), bytes: Buffer.byteLength(factorsCsv) },
      },
      attestation: "All data exported from EnviroIQ in accordance with the immutable audit log policy. SHA-256 hashes can be independently verified against the file contents.",
    };
    const manifestStr = JSON.stringify(manifest, null, 2);

    const zip = new JSZip();
    zip.file("manifest.json", manifestStr);
    zip.file("audit_logs.csv", auditCsv);
    zip.file("fleet_events.csv", fleetCsv);
    zip.file("energy_readings.csv", energyCsv);
    zip.file("emission_factors_used.csv", factorsCsv);
    zip.file("README.txt",
`EnviroIQ Compliance Evidence Pack
==================================

Organisation: ${org.name} (${org.slug})
Period: ${fromDate.toISOString().slice(0, 10)} to ${toDate.toISOString().slice(0, 10)}
Generated: ${new Date().toISOString()}
Generated by: ${req.session?.email}

Files:
  manifest.json              Cryptographic manifest with SHA-256 hashes of all files
  audit_logs.csv             Every action recorded for this organisation in the period
  fleet_events.csv           Every fleet emissions event with the emission factor version applied
  energy_readings.csv        Every energy reading with the emission factor / grid intensity used
  emission_factors_used.csv  Every emission factor version referenced by data in this pack

Verification:
  To verify integrity, compute the SHA-256 hash of each .csv file and
  compare against the values in manifest.json.

  Example (macOS/Linux):
    shasum -a 256 audit_logs.csv

This pack is suitable as evidence for SOC 2, ISO 27001, NZ Climate
Disclosure, or external audit review.
`);

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

    // Audit the export itself
    await logAudit({
      req,
      action: "compliance.evidence_pack_exported",
      resourceType: "organisation",
      resourceId: orgId,
      details: {
        period_from: fromDate.toISOString(),
        period_to: toDate.toISOString(),
        counts: manifest.counts,
        bytes: zipBuffer.length,
      },
    });

    const filename = `enviroiq-evidence-${org.slug}-${fromDate.toISOString().slice(0, 10)}-to-${toDate.toISOString().slice(0, 10)}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Evidence-Pack-SHA256", sha(zipBuffer.toString("base64")));
    res.send(zipBuffer);
  } catch (err) {
    req.log.error({ err }, "Evidence pack export failed");
    res.status(500).json({ error: "Internal Server Error", message: "Evidence pack generation failed" });
  }
});

// GET /organisations/:orgId/compliance/summary — dashboard summary
router.get("/summary", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [allAudits, recentAudits, [org]] = await Promise.all([
      db.$count(auditLogsTable, eq(auditLogsTable.organisationId, orgId)),
      db.$count(auditLogsTable, and(
        eq(auditLogsTable.organisationId, orgId),
        gte(auditLogsTable.createdAt, since30d),
      )),
      db.select().from(organisationsTable).where(eq(organisationsTable.id, orgId)).limit(1),
    ]);

    res.json({
      organisation: { id: org?.id, name: org?.name, requireMfa: org?.requireMfa, dataResidency: org?.dataResidency },
      audit: { total: allAudits, last30d: recentAudits },
      controls: {
        immutable_audit_log: true,
        rbac_enabled: true,
        passwordless_auth: true,
        tenant_isolation: true,
        encryption_at_rest: true,
        encryption_in_transit: true,
        versioned_emission_factors: true,
        data_lineage_tracking: true,
        mfa_enforcement: org?.requireMfa ?? false,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Compliance summary failed");
    res.status(500).json({ error: "Internal Server Error", message: "Compliance summary failed" });
  }
});

export default router;
