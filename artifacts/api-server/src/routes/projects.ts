import { Router } from "express";
import { db } from "@workspace/db";
import { projectsTable, insertProjectSchema } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, requireOrgAccess } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { randomUUID } from "crypto";

const router = Router({ mergeParams: true });

router.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const rows = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.organisationId, orgId))
      .orderBy(desc(projectsTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Get projects failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const parsed = insertProjectSchema.safeParse({ ...req.body, id: randomUUID(), organisationId: orgId });
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", issues: parsed.error.issues });
      return;
    }
    const [row] = await db.insert(projectsTable).values(parsed.data).returning();
    await logAudit({ req, action: "project.create", resourceType: "project", resourceId: row.id });
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Create project failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.patch("/:projectId", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const projectId = req.params.projectId as string;
    const { id: _id, organisationId: _oid, createdAt: _ca, updatedAt: _ua, ...updates } = req.body;
    const [row] = await db
      .update(projectsTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.organisationId, orgId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await logAudit({ req, action: "project.update", resourceType: "project", resourceId: projectId });
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Update project failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/:projectId", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const projectId = req.params.projectId as string;
    await db.delete(projectsTable).where(and(eq(projectsTable.id, projectId), eq(projectsTable.organisationId, orgId)));
    await logAudit({ req, action: "project.delete", resourceType: "project", resourceId: projectId });
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Delete project failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
