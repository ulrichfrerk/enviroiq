import { db, gridIntensitySnapshotsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { logger } from "./logger.js";

const EM6_ENDPOINT = "https://api.em6.co.nz/ords/em6/data_api/current_carbon_intensity/";

interface Em6CarbonItem {
  trading_date: string;
  trading_period: number;
  timestamp: string;
  nz_carbon_t: number;
  nz_carbon_gkwh: number;
  nz_renewable: number;
}

interface Em6Response {
  items: Em6CarbonItem[];
}

export interface GridIntensity {
  region: string;
  tradingPeriodStart: Date;
  gco2PerKwh: number;
  kgco2PerKwh: number;
  renewablePct: number;
  carbonTonnes: number;
  fetchedAt: Date;
}

let _cached: GridIntensity | null = null;

export async function fetchAndStoreEm6Intensity(): Promise<GridIntensity | null> {
  try {
    const res = await fetch(EM6_ENDPOINT, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "em6 API returned non-OK status");
      return null;
    }
    const data = (await res.json()) as Em6Response;
    const latest = data.items?.[0];
    if (!latest) {
      logger.warn("em6 API returned no items");
      return null;
    }

    const snap = {
      source: "em6",
      region: "NZ",
      tradingPeriodStart: new Date(latest.timestamp),
      gco2PerKwh: latest.nz_carbon_gkwh,
      renewablePct: latest.nz_renewable,
      carbonTonnes: latest.nz_carbon_t,
      rawJson: latest as unknown as Record<string, unknown>,
    };

    await db.insert(gridIntensitySnapshotsTable).values(snap);
    logger.info(
      { gco2PerKwh: latest.nz_carbon_gkwh, renewablePct: latest.nz_renewable },
      "em6 grid intensity stored",
    );

    const intensity: GridIntensity = {
      region: "NZ",
      tradingPeriodStart: new Date(latest.timestamp),
      gco2PerKwh: latest.nz_carbon_gkwh,
      kgco2PerKwh: latest.nz_carbon_gkwh / 1000,
      renewablePct: latest.nz_renewable,
      carbonTonnes: latest.nz_carbon_t,
      fetchedAt: new Date(),
    };
    _cached = intensity;
    return intensity;
  } catch (err) {
    logger.warn({ err }, "em6 fetch failed");
    return null;
  }
}

export async function getCurrentGridIntensity(): Promise<GridIntensity | null> {
  if (_cached) return _cached;
  try {
    const row = await db
      .select()
      .from(gridIntensitySnapshotsTable)
      .orderBy(desc(gridIntensitySnapshotsTable.fetchedAt))
      .limit(1);
    if (row.length === 0) return null;
    const r = row[0];
    const intensity: GridIntensity = {
      region: r.region,
      tradingPeriodStart: r.tradingPeriodStart,
      gco2PerKwh: r.gco2PerKwh,
      kgco2PerKwh: r.gco2PerKwh / 1000,
      renewablePct: r.renewablePct ?? 0,
      carbonTonnes: r.carbonTonnes ?? 0,
      fetchedAt: r.fetchedAt,
    };
    _cached = intensity;
    return intensity;
  } catch {
    return null;
  }
}

export function clearIntensityCache(): void {
  _cached = null;
}
