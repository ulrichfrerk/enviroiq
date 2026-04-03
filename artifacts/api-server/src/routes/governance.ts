import { Router } from "express";
import { db } from "@workspace/db";
import { governanceSnapshotsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireOrgAccess } from "../lib/auth.js";
import crypto from "crypto";

const router = Router({ mergeParams: true });
router.use(requireAuth);
router.use(requireOrgAccess);

router.get("/", async (req, res) => {
  const { orgId } = req.params;
  const year = parseInt(req.query.year as string) || new Date().getFullYear();
  const rows = await db
    .select()
    .from(governanceSnapshotsTable)
    .where(
      and(
        eq(governanceSnapshotsTable.organisationId, orgId),
        eq(governanceSnapshotsTable.periodYear, year)
      )
    )
    .limit(1);
  res.json(rows[0] || null);
});

router.put("/", async (req, res) => {
  const { orgId } = req.params;
  const year = parseInt(req.body.periodYear) || new Date().getFullYear();

  const existing = await db
    .select()
    .from(governanceSnapshotsTable)
    .where(
      and(
        eq(governanceSnapshotsTable.organisationId, orgId),
        eq(governanceSnapshotsTable.periodYear, year)
      )
    )
    .limit(1);

  const data = {
    organisationId: orgId,
    periodYear: year,
    boardSize: req.body.boardSize ?? null,
    boardIndependentCount: req.body.boardIndependentCount ?? null,
    boardFemaleCount: req.body.boardFemaleCount ?? null,
    boardMeetingsPerYear: req.body.boardMeetingsPerYear ?? null,
    hasAuditCommittee: req.body.hasAuditCommittee ?? false,
    hasCodeOfConduct: req.body.hasCodeOfConduct ?? false,
    hasWhistleblower: req.body.hasWhistleblower ?? false,
    hasAntiBribery: req.body.hasAntiBribery ?? false,
    hasPrivacyPolicy: req.body.hasPrivacyPolicy ?? false,
    hasCyberFramework: req.body.hasCyberFramework ?? false,
    hasEsgRiskRegister: req.body.hasEsgRiskRegister ?? false,
    hasTcfdAligned: req.body.hasTcfdAligned ?? false,
    hasExternalAssurance: req.body.hasExternalAssurance ?? false,
    hasModernSlaveryPolicy: req.body.hasModernSlaveryPolicy ?? false,
    frameworkAlignment: req.body.frameworkAlignment ?? null,
    notes: req.body.notes ?? null,
    updatedAt: new Date(),
  };

  if (existing.length) {
    await db
      .update(governanceSnapshotsTable)
      .set(data)
      .where(eq(governanceSnapshotsTable.id, existing[0].id));
    res.json({ ...existing[0], ...data });
  } else {
    const id = crypto.randomUUID();
    await db.insert(governanceSnapshotsTable).values({ id, ...data });
    res.json({ id, ...data });
  }
});

export default router;
