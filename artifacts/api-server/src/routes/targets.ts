import { Router } from "express";
import { db } from "@workspace/db";
import { emissionTargetsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireOrgAccess, requireOrgAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { computeTargetProgress, loadOrgEmissionsContext } from "../lib/target-progress.js";

const router = Router({ mergeParams: true });

// GET /organisations/:orgId/targets
//
// Each row is enriched with a `progress` block computed on the server so
// that the dashboard widget and the targets page show the same number, and
// neither has to reimplement the (subtle) annualisation logic. See
// `lib/target-progress.ts` for the rationale and modes.
router.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const rows = await db
      .select()
      .from(emissionTargetsTable)
      .where(eq(emissionTargetsTable.organisationId, orgId))
      .orderBy(desc(emissionTargetsTable.targetYear));

    // One DB round-trip for org-wide emissions context; per-target progress
    // is then derived in pure JS.
    const ctx = rows.length > 0 ? await loadOrgEmissionsContext(orgId) : null;
    const items = rows.map((t) => ({
      ...t,
      progress: ctx ? computeTargetProgress(t, ctx) : null,
    }));

    res.json({ items, total: items.length });
  } catch (err) {
    req.log.error({ err }, "List emission targets failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// POST /organisations/:orgId/targets
router.post("/", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const { baselineYear, baselineCo2eKg, targetYear, targetPctReduction, label, framework } = req.body as {
      baselineYear: number;
      baselineCo2eKg: number;
      targetYear: number;
      targetPctReduction: number;
      label?: string;
      framework?: string;
    };

    if (!baselineYear || !baselineCo2eKg || !targetYear || targetPctReduction == null) {
      res.status(400).json({ error: "Bad Request", message: "baselineYear, baselineCo2eKg, targetYear, and targetPctReduction are required" });
      return;
    }
    if (targetPctReduction < 0 || targetPctReduction > 100) {
      res.status(400).json({ error: "Bad Request", message: "targetPctReduction must be between 0 and 100" });
      return;
    }
    if (targetYear <= baselineYear) {
      res.status(400).json({ error: "Bad Request", message: "targetYear must be after baselineYear" });
      return;
    }

    const [row] = await db.insert(emissionTargetsTable).values({
      id: uuidv4(),
      organisationId: orgId,
      baselineYear,
      baselineCo2eKg,
      targetYear,
      targetPctReduction,
      label: label ?? null,
      framework: framework ?? null,
    }).returning();

    await logAudit(req, orgId, "emission_target.created", { targetId: row.id, targetYear, targetPctReduction });
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Create emission target failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// PUT /organisations/:orgId/targets/:targetId
router.put("/:targetId", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const targetId = req.params.targetId as string;
    const { baselineYear, baselineCo2eKg, targetYear, targetPctReduction, label, framework } = req.body as Partial<{
      baselineYear: number;
      baselineCo2eKg: number;
      targetYear: number;
      targetPctReduction: number;
      label: string;
      framework: string;
    }>;

    const [updated] = await db
      .update(emissionTargetsTable)
      .set({
        ...(baselineYear != null && { baselineYear }),
        ...(baselineCo2eKg != null && { baselineCo2eKg }),
        ...(targetYear != null && { targetYear }),
        ...(targetPctReduction != null && { targetPctReduction }),
        ...(label !== undefined && { label }),
        ...(framework !== undefined && { framework }),
        updatedAt: new Date(),
      })
      .where(and(eq(emissionTargetsTable.id, targetId), eq(emissionTargetsTable.organisationId, orgId)))
      .returning();

    if (!updated) { res.status(404).json({ error: "Not Found" }); return; }
    await logAudit(req, orgId, "emission_target.updated", { targetId });
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Update emission target failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// DELETE /organisations/:orgId/targets/:targetId
router.delete("/:targetId", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const targetId = req.params.targetId as string;
    const [deleted] = await db
      .delete(emissionTargetsTable)
      .where(and(eq(emissionTargetsTable.id, targetId), eq(emissionTargetsTable.organisationId, orgId)))
      .returning({ id: emissionTargetsTable.id });
    if (!deleted) { res.status(404).json({ error: "Not Found" }); return; }
    await logAudit(req, orgId, "emission_target.deleted", { targetId });
    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "Delete emission target failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
