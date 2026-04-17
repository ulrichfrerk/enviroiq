import { Router } from "express";
import { db, emissionFactorsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();

// GET /emission-factors — list all factors (public to authenticated users)
router.get("/", requireAuth, async (_req, res) => {
  try {
    const items = await db.select().from(emissionFactorsTable)
      .orderBy(desc(emissionFactorsTable.effectiveFrom));
    res.json({ items, total: items.length });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error", message: "Failed to list emission factors" });
  }
});

// GET /emission-factors/:id — single factor detail (lineage lookup)
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const [factor] = await db.select().from(emissionFactorsTable)
      .where(eq(emissionFactorsTable.id, req.params.id)).limit(1);
    if (!factor) {
      res.status(404).json({ error: "Not Found", message: "Emission factor not found" });
      return;
    }
    res.json(factor);
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error", message: "Failed to get emission factor" });
  }
});

export default router;
