// Standard emission factors
export const EMISSION_FACTORS = {
  // kg CO2e per litre of fuel
  petrol: 2.31,
  diesel: 2.68,
  lpg: 1.51,
  // kg CO2e per kWh (NZ grid average — MfE 5-year rolling average)
  electricity: 0.0977,
  // kg CO2e per MJ of natural gas
  gas: 0.0535,
};

/**
 * Official NZ grid electricity emission factors by calendar year.
 * Source: Ministry for the Environment (MfE) "Measuring Emissions" guides
 * and EECA annual energy data. Used for retrospective billing periods.
 *
 * Method: location-based (grid average), kg CO2e per kWh.
 * For years not in this table, falls back to EMISSION_FACTORS.electricity (0.0977).
 */
export const NZ_GRID_FACTORS_BY_YEAR: Record<number, number> = {
  2015: 0.1070, // MfE historical — higher gas/coal use
  2016: 0.0997,
  2017: 0.0987,
  2018: 0.1084, // Dry hydro year — more gas peaking
  2019: 0.0967,
  2020: 0.0840, // Good hydro + COVID demand drop
  2021: 0.0977, // Dry year — more thermal
  2022: 0.0912, // Increasing renewables
  2023: 0.0820, // Further renewable growth
  2024: 0.0580, // Strong hydro/wind year (em6 data)
  2025: 0.0550, // Provisional estimate
  // 2026+ uses live em6 reading where available, falls back to 0.0977
};

/**
 * Return the best available NZ grid emission factor for a given billing period.
 * Priority:
 *   1. supplierRenewablePct = 100 → 0 kg (market-based, GHG Protocol)
 *   2. Partial renewable → interpolated between 0 and grid average
 *   3. Year-specific historical factor from MfE/EECA table
 *   4. Default grid average (0.0977)
 */
export function resolveElectricityFactor({
  periodStart,
  supplierRenewablePct,
  liveGridKgCo2PerKwh,
}: {
  periodStart?: Date;
  supplierRenewablePct?: number;   // 0-100, from supplier contract (market-based)
  liveGridKgCo2PerKwh?: number;   // from em6 API, for current-period readings
}): { factorKgCo2PerKwh: number; method: string; note: string } {
  // Market-based: supplier provides renewable energy certificate / PPA
  if (supplierRenewablePct !== undefined && supplierRenewablePct > 0) {
    const gridFactor = periodStart
      ? (NZ_GRID_FACTORS_BY_YEAR[periodStart.getFullYear()] ?? EMISSION_FACTORS.electricity)
      : EMISSION_FACTORS.electricity;
    // Non-renewable share uses grid factor; renewable share = 0
    const nonRenewableFraction = (100 - supplierRenewablePct) / 100;
    const factorKgCo2PerKwh = gridFactor * nonRenewableFraction;
    const method = supplierRenewablePct === 100 ? "market_based_100pct_renewable" : "market_based_partial_renewable";
    return {
      factorKgCo2PerKwh,
      method,
      note: `Supplier ${supplierRenewablePct}% renewable (GHG Protocol market-based method). Grid avg for ${periodStart?.getFullYear() ?? "period"}: ${(gridFactor * 1000).toFixed(1)} gCO₂e/kWh.`,
    };
  }

  // Live em6 reading for current-period bills
  if (liveGridKgCo2PerKwh !== undefined && liveGridKgCo2PerKwh > 0) {
    return {
      factorKgCo2PerKwh: liveGridKgCo2PerKwh,
      method: "location_based_live_em6",
      note: `Live NZ grid intensity from em6 / EMS: ${(liveGridKgCo2PerKwh * 1000).toFixed(1)} gCO₂e/kWh (location-based).`,
    };
  }

  // Historical year-specific factor
  if (periodStart) {
    const year = periodStart.getFullYear();
    if (year in NZ_GRID_FACTORS_BY_YEAR) {
      const factorKgCo2PerKwh = NZ_GRID_FACTORS_BY_YEAR[year];
      return {
        factorKgCo2PerKwh,
        method: "location_based_annual_avg",
        note: `NZ grid annual average for ${year}: ${(factorKgCo2PerKwh * 1000).toFixed(1)} gCO₂e/kWh (MfE/EECA, location-based).`,
      };
    }
  }

  // Default fallback
  return {
    factorKgCo2PerKwh: EMISSION_FACTORS.electricity,
    method: "location_based_default",
    note: `NZ grid average (MfE 5-year rolling): ${(EMISSION_FACTORS.electricity * 1000).toFixed(1)} gCO₂e/kWh (location-based).`,
  };
}

