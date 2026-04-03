import { Router } from "express";
import { db } from "@workspace/db";
import {
  socialWorkforceSnapshotsTable,
  hsIncidentsTable,
  trainingRecordsTable,
} from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, requireOrgAccess } from "../lib/auth.js";
import crypto from "crypto";

const router = Router({ mergeParams: true });
router.use(requireAuth);
router.use(requireOrgAccess);

// ─── Workforce snapshot (one per year per org) ───────────────────────────────

router.get("/workforce", async (req, res) => {
  const { orgId } = req.params;
  const year = parseInt(req.query.year as string) || new Date().getFullYear();
  const rows = await db
    .select()
    .from(socialWorkforceSnapshotsTable)
    .where(
      and(
        eq(socialWorkforceSnapshotsTable.organisationId, orgId),
        eq(socialWorkforceSnapshotsTable.periodYear, year)
      )
    )
    .limit(1);
  res.json(rows[0] || null);
});

router.put("/workforce", async (req, res) => {
  const { orgId } = req.params;
  const year = parseInt(req.body.periodYear) || new Date().getFullYear();

  const existing = await db
    .select()
    .from(socialWorkforceSnapshotsTable)
    .where(
      and(
        eq(socialWorkforceSnapshotsTable.organisationId, orgId),
        eq(socialWorkforceSnapshotsTable.periodYear, year)
      )
    )
    .limit(1);

  const data = {
    organisationId: orgId,
    periodYear: year,
    headcount: req.body.headcount ?? null,
    fteCount: req.body.fteCount ?? null,
    contractorCount: req.body.contractorCount ?? null,
    turnoverPct: req.body.turnoverPct ?? null,
    femalePct: req.body.femalePct ?? null,
    femaleLeadershipPct: req.body.femaleLeadershipPct ?? null,
    payEquityGapPct: req.body.payEquityGapPct ?? null,
    livingWageAccredited: req.body.livingWageAccredited ?? false,
    localSupplierPct: req.body.localSupplierPct ?? null,
    volunteerHours: req.body.volunteerHours ?? null,
    charityDonationNzd: req.body.charityDonationNzd ?? null,
    modernSlaveryCompliant: req.body.modernSlaveryCompliant ?? false,
    supplierCodeOfConduct: req.body.supplierCodeOfConduct ?? false,
    notes: req.body.notes ?? null,
    updatedAt: new Date(),
  };

  if (existing.length) {
    await db
      .update(socialWorkforceSnapshotsTable)
      .set(data)
      .where(eq(socialWorkforceSnapshotsTable.id, existing[0].id));
    res.json({ ...existing[0], ...data });
  } else {
    const id = crypto.randomUUID();
    await db.insert(socialWorkforceSnapshotsTable).values({ id, ...data });
    res.json({ id, ...data });
  }
});

// ─── H&S Incidents ───────────────────────────────────────────────────────────

router.get("/incidents", async (req, res) => {
  const { orgId } = req.params;
  const rows = await db
    .select()
    .from(hsIncidentsTable)
    .where(eq(hsIncidentsTable.organisationId, orgId))
    .orderBy(desc(hsIncidentsTable.incidentDate));
  res.json(rows);
});

router.post("/incidents", async (req, res) => {
  const { orgId } = req.params;
  const id = crypto.randomUUID();
  const row = {
    id,
    organisationId: orgId,
    incidentDate: new Date(req.body.incidentDate),
    incidentType: req.body.incidentType,
    description: req.body.description ?? null,
    daysLost: req.body.daysLost ?? 0,
    hoursWorkedAtTime: req.body.hoursWorkedAtTime ?? null,
    reportedBy: req.body.reportedBy ?? null,
    closedOut: req.body.closedOut ?? false,
  };
  await db.insert(hsIncidentsTable).values(row);
  res.status(201).json(row);
});

