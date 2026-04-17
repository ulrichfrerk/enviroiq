/**
 * NZ-specific recommendations catalogue.
 *
 * All numbers grounded in 2024–2026 NZ market data: NZ MfE 2024 emission
 * factors, em6 grid intensity, NZ EECA fleet guidance, NZ Solar Industries
 * Association installed-cost benchmarks, retail electricity tariffs.
 *
 * Keep this catalogue small and credible. Each entry should be defensible
 * to an auditor.
 */

// ── NZ grid + fuel constants ────────────────────────────────────────────────

export const NZ_GRID_INTENSITY_KG_PER_KWH = 0.098; // 2024 MfE consumer-based
export const PETROL_KG_PER_LITRE = 2.36;           // MfE 2024
export const DIESEL_KG_PER_LITRE = 2.68;           // MfE 2024
export const PETROL_NZD_PER_LITRE = 2.85;          // 2026 NZ avg
export const DIESEL_NZD_PER_LITRE = 2.20;
export const NZ_RETAIL_KWH_NZD = 0.32;             // residential/SME blended
export const EV_KWH_PER_KM = 0.18;                 // typical mid-size BEV

// ── Vehicle alternatives ────────────────────────────────────────────────────

export interface VehicleAlternative {
  segment: string;
  matchPatterns: RegExp;          // matches make+model (case-insensitive)
  alternative: {
    name: string;
    type: "BEV" | "PHEV" | "HEV";
    nzPriceNzd: number;           // approx 2026 driveaway, before Clean Car
    rangeKm?: number;
    emissionFactorKgPerKm: number; // BEV uses NZ grid; PHEV blended; HEV petrol
    note: string;
  };
}

export const VEHICLE_ALTERNATIVES: VehicleAlternative[] = [
  {
    segment: "Ute / light commercial",
    matchPatterns: /hilux|ranger|triton|navara|d-?max|amarok|bt-?50|colorado|frontier/i,
    alternative: {
      name: "BYD Shark 6 PHEV",
      type: "PHEV",
      nzPriceNzd: 69990,
      rangeKm: 100, // EV-only
      emissionFactorKgPerKm: 0.06,
      note: "100 km EV range covers most NZ ute duty cycles; petrol backup for towing/long trips. 1.5T tow rating.",
    },
  },
  {
    segment: "Mid SUV",
    matchPatterns: /rav4|cx-?5|cx-?60|x-?trail|outlander|forester|tiguan|tucson|sportage|cr-?v|qashqai|kuga/i,
    alternative: {
      name: "BYD Atto 3 (or Tesla Model Y RWD)",
      type: "BEV",
      nzPriceNzd: 49990,
      rangeKm: 420,
      emissionFactorKgPerKm: NZ_GRID_INTENSITY_KG_PER_KWH * EV_KWH_PER_KM,
      note: "Best-in-class BEV value for NZ SUV duty cycles. 7-yr battery warranty.",
    },
  },
  {
    segment: "Sedan / hatchback",
    matchPatterns: /corolla|yaris|civic|mazda\s*3|lancer|cerato|elantra|astra|focus|impreza|swift/i,
    alternative: {
      name: "MG4 BEV (or BYD Dolphin)",
      type: "BEV",
      nzPriceNzd: 39990,
      rangeKm: 435,
      emissionFactorKgPerKm: NZ_GRID_INTENSITY_KG_PER_KWH * EV_KWH_PER_KM,
      note: "Cheapest competent BEV in NZ. Suits commuting and urban delivery.",
    },
  },
  {
    segment: "Van / panel van",
    matchPatterns: /hiace|transit|sprinter|master|vivaro|crafter|daily|express|trafic/i,
    alternative: {
      name: "LDV eDeliver 9 BEV (or Ford E-Transit)",
      type: "BEV",
      nzPriceNzd: 89990,
      rangeKm: 280,
      emissionFactorKgPerKm: NZ_GRID_INTENSITY_KG_PER_KWH * 0.30,
      note: "Suits last-mile delivery routes under 200 km/day. Eligible for Clean Car commercial rebates.",
    },
  },
  {
    segment: "Large SUV / 7-seater",
    matchPatterns: /landcruiser|prado|patrol|pajero|santa\s*fe|sorento|kluger|highlander|pilot/i,
    alternative: {
      name: "Kia EV9 (or Hyundai Ioniq 9)",
      type: "BEV",
      nzPriceNzd: 109990,
      rangeKm: 505,
      emissionFactorKgPerKm: NZ_GRID_INTENSITY_KG_PER_KWH * 0.22,
      note: "7-seat BEV with 2.5T tow capacity — direct replacement for diesel large SUVs.",
    },
  },
];