/**
 * Infer the best fuel type from the model string when the declared type may be wrong.
 * Fuelsaver / NZ plate lookup uses "P" suffix for petrol, "D" for diesel.
 * Returns null when model string gives no clear signal (use declared fuelType).
 */
export function inferFuelTypeFromModel(make = "", model = ""): string | null {
  const t = `${make} ${model}`;

  // Plug-in Hybrid Electric Vehicle (PHEV / AXAP Toyota codes)
  if (/PHEV|plug.in.hybrid|AXAP/i.test(t)) return "hybrid";

  // Self-charging hybrid (HEV / AXAH Toyota codes / hybrid label)
  if (/\bHEV\b|AXAH|\bhybrid\b/i.test(t)) return "hybrid";

  // Electric
  if (/\bEV\b|\bBEV\b|electric.vehicle/i.test(t)) return "electric";

  // Fuelsaver petrol marker: digit(s) + "." + digit + "P" followed by space/end (e.g. "2.0P", "3.5P", "1.8P")
  if (/\d+\.\d+P(\s|$)/i.test(t)) return "petrol";

  return null;
}

export function calcFleetCo2e({
  fuelType,
  distanceKm,
  fuelLitres,
  emissionFactorKgPerKm,
  make,
  model,
}: {
  fuelType: string;
  distanceKm?: number;
  fuelLitres?: number;
  emissionFactorKgPerKm?: number;
  make?: string;
  model?: string;
}): number {
  // Auto-correct fuel type from model string (handles mislabelled vehicles)
  const resolvedFuelType = inferFuelTypeFromModel(make ?? "", model ?? "") ?? fuelType;

  if (resolvedFuelType === "electric") return 0;

  // If we have actual fuel consumption, use it (most accurate)
  if (fuelLitres && resolvedFuelType in EMISSION_FACTORS) {
    return fuelLitres * EMISSION_FACTORS[resolvedFuelType as keyof typeof EMISSION_FACTORS];
  }

  // Distance-based estimation
  if (distanceKm) {
    const classFactor = emissionFactorKgPerKm == null
      ? vehicleClassEmissionFactor(make ?? "", model ?? "")
      : null;
    const factor = emissionFactorKgPerKm ?? classFactor ?? defaultEmissionFactor(resolvedFuelType);
    return distanceKm * factor;
  }
  return 0;
}

function defaultEmissionFactor(fuelType: string): number {
  const defaults: Record<string, number> = {
    petrol:   0.196,  // kg CO₂e/km — NZ light petrol vehicle average (MfE)
    diesel:   0.214,  // kg CO₂e/km — NZ light diesel vehicle average (MfE)
    hybrid:   0.104,  // kg CO₂e/km — self-charging hybrid (Toyota HEV fleet avg)
    phev:     0.067,  // kg CO₂e/km — PHEV (assumes ~40% electric, MfE guidance)
    lpg:      0.16,
    hydrogen: 0.005,
    electric: 0,
    other:    0.2,
  };
  return defaults[fuelType] ?? 0.2;
}

/**
 * NZ-specific emission factor based on vehicle class detected from make/model.
 * Factors derived from MfE and EECA guidance for NZ fleet.
 *
 *  PHEV (Toyota AXAP/RAV4 PHEV)   — 0.067 kg CO₂e/km
 *  Hybrid (Toyota AXAH/HEV)       — 0.104 kg CO₂e/km
 *  Light commercial (<3.5t GVM)   — 0.214 kg CO₂e/km  (Hilux, Hiace, Ranger, D-Max)
 *  Medium truck (3.5–8t GVM)      — 0.340 kg CO₂e/km  (Hino Dutro 300, Isuzu NPR, Fuso Canter)
 *  Medium-heavy truck (8–16t)     — 0.520 kg CO₂e/km  (Hino 500, Isuzu FRR/FVR)
 *  Heavy truck (>16t GVM)         — 0.900 kg CO₂e/km  (Scania, Volvo FH, Kenworth)
 *  Construction equipment         — 0.000 kg CO₂e/km  (not distance-based; use fuel litres)
 *
 * Returns null when no vehicle-class match is found (caller falls back to defaultEmissionFactor).
 */
