import { Router } from "express";
import { db, goalsTable, fleetEventsTable, energyReadingsTable, type Goal } from "@workspace/db";
import { eq, and, count, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireOrgAccess, requireOrgAdmin } from "../lib/auth.js";
import { sqlRow, sqlRows, numCol, intCol, strCol } from "../lib/sql-result.js";
import { logAudit } from "../lib/audit.js";

const router = Router({ mergeParams: true });

function calcGoalProgress(goal: Goal, currentValue: number): { progressPercent: number; status: string } {
  if (!goal.targetValue) return { progressPercent: 0, status: "not_started" };

  let progressPercent = 0;
  if (goal.targetType === "reduce_by_percent") {
    const baseline = goal.baselineValue || goal.targetValue;
    const reduced = baseline - currentValue;
    const needed = (goal.targetValue / 100) * baseline;
    progressPercent = needed > 0 ? Math.min(100, (reduced / needed) * 100) : 0;
  } else if (goal.targetType === "reduce_to_absolute") {
    const baseline = goal.baselineValue || goal.targetValue * 1.5;
    const reduced = baseline - currentValue;
    const needed = baseline - goal.targetValue;
    progressPercent = needed > 0 ? Math.min(100, (reduced / needed) * 100) : 0;
  } else {
    progressPercent = goal.targetValue > 0 ? Math.min(100, (currentValue / goal.targetValue) * 100) : 0;
  }

  let status = "on_track";
  const now = new Date();
  if (goal.dueDate) {
    const daysTotal = (new Date(goal.dueDate).getTime() - new Date(goal.createdAt).getTime()) / 86400000;
    const daysElapsed = (now.getTime() - new Date(goal.createdAt).getTime()) / 86400000;
    const timePercent = daysTotal > 0 ? (daysElapsed / daysTotal) * 100 : 0;
    if (progressPercent >= 100) status = "achieved";
    else if (progressPercent < timePercent - 20) status = "behind";
    else if (progressPercent < timePercent - 5) status = "at_risk";
  }

  return { progressPercent: Math.max(0, progressPercent), status };
}

// GET /organisations/:orgId/goals
router.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const goals = await db.query.goalsTable.findMany({
      where: eq(goalsTable.organisationId, orgId),
    });
    const [{ total }] = await db.select({ total: count() }).from(goalsTable).where(eq(goalsTable.organisationId, orgId));
    res.json({ items: goals, total });
  } catch (err) {
    req.log.error({ err }, "List goals failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to list goals" });
  }
});

// POST /organisations/:orgId/goals
router.post("/", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const { title, description, category, targetType, targetValue, targetUnit, baselineValue, baselineYear, targetYear, dueDate, isPublic } = req.body;
    if (!title || !category || !targetType || targetValue === undefined || !targetUnit) {
      res.status(400).json({ error: "Bad Request", message: "title, category, targetType, targetValue, targetUnit required" });
      return;
    }

    const [goal] = await db.insert(goalsTable).values({
      id: uuidv4(),
      organisationId: orgId,
      title,
      description,
      category,
      targetType,
      targetValue,
      targetUnit,
      baselineValue,
      baselineYear,
      targetYear,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      isPublic: isPublic ?? false,
      status: "not_started",
    }).returning();

    await logAudit({ req, action: "goal.create", resourceType: "goal", resourceId: goal.id });
    res.status(201).json(goal);
  } catch (err) {
    req.log.error({ err }, "Create goal failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to create goal" });
  }
});

// GET /organisations/:orgId/goals/:goalId
router.get("/:goalId", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string; const goalId = req.params.goalId as string;
    const goal = await db.query.goalsTable.findFirst({
      where: and(eq(goalsTable.id, goalId), eq(goalsTable.organisationId, orgId)),
    });
    if (!goal) {
      res.status(404).json({ error: "Not Found", message: "Goal not found" });
      return;
    }

    // Calculate current value based on category
    let currentValue = 0;
    const now = new Date();
    const fromDate = goal.baselineYear
      ? new Date(goal.baselineYear, 0, 1)
      : new Date(now.getFullYear(), 0, 1);

    if (goal.category === "emissions" || goal.category === "fleet") {
      const result = await db.execute(sql`
        SELECT COALESCE(SUM(co2e_kg), 0) as total
        FROM fleet_events
        WHERE organisation_id = ${orgId}
          AND recorded_at >= ${fromDate}
      `);
      currentValue = parseFloat(String(sqlRow(result).total ?? "0")) || 0;
    } else if (goal.category === "energy") {
      const result = await db.execute(sql`
        SELECT COALESCE(SUM(co2e_kg), 0) as total
        FROM energy_readings
        WHERE organisation_id = ${orgId}
          AND period_start >= ${fromDate}
      `);
      currentValue = parseFloat(String(sqlRow(result).total ?? "0")) || 0;
    }

    const { progressPercent, status } = calcGoalProgress(goal, currentValue);
    const daysRemaining = goal.dueDate ? Math.max(0, Math.ceil((new Date(goal.dueDate).getTime() - now.getTime()) / 86400000)) : undefined;

    res.json({ ...goal, currentValue, progressPercent, daysRemaining });
  } catch (err) {
    req.log.error({ err }, "Get goal failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to get goal" });
  }
});

// PATCH /organisations/:orgId/goals/:goalId
router.patch("/:goalId", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string; const goalId = req.params.goalId as string;
    const { title, description, targetValue, targetUnit, dueDate, status, isPublic } = req.body;
    const [goal] = await db
      .update(goalsTable)
      .set({ title, description, targetValue, targetUnit, dueDate: dueDate ? new Date(dueDate) : undefined, status, isPublic, updatedAt: new Date() })
      .where(and(eq(goalsTable.id, goalId), eq(goalsTable.organisationId, orgId)))
      .returning();
    if (!goal) {
      res.status(404).json({ error: "Not Found", message: "Goal not found" });
      return;
    }
    await logAudit({ req, action: "goal.update", resourceType: "goal", resourceId: goalId });
    res.json(goal);
  } catch (err) {
    req.log.error({ err }, "Update goal failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to update goal" });
  }
});

// DELETE /organisations/:orgId/goals/:goalId
router.delete("/:goalId", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string; const goalId = req.params.goalId as string;
    await db.delete(goalsTable).where(and(eq(goalsTable.id, goalId), eq(goalsTable.organisationId, orgId)));
    await logAudit({ req, action: "goal.delete", resourceType: "goal", resourceId: goalId });
    res.json({ message: "Goal deleted" });
  } catch (err) {
    req.log.error({ err }, "Delete goal failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to delete goal" });
  }
});

export default router;