/** Generic fallback if no segment matches — recommend a hybrid as a low-effort drop-in. */
export const VEHICLE_FALLBACK_HYBRID = {
  name: "Toyota Corolla Hybrid (or equivalent HEV)",
  type: "HEV" as const,
  nzPriceNzd: 38990,
  emissionFactorKgPerKm: 0.09,
  note: "If a BEV doesn't suit the duty cycle, a modern hybrid still cuts ~50% vs a comparable ICE.",
};

export function findVehicleAlternative(
  make: string | null,
  model: string | null,
): VehicleAlternative | null {
  const haystack = `${make ?? ""} ${model ?? ""}`.trim();
  if (!haystack) return null;
  return VEHICLE_ALTERNATIVES.find((alt) => alt.matchPatterns.test(haystack)) ?? null;
}

// ── Solar ────────────────────────────────────────────────────────────────────

/**
 * NZ solar PV economics (2026 SEANZ benchmarks).
 * Installed cost is roughly $1.65/W for a 6–10 kW commercial-grade install.
 * Annual yield in NZ averages ~1,400 kWh per kW installed (Auckland~1,300,
 * Christchurch~1,450, Tauranga~1,500). Self-consumption ratio assumed 70%
 * for typical SME load profile — over-export caps the practical system size.
 */
export const SOLAR_NZD_PER_W = 1.65;
export const SOLAR_KWH_PER_KW_PER_YEAR = 1400;
export const SOLAR_SELF_CONSUMPTION_RATIO = 0.70;
export const SOLAR_BUYBACK_NZD_PER_KWH = 0.10;

export function suggestSolarSystemKw(annualKwh: number): {
  kw: number;
  annualGenerationKwh: number;
  annualSelfUseKwh: number;
  annualExportKwh: number;
  capexNzd: number;
  annualSavingNzd: number;
  paybackYears: number;
  annualCo2eSavingKg: number;
} {
  // Right-size the system so self-consumed generation ~= 50% of consumption,
  // which is the NZ sweet spot for payback before buy-back rates dilute returns.
  const targetSelfUseKwh = annualKwh * 0.50;
  const kw = Math.max(
    5,
    Math.round(targetSelfUseKwh / (SOLAR_KWH_PER_KW_PER_YEAR * SOLAR_SELF_CONSUMPTION_RATIO)),
  );
  const annualGenerationKwh = kw * SOLAR_KWH_PER_KW_PER_YEAR;
  const annualSelfUseKwh = annualGenerationKwh * SOLAR_SELF_CONSUMPTION_RATIO;
  const annualExportKwh = annualGenerationKwh - annualSelfUseKwh;
  const capexNzd = kw * 1000 * SOLAR_NZD_PER_W;
  const annualSavingNzd =
    annualSelfUseKwh * NZ_RETAIL_KWH_NZD + annualExportKwh * SOLAR_BUYBACK_NZD_PER_KWH;
  const paybackYears = capexNzd / annualSavingNzd;
  // Carbon saving: only the self-consumed portion offsets grid; exported
  // electricity displaces grid for someone else (counted by supplier).
  const annualCo2eSavingKg = annualSelfUseKwh * NZ_GRID_INTENSITY_KG_PER_KWH;
  return {
    kw,
    annualGenerationKwh: Math.round(annualGenerationKwh),
    annualSelfUseKwh: Math.round(annualSelfUseKwh),
    annualExportKwh: Math.round(annualExportKwh),
    capexNzd: Math.round(capexNzd),
    annualSavingNzd: Math.round(annualSavingNzd),
    paybackYears: Math.round(paybackYears * 10) / 10,
    annualCo2eSavingKg: Math.round(annualCo2eSavingKg),
  };
}

// ── NZ certified renewable electricity suppliers ─────────────────────────────

