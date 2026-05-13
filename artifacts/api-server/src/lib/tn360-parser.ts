// Server-side parser for Teletrac Navman TN360 "Distance Trip Report" XLSX
// exports. Mirrors `parseTN360TripReport` in
// `artifacts/enviroiq/src/pages/fleet.tsx` so both the manual upload and the
// inbound-email auto-ingest path produce identical row shapes.
//
// Returned rows are aggregated to one row per (vehicle, date) day so the
// downstream `importKmRows` dedupe key (vehicle|date|distance) lines up with
// the manual import path.

import { read as xlsxRead, utils as xlsxUtils } from "xlsx";

export type TN360Row = {
  vehicle: string;
  date: string; // YYYY-MM-DD
  distanceKm: number;
  fuelLitres?: number;
};

export type TN360ParseResult = {
  ok: boolean;
  rows: TN360Row[];
  errors: string[];
  meta: {
    period?: string;
    vehicles: number;
    records: number;
    skippedTrips: number;
  };
};

const TN360_MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function parseTN360TripDate(raw: string): string | null {
  // "04 Jan 2026 12:52:28 PM" → "2026-01-04"
  const m = String(raw).match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (!m) return null;
  const mon = TN360_MONTHS[m[2]];
  return mon ? `${m[3]}-${mon}-${m[1].padStart(2, "0")}` : null;
}

/**
 * Returns true if the workbook's first sheet looks like a TN360 Distance Trip
 * Report (so callers can quickly decide whether to try the parser).
 */
export function looksLikeTN360TripReport(buffer: Buffer): boolean {
  try {
    const wb = xlsxRead(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return false;
    const raw = xlsxUtils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
    const firstCell = String((raw[0] as unknown[] | undefined)?.[0] ?? "");
    return firstCell.includes("Distance Trip Report");
  } catch {
    return false;
  }
}

export function parseTN360TripReportBuffer(buffer: Buffer): TN360ParseResult {
  let raw: unknown[][];
  try {
    const wb = xlsxRead(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) {
      return { ok: false, rows: [], errors: ["Workbook has no sheets"], meta: { vehicles: 0, records: 0, skippedTrips: 0 } };
    }
    raw = xlsxUtils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
  } catch (err) {
    return {
      ok: false,
      rows: [],
      errors: [`Could not read XLSX: ${err instanceof Error ? err.message : String(err)}`],
      meta: { vehicles: 0, records: 0, skippedTrips: 0 },
    };
  }

  // Row 0: "Distance Trip Report (N results)"
  // Row 2: ["Time Period:", "…"]
  // Row 4: header row
  const period = raw[2]?.[1] ? String(raw[2][1]).trim() : undefined;
  const header = (raw[4] ?? []) as (string | null)[];

  const vCol     = header.indexOf("Vehicle");
  const dateCol  = header.indexOf("Start Time");
  const distCol  = header.indexOf("Distance Travelled (km)");
  const plausCol = header.indexOf("Plausible");
  const fuelCol  = header.indexOf("Fuel Used (L)");

  if (vCol === -1 || dateCol === -1 || distCol === -1) {
    return {
      ok: false,
      rows: [],
      errors: ["Could not find required columns (Vehicle, Start Time, Distance Travelled (km)) in the TN360 Distance Trip Report."],
      meta: { vehicles: 0, records: 0, skippedTrips: 0, period },
    };
  }

  const daily = new Map<string, { vehicle: string; date: string; distanceKm: number; fuelLitres: number }>();
  let skippedTrips = 0;

  for (let i = 5; i < raw.length; i++) {
    const row = raw[i] as (string | number | null)[] | undefined;
    if (!row?.[0]) continue;

    const plaus = plausCol >= 0 ? row[plausCol] : 1;
    if (plaus !== null && Number(plaus) === 0) { skippedTrips++; continue; }

    const dist = Number(row[distCol]);
    if (!dist || dist <= 0) continue;

    const vehicle = String(row[vCol] ?? "").trim();
    if (!vehicle) continue;

    const date = parseTN360TripDate(String(row[dateCol] ?? ""));
    if (!date) { skippedTrips++; continue; }

    const fuel = fuelCol >= 0 ? Number(row[fuelCol]) || 0 : 0;
    const key = `${vehicle}|${date}`;
    const existing = daily.get(key);
    if (existing) {
      existing.distanceKm += dist;
      existing.fuelLitres += fuel;
    } else {
      daily.set(key, { vehicle, date, distanceKm: dist, fuelLitres: fuel });
    }
  }

  const rows: TN360Row[] = [...daily.values()].map(r => ({
    vehicle: r.vehicle,
    date: r.date,
    distanceKm: Number(r.distanceKm.toFixed(2)),
    fuelLitres: r.fuelLitres > 0 ? Number(r.fuelLitres.toFixed(2)) : undefined,
  }));

  const errors: string[] = [];
  if (skippedTrips > 0) {
    errors.push(`${skippedTrips} trip${skippedTrips === 1 ? "" : "s"} skipped (implausible GPS or missing date) — daily totals are unaffected.`);
  }

  return {
    ok: true,
    rows,
    errors,
    meta: {
      period,
      vehicles: new Set(rows.map(r => r.vehicle)).size,
      records: rows.length,
      skippedTrips,
    },
  };
}
