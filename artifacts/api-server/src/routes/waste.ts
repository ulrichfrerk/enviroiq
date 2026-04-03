import { Router } from "express";
import { db } from "@workspace/db";
import {
  wasteRecordsTable, insertWasteRecordSchema,
  environmentalIncidentsTable, insertEnvironmentalIncidentSchema,
  waterReadingsTable, insertWaterReadingSchema,
} from "@workspace/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, requireOrgAccess } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { randomUUID } from "crypto";

const router = Router({ mergeParams: true });

// ── Waste records ─────────────────────────────────────────────────────────────

router.get("/records", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const rows = await db.select().from(wasteRecordsTable)
      .where(eq(wasteRecordsTable.organisationId, orgId))
      .orderBy(desc(wasteRecordsTable.recordedAt));
    res.json(rows);
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

router.post("/records", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const parsed = insertWasteRecordSchema.safeParse({ ...req.body, id: randomUUID(), organisationId: orgId });
    if (!parsed.success) { res.status(400).json({ error: "Validation error", issues: parsed.error.issues }); return; }
    const [row] = await db.insert(wasteRecordsTable).values(parsed.data).returning();
    await logAudit({ req, action: "waste.create", resourceType: "waste_record", resourceId: row.id });
    res.status(201).json(row);
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

router.delete("/records/:id", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    await db.delete(wasteRecordsTable).where(and(eq(wasteRecordsTable.id, req.params.id), eq(wasteRecordsTable.organisationId, orgId)));
    res.status(204).end();
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

// ── Waste summary ─────────────────────────────────────────────────────────────

router.get("/summary", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const [totals] = await db.execute(sql`
      SELECT
        COALESCE(SUM(quantity_kg), 0)::float AS total_kg,
        COALESCE(SUM(CASE WHEN diverted THEN quantity_kg ELSE 0 END), 0)::float AS diverted_kg,
        COUNT(*)::int AS record_count
      FROM waste_records WHERE organisation_id = ${orgId}
    `);
    const byType = await db.execute(sql`
      SELECT waste_type, COALESCE(SUM(quantity_kg),0)::float AS total_kg
      FROM waste_records WHERE organisation_id = ${orgId}
      GROUP BY waste_type ORDER BY total_kg DESC
    `);
    const byMethod = await db.execute(sql`
      SELECT disposal_method, COALESCE(SUM(quantity_kg),0)::float AS total_kg
      FROM waste_records WHERE organisation_id = ${orgId}
      GROUP BY disposal_method ORDER BY total_kg DESC
    `);
    const waterTotal = await db.execute(sql`
      SELECT COALESCE(SUM(cubic_metres),0)::float AS total_m3 FROM water_readings WHERE organisation_id = ${orgId}
    `);
    res.json({
      totalKg: (totals as Record<string,unknown>)?.total_kg ?? 0,
      divertedKg: (totals as Record<string,unknown>)?.diverted_kg ?? 0,
      recordCount: (totals as Record<string,unknown>)?.record_count ?? 0,
      diversionRate: (totals as Record<string,unknown>)?.total_kg ? (((totals as Record<string,unknown>).diverted_kg as number) / ((totals as Record<string,unknown>).total_kg as number)) * 100 : 0,
      byType,
      byMethod,
      waterM3: ((waterTotal[0] as Record<string,unknown>)?.total_m3 as number) ?? 0,
    });
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

// ── Environmental incidents ───────────────────────────────────────────────────

router.get("/incidents", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const rows = await db.select().from(environmentalIncidentsTable)
      .where(eq(environmentalIncidentsTable.organisationId, orgId))
      .orderBy(desc(environmentalIncidentsTable.incidentDate));
    res.json(rows);
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

router.post("/incidents", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const parsed = insertEnvironmentalIncidentSchema.safeParse({ ...req.body, id: randomUUID(), organisationId: orgId });
    if (!parsed.success) { res.status(400).json({ error: "Validation error", issues: parsed.error.issues }); return; }
    const [row] = await db.insert(environmentalIncidentsTable).values(parsed.data).returning();
    await logAudit({ req, action: "env_incident.create", resourceType: "environmental_incident", resourceId: row.id });
    res.status(201).json(row);
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

router.patch("/incidents/:id", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const { id: _id, organisationId: _oid, createdAt: _ca, ...updates } = req.body;
    const [row] = await db.update(environmentalIncidentsTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(environmentalIncidentsTable.id, req.params.id), eq(environmentalIncidentsTable.organisationId, orgId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

router.delete("/incidents/:id", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    await db.delete(environmentalIncidentsTable).where(and(eq(environmentalIncidentsTable.id, req.params.id), eq(environmentalIncidentsTable.organisationId, orgId)));
    res.status(204).end();
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

// ── Water readings ────────────────────────────────────────────────────────────

router.get("/water", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const rows = await db.select().from(waterReadingsTable)
      .where(eq(waterReadingsTable.organisationId, orgId))
      .orderBy(desc(waterReadingsTable.readingDate));
    res.json(rows);
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

router.post("/water", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const parsed = insertWaterReadingSchema.safeParse({ ...req.body, id: randomUUID(), organisationId: orgId });
    if (!parsed.success) { res.status(400).json({ error: "Validation error", issues: parsed.error.issues }); return; }
    const [row] = await db.insert(waterReadingsTable).values(parsed.data).returning();
    res.status(201).json(row);
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

export default router;