export interface RenewableSupplier {
  name: string;
  certification: string;
  premiumNzdPerKwh: number;     // delta vs incumbent retail tariff
  note: string;
}

export const RENEWABLE_SUPPLIERS: RenewableSupplier[] = [
  {
    name: "Ecotricity",
    certification: "Toitū climate positive certified, 100% renewable",
    premiumNzdPerKwh: 0.0,
    note: "Genuine carboNZero supply. Often price-competitive with incumbent retailers in NZ.",
  },
  {
    name: "Meridian Energy",
    certification: "Certified 100% renewable generation",
    premiumNzdPerKwh: 0.0,
    note: "NZX-listed gentailer; commercial Energy-Online tariff includes renewable certification.",
  },
  {
    name: "Mercury",
    certification: "100% renewable generation (hydro + geothermal)",
    premiumNzdPerKwh: 0.0,
    note: "Suitable when contracts come up for renewal; bundle with EV charging plan for fleet sites.",
  },
];

// ── Building / operational improvements ──────────────────────────────────────

export interface BuildingMeasure {
  title: string;
  action: string;
  effort: "low" | "medium" | "high";
  /** Fraction of building electricity reduced, e.g. 0.15 = 15%. */
  electricityReductionPct: number;
  capexPerKw?: number;          // capex per kW of building load reduced
  paybackYears: number;
  note: string;
}

export const BUILDING_MEASURES: BuildingMeasure[] = [
  {
    title: "LED lighting retrofit",
    action: "Replace remaining fluorescent / halogen fittings with LED panels.",
    effort: "medium",
    electricityReductionPct: 0.12,
    paybackYears: 2.5,
    note: "Typical commercial retrofit pays back in 24–30 months from energy savings alone.",
  },
  {
    title: "HVAC schedule optimisation",
    action: "Add programmable thermostats and tighten weekend/after-hours setbacks.",
    effort: "low",
    electricityReductionPct: 0.08,
    paybackYears: 0.5,
    note: "Zero-capex change for most sites. Auditor-friendly: shows operational governance.",
  },
  {
    title: "Heat-pump hot water upgrade",
    action: "Replace electric resistance hot-water cylinders with heat-pump units.",
    effort: "high",
    electricityReductionPct: 0.10,
    paybackYears: 6,
    note: "EECA co-funding may be available for SMEs through the Business Energy Grants programme.",
  },
  {
    title: "Smart meter + sub-metering",
    action: "Install per-circuit sub-meters to identify waste and create accountability per team/site.",
    effort: "low",
    electricityReductionPct: 0.05,
    paybackYears: 1.0,
    note: "Sub-metered orgs cut energy use ~5–10% in year 1 just from visibility (EECA Building Energy End-Use Study).",
  },
];

// ── Operational / behavioural ─────────────────────────────────────────────────

export interface OperationalMeasure {
  title: string;
  action: string;
  effort: "low" | "medium" | "high";
  /** Fraction of fleet emissions reduced. */
  fleetReductionPct: number;
  paybackYears: number;
  note: string;
}

export const OPERATIONAL_MEASURES: OperationalMeasure[] = [
  {
    title: "Telematics-driven driver coaching",
    action: "Use existing GPS data to coach the bottom-quartile drivers on idling, harsh acceleration, and route choice.",
    effort: "low",
    fleetReductionPct: 0.07,
    paybackYears: 0.3,
    note: "EECA fleet trials show 5–10% fuel reduction within 6 months. Zero capex if telematics already deployed.",
  },
  {
    title: "Right-size the fleet",
    action: "Identify vehicles with <5,000 km/yr utilisation and consolidate or move to a pool / car-share model.",
    effort: "medium",
    fleetReductionPct: 0.06,
    paybackYears: 0.5,
    note: "Removing one underused vehicle eliminates its full emissions plus ~$8,000/yr in standing costs.",
  },
  {
    title: "Two remote-work days per week",
    action: "Establish a hybrid policy of 2 work-from-home days for office-based staff.",
    effort: "low",
    fleetReductionPct: 0.10,
    paybackYears: 0,
    note: "Cuts staff commuting Scope 3, supports Social pillar (wellbeing), and reduces office energy load.",
  },
];
