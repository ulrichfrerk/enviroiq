import { db, organisationsTable, reportsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { calcSustainabilityScore } from "./emissions.js";
import { sqlRow, numCol } from "./sql-result.js";
import { fetchAndStoreEm6Intensity, clearIntensityCache, pruneOldGridSnapshots } from "./em6.js";
import { pruneExpiredDocumentArchives } from "./documentArchive.js";

interface OrgMetrics {
  fleetCo2eKg: number;
  energyCo2eKg: number;
  totalCo2eKg: number;
  totalEnergyKwh: number;
  sustainabilityScore: number;
  computedAt: Date;
}

async function computeOrgMetrics(orgId: string, from?: Date, to?: Date): Promise<OrgMetrics> {
  const fromClause = from ? sql`AND recorded_at >= ${from}` : sql``;
  const toClause = to ? sql`AND recorded_at <= ${to}` : sql``;
  const fromClauseE = from ? sql`AND period_start >= ${from}` : sql``;
  const toClauseE = to ? sql`AND period_end <= ${to}` : sql``;

  const [fleetResult, energyResult, goalsResult] = await Promise.all([
    db.execute(sql`
      SELECT COALESCE(SUM(co2e_kg), 0) AS co2e, COALESCE(SUM(distance_km), 0) AS dist
      FROM fleet_events
      WHERE organisation_id = ${orgId} ${fromClause} ${toClause}
    `),
    db.execute(sql`
      SELECT COALESCE(SUM(co2e_kg), 0) AS co2e, COALESCE(SUM(usage_kwh), 0) AS kwh
      FROM energy_readings
      WHERE organisation_id = ${orgId} ${fromClauseE} ${toClauseE}
    `),
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'on_track') AS on_track,
        COUNT(*) AS total
      FROM goals
      WHERE organisation_id = ${orgId}
    `),
  ]);

  const fr = sqlRow(fleetResult);
  const er = sqlRow(energyResult);
  const gr = sqlRow(goalsResult);

  const fleetCo2eKg = numCol(fr, "co2e");
  const energyCo2eKg = numCol(er, "co2e");
  const totalCo2eKg = fleetCo2eKg + energyCo2eKg;
  const totalEnergyKwh = numCol(er, "kwh");
  const fleetDistanceKm = numCol(fr, "dist");
  const goalsOnTrack = Number(gr?.on_track ?? 0);
  const totalGoals = Number(gr?.total ?? 0);

  const sustainabilityScore = calcSustainabilityScore({
    totalCo2eKg,
    fleetDistanceKm,
    goalsOnTrack,
    totalGoals,
  });

  return { fleetCo2eKg, energyCo2eKg, totalCo2eKg, totalEnergyKwh, sustainabilityScore, computedAt: new Date() };
}

async function refreshAllOrgMetrics(): Promise<void> {
  const orgs = await db.select({ id: organisationsTable.id }).from(organisationsTable);
  let refreshed = 0;
  let failed = 0;
  for (const org of orgs) {
    try {
      const metrics = await computeOrgMetrics(org.id);
      await db.update(organisationsTable)
        .set({
          esgFleetCo2eKg: metrics.fleetCo2eKg,
          esgEnergyCo2eKg: metrics.energyCo2eKg,
          esgTotalCo2eKg: metrics.totalCo2eKg,
          esgEnergyKwh: metrics.totalEnergyKwh,
          esgSustainabilityScore: metrics.sustainabilityScore,
          esgComputedAt: metrics.computedAt,
          updatedAt: metrics.computedAt,
        })
        .where(eq(organisationsTable.id, org.id));
      refreshed++;
    } catch (err) {
      failed++;
      logger.warn({ err, orgId: org.id }, "ESG metrics refresh failed for org");
    }
  }
  logger.info({ refreshed, failed }, "ESG metrics scheduled refresh complete");
}

let schedulerHandle: ReturnType<typeof setInterval> | null = null;
let em6Handle: ReturnType<typeof setInterval> | null = null;
let pruneHandle: ReturnType<typeof setInterval> | null = null;
let archivePruneHandle: ReturnType<typeof setInterval> | null = null;
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;     // 15 minutes
const EM6_INTERVAL_MS = 30 * 60 * 1000;          // 30 minutes — matches em6 trading period
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;   // 24 hours

export function startScheduler(): void {
  if (schedulerHandle) return;
  void refreshAllOrgMetrics();
  schedulerHandle = setInterval(() => {
    void refreshAllOrgMetrics();
  }, REFRESH_INTERVAL_MS);
  logger.info({ intervalMs: REFRESH_INTERVAL_MS }, "ESG metrics scheduler started");

  // em6 NZ grid intensity — poll immediately and every 30 min
  clearIntensityCache();
  void fetchAndStoreEm6Intensity();
  em6Handle = setInterval(() => {
    clearIntensityCache();
    void fetchAndStoreEm6Intensity();
  }, EM6_INTERVAL_MS);
  logger.info({ intervalMs: EM6_INTERVAL_MS }, "em6 NZ grid intensity poller started");

  // Daily retention cleanup — delete grid snapshots older than 13 months
  // Run once at startup (in case the server was down for a while) then every 24h
  void pruneOldGridSnapshots();
  pruneHandle = setInterval(() => {
    void pruneOldGridSnapshots();
  }, PRUNE_INTERVAL_MS);
  logger.info({ intervalMs: PRUNE_INTERVAL_MS, retentionMonths: 13 }, "Grid intensity prune job scheduled");

  // Daily compliance archive prune — purge document blobs older than 6 months
  // (metadata row retained as evidence the doc was held + lawfully purged)
  void pruneExpiredDocumentArchives();
  archivePruneHandle = setInterval(() => {
    void pruneExpiredDocumentArchives();
  }, PRUNE_INTERVAL_MS);
  logger.info({ intervalMs: PRUNE_INTERVAL_MS, retentionMonths: 6 }, "Document archive prune job scheduled");
}

export function stopScheduler(): void {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
  if (em6Handle) {
    clearInterval(em6Handle);
    em6Handle = null;
  }
  if (pruneHandle) {
    clearInterval(pruneHandle);
    pruneHandle = null;
  }
  if (archivePruneHandle) {
    clearInterval(archivePruneHandle);
    archivePruneHandle = null;
  }
  logger.info("Schedulers stopped");
}

export { computeOrgMetrics };
