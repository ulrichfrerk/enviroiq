import { Router } from "express";
import { db, gridIntensitySnapshotsTable } from "@workspace/db";
import { desc, gte } from "drizzle-orm";
import { getCurrentGridIntensity } from "../lib/em6.js";

const router = Router();

// GET /grid/nz — public, no auth. Returns latest NZ grid carbon intensity + 24h trend.
router.get("/nz", async (req, res) => {
  try {
    const current = await getCurrentGridIntensity();
    if (!current) {
      res.status(503).json({ error: "Grid intensity data not yet available. Check back shortly." });
      return;
    }

    // Last 48 trading periods (24 hrs) for sparkline
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const history = await db
      .select({
        tradingPeriodStart: gridIntensitySnapshotsTable.tradingPeriodStart,
        gco2PerKwh: gridIntensitySnapshotsTable.gco2PerKwh,
        renewablePct: gridIntensitySnapshotsTable.renewablePct,
      })
      .from(gridIntensitySnapshotsTable)
      .where(gte(gridIntensitySnapshotsTable.fetchedAt, since))
      .orderBy(desc(gridIntensitySnapshotsTable.tradingPeriodStart))
      .limit(48);

    res.json({
      region: current.region,
      tradingPeriodStart: current.tradingPeriodStart,
      gco2PerKwh: current.gco2PerKwh,
      kgco2PerKwh: current.kgco2PerKwh,
      renewablePct: current.renewablePct,
      carbonTonnes: current.carbonTonnes,
      fetchedAt: current.fetchedAt,
      source: "em6 / Energy Market Services (EMS) — Transpower NZ",
      history: history.map((h) => ({
        t: h.tradingPeriodStart,
        g: h.gco2PerKwh,
        r: h.renewablePct,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get NZ grid intensity");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