router.put("/incidents/:id", async (req, res) => {
  const { orgId, id } = req.params;
  await db
    .update(hsIncidentsTable)
    .set({
      incidentDate: req.body.incidentDate ? new Date(req.body.incidentDate) : undefined,
      incidentType: req.body.incidentType,
      description: req.body.description,
      daysLost: req.body.daysLost,
      hoursWorkedAtTime: req.body.hoursWorkedAtTime,
      reportedBy: req.body.reportedBy,
      closedOut: req.body.closedOut,
      updatedAt: new Date(),
    })
    .where(and(eq(hsIncidentsTable.id, id), eq(hsIncidentsTable.organisationId, orgId)));
  res.json({ ok: true });
});

router.delete("/incidents/:id", async (req, res) => {
  const { orgId, id } = req.params;
  await db
    .delete(hsIncidentsTable)
    .where(and(eq(hsIncidentsTable.id, id), eq(hsIncidentsTable.organisationId, orgId)));
  res.json({ ok: true });
});

// ─── Training Records ─────────────────────────────────────────────────────────

router.get("/training", async (req, res) => {
  const { orgId } = req.params;
  const rows = await db
    .select()
    .from(trainingRecordsTable)
    .where(eq(trainingRecordsTable.organisationId, orgId))
    .orderBy(desc(trainingRecordsTable.trainingDate));
  res.json(rows);
});

router.post("/training", async (req, res) => {
  const { orgId } = req.params;
  const id = crypto.randomUUID();
  const row = {
    id,
    organisationId: orgId,
    employeeName: req.body.employeeName,
    trainingDate: new Date(req.body.trainingDate),
    topic: req.body.topic,
    hours: req.body.hours,
    provider: req.body.provider ?? null,
    category: req.body.category ?? null,
  };
  await db.insert(trainingRecordsTable).values(row);
  res.status(201).json(row);
});

router.delete("/training/:id", async (req, res) => {
  const { orgId, id } = req.params;
  await db
    .delete(trainingRecordsTable)
    .where(and(eq(trainingRecordsTable.id, id), eq(trainingRecordsTable.organisationId, orgId)));
  res.json({ ok: true });
});

// ─── Summary (for PDF/reports) ────────────────────────────────────────────────

router.get("/summary", async (req, res) => {
  const { orgId } = req.params;
  const year = parseInt(req.query.year as string) || new Date().getFullYear();

  const [workforce] = await db
    .select()
    .from(socialWorkforceSnapshotsTable)
    .where(
      and(
        eq(socialWorkforceSnapshotsTable.organisationId, orgId),
        eq(socialWorkforceSnapshotsTable.periodYear, year)
      )
    )
    .limit(1);

  const incidents = await db
    .select()
    .from(hsIncidentsTable)
    .where(eq(hsIncidentsTable.organisationId, orgId));

  const training = await db
    .select()
    .from(trainingRecordsTable)
    .where(eq(trainingRecordsTable.organisationId, orgId));

  const currentYearIncidents = incidents.filter(
    (i) => new Date(i.incidentDate).getFullYear() === year
  );
  const ltiIncidents = currentYearIncidents.filter((i) => i.incidentType === "lost_time");
  const totalDaysLost = ltiIncidents.reduce((sum, i) => sum + (i.daysLost || 0), 0);
  const totalHoursWorked = workforce?.headcount
    ? workforce.headcount * 2000
    : null;
  const ltifr =
    ltiIncidents.length > 0 && totalHoursWorked
      ? (ltiIncidents.length / totalHoursWorked) * 1_000_000
      : null;

  const currentYearTraining = training.filter(
    (t) => new Date(t.trainingDate).getFullYear() === year
  );
  const totalTrainingHours = currentYearTraining.reduce((sum, t) => sum + (t.hours || 0), 0);
  const avgTrainingHoursPerEmployee =
    workforce?.headcount && workforce.headcount > 0
      ? totalTrainingHours / workforce.headcount
      : null;

  res.json({
    year,
    workforce: workforce || null,
    incidents: {
      total: currentYearIncidents.length,
      lostTime: ltiIncidents.length,
      totalDaysLost,
      ltifr,
    },
    training: {
      totalRecords: currentYearTraining.length,
      totalHours: totalTrainingHours,
      avgHoursPerEmployee: avgTrainingHoursPerEmployee,
    },
  });
});

export default router;
