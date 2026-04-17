import { Router } from "express";
import { db, gridIntensitySnapshotsTable } from "@workspace/db";
import { asc, desc, gte } from "drizzle-orm";
import { getCurrentGridIntensity } from "../lib/em6.js";

const router = Router();

const RANGE_HOURS: Record<string, number> = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
  "90d": 24 * 90,
};

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

// GET /grid/nz/history?range=24h|7d|30d|90d — public, no auth.
// Returns full time-series of NZ grid carbon intensity for the requested window
// plus simple aggregates so the UI can plan low-carbon usage windows
// (e.g. EV charging schedules) without re-deriving from raw points.
router.get("/nz/history", async (req, res) => {
  try {
    const range = String(req.query.range ?? "7d");
    const hours = RANGE_HOURS[range] ?? 24 * 7;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const rows = await db
      .select({
        tradingPeriodStart: gridIntensitySnapshotsTable.tradingPeriodStart,
        gco2PerKwh: gridIntensitySnapshotsTable.gco2PerKwh,
        renewablePct: gridIntensitySnapshotsTable.renewablePct,
        fetchedAt: gridIntensitySnapshotsTable.fetchedAt,
      })
      .from(gridIntensitySnapshotsTable)
      .where(gte(gridIntensitySnapshotsTable.fetchedAt, since))
      .orderBy(asc(gridIntensitySnapshotsTable.tradingPeriodStart));

    const points = rows.map((r) => ({
      t: r.tradingPeriodStart,
      g: Number(r.gco2PerKwh),
      r: Number(r.renewablePct),
    }));

    let min: { t: string; g: number } | null = null;
    let max: { t: string; g: number } | null = null;
    let sum = 0;
    let lowCount = 0; // < 60 g
    let medCount = 0; // 60–100 g
    let highCount = 0; // ≥ 100 g
    for (const p of points) {
      if (!min || p.g < min.g) min = { t: String(p.t), g: p.g };
      if (!max || p.g > max.g) max = { t: String(p.t), g: p.g };
      sum += p.g;
      if (p.g < 60) lowCount++;
      else if (p.g < 100) medCount++;
      else highCount++;
    }
    const avg = points.length > 0 ? sum / points.length : 0;
    const total = points.length || 1;

    // Average intensity by hour-of-day across the window — helps spot the
    // greenest charging windows (e.g. 02:00 typically lowest in NZ).
    // IMPORTANT: bin by NZ local hour (Pacific/Auckland), not server-local.
    // The API server runs in UTC; without an explicit timezone the bins would
    // be shifted ~12–13h and the "greenest window" recommendation would be
    // wrong for the user's actual clock. Uses Intl.DateTimeFormat which
    // handles NZST/NZDT transitions automatically.
    const nzHourFmt = new Intl.DateTimeFormat("en-NZ", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: "Pacific/Auckland",
    });
    const byHourSum = new Array<number>(24).fill(0);
    const byHourCount = new Array<number>(24).fill(0);
    for (const p of points) {
      const h = parseInt(nzHourFmt.format(new Date(p.t as unknown as string)), 10);
      if (Number.isFinite(h) && h >= 0 && h < 24) {
        byHourSum[h] += p.g;
        byHourCount[h] += 1;
      }
    }
    const hourly = byHourSum.map((s, h) => ({
      hour: h,
      g: byHourCount[h] > 0 ? s / byHourCount[h] : null,
      samples: byHourCount[h],
    }));

    res.json({
      range,
      hours,
      since: since.toISOString(),
      count: points.length,
      summary: {
        avg,
        min,
        max,
        lowPct: Math.round((lowCount / total) * 100),
        medPct: Math.round((medCount / total) * 100),
        highPct: Math.round((highCount / total) * 100),
      },
      hourlyAverage: hourly,
      hourlyTimezone: "Pacific/Auckland",
      points,
      source: "em6 / Energy Market Services (EMS) — Transpower NZ",
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get NZ grid intensity history");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