export function vehicleClassEmissionFactor(make = "", model = ""): number | null {
  const t = `${make} ${model}`.toLowerCase();

  // Electric
  if (/\bev\b|electric|bev|ioniq|leaf|model\s[s3xy]|e-tron/.test(t)) return 0;

  // PHEV — before hybrid so AXAP models aren't caught by generic hybrid
  if (/phev|plug.in.hybrid|axap/.test(t)) return 0.067;

  // Hybrid (self-charging HEV)
  if (/\bhev\b|axah|\bhybrid\b/.test(t)) return 0.104;

  // Petrol — Fuelsaver "P" suffix (e.g. "2.0p", "3.5p")
  if (/\d+\.\d+p(\s|$)/.test(t)) return 0.196;

  // Construction / off-road equipment — CO₂e from fuel consumption, not km
  if (/hitachi|kobelco|komatsu|caterpillar|\bcatb\b|excavator|loader|forklift|jcb|polaris\s*ranger/.test(t)) return 0;

  // Heavy on-road trucks (>16t GVM)
  if (/scania|kenworth|mack\b|freightliner|volvo\s*(fh|fm|fl|fmx)|western\s*star/.test(t)) return 0.9;

  // Medium-heavy trucks (8–16t): Hino 500/700, Isuzu FRR/FVR/FSR, UD Quon/Condor
  if (/hino\s*(500|700|fc|fd|fe|fg|gh|gk)|isuzu\s*(frr|fsr|fvr|gsr|gvr)|ud\s*(quon|condor)/.test(t)) return 0.52;

  // Medium trucks (3.5–8t): Hino Dutro/300, Isuzu NPR/NLS/NQR/NPS, Fuso Canter, Ford Transit HD
  if (/hino\s*(300|dutro|816|921)|isuzu\s*(npr|nls|nqr|nps)|(mitsubishi\s*)?fuso(\s*canter)?|\bcanter\b/.test(t)) return 0.34;

  return null; // no class match — use fuelType default
}

export function calcEnergyCo2e({
  utilityType,
  usageKwh,
  usageMj,
  electricityFactorKgCo2PerKwh,
}: {
  utilityType: string;
  usageKwh?: number;
  usageMj?: number;
  electricityFactorKgCo2PerKwh?: number; // override: uses resolveElectricityFactor() result
}): number {
  if (utilityType === "electricity" && usageKwh) {
    const factor = electricityFactorKgCo2PerKwh ?? EMISSION_FACTORS.electricity;
    return usageKwh * factor;
  }
  if (utilityType === "gas") {
    if (usageMj) return usageMj * EMISSION_FACTORS.gas;
    if (usageKwh) return usageKwh * 3.6 * EMISSION_FACTORS.gas;
  }
  return 0;
}

export function calcSustainabilityScore({
  totalCo2eKg,
  fleetDistanceKm,
  goalsOnTrack,
  totalGoals,
}: {
  totalCo2eKg: number;
  fleetDistanceKm: number;
  goalsOnTrack: number;
  totalGoals: number;
}): number {
  // Simple scoring: 0-100
  let score = 50;
  const intensity = fleetDistanceKm > 0 ? totalCo2eKg / fleetDistanceKm : 0;
  if (intensity < 0.15) score += 20;
  else if (intensity < 0.25) score += 10;
  else if (intensity > 0.4) score -= 15;

  if (totalGoals > 0) {
    const goalRatio = goalsOnTrack / totalGoals;
    score += Math.round(goalRatio * 30);
  }

  return Math.min(100, Math.max(0, score));
}
