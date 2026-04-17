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

// ── Vehicle alternatives (multi-candidate, scored) ──────────────────────────
//
// For each segment we keep multiple NZ-available alternatives.  When a swap
// is recommended for a specific vehicle, the platform scores every candidate
// against that vehicle's actual duty cycle (annual km, current CO₂e/km,
// current litres/km) and surfaces the winner *plus* the runners-up with a
// transparent breakdown — so users (and auditors) can see WHY one option
// beat another.  All prices are NZ driveaway, April 2026.

export type VehicleType = "BEV" | "PHEV" | "HEV";

export interface VehicleCandidate {
  name: string;
  type: VehicleType;
  nzPriceNzd: number;
  rangeKmEV: number;             // EV-only range; 0 for HEV
  emissionFactorKgPerKm: number; // tank-to-wheel + grid as appropriate
  towKg: number;                 // braked tow rating
  payloadKg: number;
  availability: "available" | "preorder" | "limited";
  warrantyYears: number;
  note: string;
}

export interface VehicleSegment {
  segment: string;
  matchPatterns: RegExp;
  // Median real-world capability needed to do this segment's job in NZ.
  // Used to penalise candidates that fall short on suitability.
  segmentMinTowKg: number;
  segmentMinPayloadKg: number;
  segmentTypicalDailyKm: number;
  candidates: VehicleCandidate[];
}

const PHEV_PETROL_LITRES_PER_KM = 0.06; // 6 L/100km on petrol portion
const HEV_PETROL_LITRES_PER_KM = 0.045; // 4.5 L/100km, modern hybrid avg

export const VEHICLE_SEGMENTS: VehicleSegment[] = [
  {
    segment: "Ute / light commercial",
    matchPatterns: /hilux|ranger|triton|navara|d-?max|amarok|bt-?50|colorado|frontier/i,
    segmentMinTowKg: 2000,
    segmentMinPayloadKg: 700,
    segmentTypicalDailyKm: 80,
    candidates: [
      {
        name: "BYD Shark 6 PHEV",
        type: "PHEV",
        nzPriceNzd: 69990,
        rangeKmEV: 100,
        emissionFactorKgPerKm: 0.06,
        towKg: 2500,
        payloadKg: 790,
        availability: "available",
        warrantyYears: 6,
        note: "100 km EV range covers most NZ ute duty cycles; 1.85T petrol motor for towing/long trips. Best price-to-EV-range balance in segment.",
      },
      {
        name: "GWM Cannon Alpha PHEV",
        type: "PHEV",
        nzPriceNzd: 74990,
        rangeKmEV: 110,
        emissionFactorKgPerKm: 0.06,
        towKg: 3500,
        payloadKg: 685,
        availability: "available",
        warrantyYears: 7,
        note: "Full 3.5T tow rating with PHEV economy — strongest tow capacity of any plug-in ute in NZ. 7-yr warranty.",
      },
      {
        name: "Ford Ranger PHEV",
        type: "PHEV",
        nzPriceNzd: 84990,
        rangeKmEV: 49,
        emissionFactorKgPerKm: 0.13,
        towKg: 3500,
        payloadKg: 938,
        availability: "available",
        warrantyYears: 5,
        note: "Familiar Ranger platform with full 3.5T tow rating; shorter EV range means more petrol use in mixed-duty cycles.",
      },
      {
        name: "LDV eT60 BEV",
        type: "BEV",
        nzPriceNzd: 79990,
        rangeKmEV: 330,
        emissionFactorKgPerKm: NZ_GRID_INTENSITY_KG_PER_KWH * 0.28,
        towKg: 1000,
        payloadKg: 1000,
        availability: "available",
        warrantyYears: 5,
        note: "Pure BEV ute — lowest emissions and running cost, but only 1T tow rating restricts it to lighter-duty trades.",
      },
    ],
  },
  {
    segment: "Mid SUV",
    matchPatterns: /rav4|cx-?5|cx-?60|x-?trail|outlander|forester|tiguan|tucson|sportage|cr-?v|qashqai|kuga/i,
    segmentMinTowKg: 750,
    segmentMinPayloadKg: 400,
    segmentTypicalDailyKm: 60,
    candidates: [
      {
        name: "BYD Atto 3",
        type: "BEV",
        nzPriceNzd: 49990,
        rangeKmEV: 420,
        emissionFactorKgPerKm: NZ_GRID_INTENSITY_KG_PER_KWH * EV_KWH_PER_KM,
        towKg: 750,
        payloadKg: 408,
        availability: "available",
        warrantyYears: 6,
        note: "Best-priced competent mid-SUV BEV. 6-yr vehicle warranty, 8-yr battery.",
      },
      {
        name: "Tesla Model Y RWD",
        type: "BEV",
        nzPriceNzd: 63900,
        rangeKmEV: 466,
        emissionFactorKgPerKm: NZ_GRID_INTENSITY_KG_PER_KWH * EV_KWH_PER_KM,
        towKg: 1600,
        payloadKg: 489,
        availability: "available",
        warrantyYears: 4,
        note: "Best-selling BEV globally. Supercharger network, OTA updates, 1.6T tow rating useful for trailers.",
      },
      {
        name: "MG ZS EV Long Range",
        type: "BEV",
        nzPriceNzd: 44990,
        rangeKmEV: 440,
        emissionFactorKgPerKm: NZ_GRID_INTENSITY_KG_PER_KWH * EV_KWH_PER_KM,
        towKg: 500,
        payloadKg: 442,
        availability: "available",
        warrantyYears: 7,
        note: "Cheapest mid-SUV BEV with 400+ km range. 7-yr/unlimited km warranty leads the segment.",
      },
      {
        name: "Hyundai Kona Electric",
        type: "BEV",
        nzPriceNzd: 59990,
        rangeKmEV: 484,
        emissionFactorKgPerKm: NZ_GRID_INTENSITY_KG_PER_KWH * EV_KWH_PER_KM,
        towKg: 750,
        payloadKg: 374,
        availability: "available",
        warrantyYears: 5,
        note: "Established NZ dealer network and parts supply; longest range in the price band.",
      },
    ],
  },
  {
    segment: "Sedan / hatchback",
    matchPatterns: /corolla|yaris|civic|mazda\s*3|lancer|cerato|elantra|astra|focus|impreza|swift/i,
    segmentMinTowKg: 0,
    segmentMinPayloadKg: 350,
    segmentTypicalDailyKm: 50,
    candidates: [
      {
        name: "MG4 BEV",
        type: "BEV",
        nzPriceNzd: 39990,
        rangeKmEV: 435,
        emissionFactorKgPerKm: NZ_GRID_INTENSITY_KG_PER_KWH * EV_KWH_PER_KM,
        towKg: 500,
        payloadKg: 415,
        availability: "available",
        warrantyYears: 7,
        note: "Cheapest competent BEV in NZ. RWD, hatchback practicality, 7-yr warranty.",
      },
      {
        name: "BYD Dolphin",
        type: "BEV",
        nzPriceNzd: 39990,
        rangeKmEV: 340,
        emissionFactorKgPerKm: NZ_GRID_INTENSITY_KG_PER_KWH * EV_KWH_PER_KM,
        towKg: 0,
        payloadKg: 415,
        availability: "available",
        warrantyYears: 6,
        note: "Same price as MG4 with shorter range but better interior and BYD blade-battery safety.",
      },
      {
        name: "Tesla Model 3 RWD",
        type: "BEV",
        nzPriceNzd: 61900,
        rangeKmEV: 513,
        emissionFactorKgPerKm: NZ_GRID_INTENSITY_KG_PER_KWH * EV_KWH_PER_KM,
        towKg: 1000,
        payloadKg: 388,
        availability: "available",
        warrantyYears: 4,
        note: "Long range and Supercharger network, best resale value in segment.",
      },
      {
        name: "Toyota Corolla Hybrid",
        type: "HEV",
        nzPriceNzd: 38990,
        rangeKmEV: 0,
        emissionFactorKgPerKm: 0.09,
        towKg: 750,
        payloadKg: 470,
        availability: "available",
        warrantyYears: 5,
        note: "If charging access is a blocker, a modern hybrid still cuts ~50% vs the equivalent ICE — and Toyota's parts/service network is everywhere.",
      },
    ],
  },
  {
    segment: "Van / panel van",
    matchPatterns: /hiace|transit|sprinter|master|vivaro|crafter|daily|express|trafic/i,
    segmentMinTowKg: 750,
    segmentMinPayloadKg: 800,
    segmentTypicalDailyKm: 100,
    candidates: [
      {
        name: "LDV eDeliver 9",
        type: "BEV",
        nzPriceNzd: 89990,
        rangeKmEV: 280,
        emissionFactorKgPerKm: NZ_GRID_INTENSITY_KG_PER_KWH * 0.30,
        towKg: 1500,
        payloadKg: 1200,
        availability: "available",
        warrantyYears: 5,
        note: "1.2T payload + 1.5T tow makes this the most capable BEV van in NZ. Best for last-mile delivery <200 km/day.",
      },
      {
        name: "Maxus eDeliver 7",
        type: "BEV",
        nzPriceNzd: 79990,
        rangeKmEV: 350,
        emissionFactorKgPerKm: NZ_GRID_INTENSITY_KG_PER_KWH * 0.27,
        towKg: 1500,
        payloadKg: 990,
        availability: "available",
        warrantyYears: 5,
        note: "Mid-size van with longer range and lower price than eDeliver 9, but slightly less payload.",
      },
      {
        name: "Ford E-Transit",
        type: "BEV",
        nzPriceNzd: 99990,
        rangeKmEV: 317,
        emissionFactorKgPerKm: NZ_GRID_INTENSITY_KG_PER_KWH * 0.30,
        towKg: 750,
        payloadKg: 1616,
        availability: "available",
        warrantyYears: 5,
        note: "Highest payload (1.6T) of any NZ-available BEV van. Established Ford dealer/service support.",
      },
    ],
  },
  {
    segment: "Large SUV / 7-seater",
    matchPatterns: /landcruiser|prado|patrol|pajero|santa\s*fe|sorento|kluger|highlander|pilot/i,
    segmentMinTowKg: 2000,
    segmentMinPayloadKg: 450,
    segmentTypicalDailyKm: 70,
    candidates: [
      {
        name: "Kia EV9",
        type: "BEV",
        nzPriceNzd: 109990,
        rangeKmEV: 505,
        emissionFactorKgPerKm: NZ_GRID_INTENSITY_KG_PER_KWH * 0.22,
        towKg: 2500,
        payloadKg: 528,
        availability: "available",
        warrantyYears: 7,
        note: "7-seat BEV with 2.5T tow capacity — direct replacement for diesel large SUVs. 7-yr warranty.",
      },
      {
        name: "Hyundai Ioniq 9",
        type: "BEV",
        nzPriceNzd: 115990,
        rangeKmEV: 532,
        emissionFactorKgPerKm: NZ_GRID_INTENSITY_KG_PER_KWH * 0.22,
        towKg: 2540,
        payloadKg: 500,
        availability: "preorder",
        warrantyYears: 5,
        note: "Slightly longer range than EV9 with 2.54T tow. 2026 NZ launch — preorder only.",
      },
      {
        name: "BYD Sealion 6 DM-i PHEV",
        type: "PHEV",
        nzPriceNzd: 59990,
        rangeKmEV: 92,
        emissionFactorKgPerKm: 0.07,
        towKg: 1500,
        payloadKg: 535,
        availability: "available",
        warrantyYears: 6,
        note: "Cheapest plug-in option in segment, but tow rating drops to 1.5T — not a like-for-like replacement for a Land Cruiser-class tow vehicle.",
      },
    ],
  },
];

/** Generic fallback when no segment matches the make/model. */
const FALLBACK_SEGMENT: VehicleSegment = {
  segment: "General passenger",
  matchPatterns: /.*/,
  segmentMinTowKg: 0,
  segmentMinPayloadKg: 350,
  segmentTypicalDailyKm: 50,
  candidates: [
    {
      name: "Toyota Corolla Hybrid",
      type: "HEV",
      nzPriceNzd: 38990,
      rangeKmEV: 0,
      emissionFactorKgPerKm: 0.09,
      towKg: 750,
      payloadKg: 470,
      availability: "available",
      warrantyYears: 5,
      note: "Low-risk hybrid drop-in: ~50% emissions cut vs equivalent ICE, no charging dependency.",
    },
    {
      name: "MG4 BEV",
      type: "BEV",
      nzPriceNzd: 39990,
      rangeKmEV: 435,
      emissionFactorKgPerKm: NZ_GRID_INTENSITY_KG_PER_KWH * EV_KWH_PER_KM,
      towKg: 500,
      payloadKg: 415,
      availability: "available",
      warrantyYears: 7,
      note: "Cheapest competent BEV in NZ if you have charging access.",
    },
  ],
};

/** Back-compat shim: returns the segment's top candidate (ignores duty cycle). */
export const VEHICLE_FALLBACK_HYBRID = FALLBACK_SEGMENT.candidates[0];

export interface VehicleAlternative {
  segment: string;
  alternative: VehicleCandidate & { rangeKm?: number };
}

export function findVehicleAlternative(
  make: string | null,
  model: string | null,
): VehicleAlternative | null {
  const haystack = `${make ?? ""} ${model ?? ""}`.trim();
  if (!haystack) return null;
  const seg = VEHICLE_SEGMENTS.find((s) => s.matchPatterns.test(haystack));
  if (!seg) return null;
  return { segment: seg.segment, alternative: { ...seg.candidates[0], rangeKm: seg.candidates[0].rangeKmEV } };
}

// ── Scoring ─────────────────────────────────────────────────────────────────

export interface ScoredCandidate {
  name: string;
  type: VehicleType;
  nzPriceNzd: number;
  rangeKmEV: number;
  emissionFactorKgPerKm: number;
  towKg: number;
  payloadKg: number;
  availability: "available" | "preorder" | "limited";
  warrantyYears: number;
  note: string;
  // Computed for this duty cycle:
  score: number;                  // 0-100
  breakdown: {
    emissions: number;            // /40
    tco: number;                  // /30
    suitability: number;          // /20
    availability: number;         // /10
  };
  annualCo2eKg: number;
  annualCo2eSavingKg: number;
  annualRunningNzd: number;
  annualRunningSavingNzd: number;
  fiveYearTcoNzd: number;         // capex + 5yr running
  reasons: string[];              // human-readable pros/cons
}

export function rankVehicleAlternatives(opts: {
  make: string | null;
  model: string | null;
  kmYear: number;
  currentCo2eYearKg: number;
  currentLitresYear: number;
  currentFuelType: string | null;
}): { segment: VehicleSegment; ranked: ScoredCandidate[] } {
  const haystack = `${opts.make ?? ""} ${opts.model ?? ""}`.trim();
  const seg =
    VEHICLE_SEGMENTS.find((s) => s.matchPatterns.test(haystack)) ?? FALLBACK_SEGMENT;
  const fuelPrice =
    opts.currentFuelType === "diesel" ? DIESEL_NZD_PER_LITRE : PETROL_NZD_PER_LITRE;
  const currentRunningNzd = opts.currentLitresYear * fuelPrice;
  const baseline5yrRunning = currentRunningNzd * 5;

  const ranked: ScoredCandidate[] = seg.candidates.map((c) => {
    // Annual emissions and saving
    const annualCo2eKg = opts.kmYear * c.emissionFactorKgPerKm;
    const annualCo2eSavingKg = Math.max(0, opts.currentCo2eYearKg - annualCo2eKg);
    const co2eReductionPct =
      opts.currentCo2eYearKg > 0
        ? Math.max(0, Math.min(1, annualCo2eSavingKg / opts.currentCo2eYearKg))
        : 0;

    // Annual running cost
    let annualRunningNzd: number;
    if (c.type === "BEV") {
      annualRunningNzd = opts.kmYear * EV_KWH_PER_KM * NZ_RETAIL_KWH_NZD;
    } else if (c.type === "PHEV") {
      // EV-share of daily km: capped at 70% even if EV range exceeds typical day,
      // since mixed duty (towing, long trips) always pulls some petrol use.
      const evShare = Math.min(0.7, c.rangeKmEV / Math.max(seg.segmentTypicalDailyKm, 1));
      annualRunningNzd =
        opts.kmYear * evShare * EV_KWH_PER_KM * NZ_RETAIL_KWH_NZD +
        opts.kmYear * (1 - evShare) * PHEV_PETROL_LITRES_PER_KM * fuelPrice;
    } else {
      annualRunningNzd = opts.kmYear * HEV_PETROL_LITRES_PER_KM * fuelPrice;
    }
    const annualRunningSavingNzd = Math.max(0, currentRunningNzd - annualRunningNzd);
    const fiveYearTcoNzd = c.nzPriceNzd + annualRunningNzd * 5;

    // ── Score axes ────────────────────────────────────────────────────────
    // Emissions: linear 0-40 in % CO₂e cut
    const emissions = co2eReductionPct * 40;

    // TCO: ratio of (capex + 5yr running) vs just paying 5yr of current fuel.
    // ≤1.0 (cheaper than business-as-usual) = full marks; ≥2.5 = zero.
    let tco: number;
    if (baseline5yrRunning <= 0) {
      tco = 15; // No baseline data — neutral
    } else {
      const tcoRatio = fiveYearTcoNzd / baseline5yrRunning;
      if (tcoRatio <= 1) tco = 30;
      else if (tcoRatio >= 2.5) tco = 0;
      else tco = 30 * ((2.5 - tcoRatio) / 1.5);
    }

    // Suitability: penalise tow / payload / range shortfalls vs segment median
    let suitability = 20;
    const reasons: string[] = [];

    if (seg.segmentMinTowKg > 0) {
      const towShortfall = Math.max(0, seg.segmentMinTowKg - c.towKg);
      if (towShortfall > 0) {
        suitability -= Math.min(10, (towShortfall / seg.segmentMinTowKg) * 10);
        reasons.push(
          `Tow ${c.towKg.toLocaleString()} kg vs ${seg.segmentMinTowKg.toLocaleString()} kg typical for segment`,
        );
      }
    }
    if (seg.segmentMinPayloadKg > 0) {
      const payloadShortfall = Math.max(0, seg.segmentMinPayloadKg - c.payloadKg);
      if (payloadShortfall > 0) {
        suitability -= Math.min(5, (payloadShortfall / seg.segmentMinPayloadKg) * 5);
        reasons.push(
          `Payload ${c.payloadKg} kg vs ${seg.segmentMinPayloadKg} kg typical`,
        );
      }
    }
    if (c.type === "BEV") {
      const headroomKm = seg.segmentTypicalDailyKm * 1.5;
      if (c.rangeKmEV < headroomKm) {
        const rangePenalty = Math.min(5, ((headroomKm - c.rangeKmEV) / headroomKm) * 5);
        suitability -= rangePenalty;
        reasons.push(
          `BEV range ${c.rangeKmEV} km is tight for ${seg.segmentTypicalDailyKm} km/day duty (no petrol fallback)`,
        );
      }
    }
    suitability = Math.max(0, suitability);

    // Availability
    const availability =
      c.availability === "available" ? 10 : c.availability === "preorder" ? 5 : 3;
    if (c.availability !== "available") {
      reasons.push(
        c.availability === "preorder" ? "Preorder only — not on lots yet" : "Limited NZ supply",
      );
    }

    const score = Math.round(emissions + tco + suitability + availability);

    // Pros at the top of the reasons list
    if (annualCo2eSavingKg > 0) {
      reasons.unshift(`Cuts ${Math.round(co2eReductionPct * 100)}% of this vehicle's CO₂e`);
    }
    if (annualRunningSavingNzd > 0) {
      reasons.unshift(
        `Saves ~$${Math.round(annualRunningSavingNzd).toLocaleString()}/yr on fuel/energy`,
      );
    }

    return {
      name: c.name,
      type: c.type,
      nzPriceNzd: c.nzPriceNzd,
      rangeKmEV: c.rangeKmEV,
      emissionFactorKgPerKm: c.emissionFactorKgPerKm,
      towKg: c.towKg,
      payloadKg: c.payloadKg,
      availability: c.availability,
      warrantyYears: c.warrantyYears,
      note: c.note,
      score,
      breakdown: {
        emissions: Math.round(emissions),
        tco: Math.round(tco),
        suitability: Math.round(suitability),
        availability,
      },
      annualCo2eKg: Math.round(annualCo2eKg),
      annualCo2eSavingKg: Math.round(annualCo2eSavingKg),
      annualRunningNzd: Math.round(annualRunningNzd),
      annualRunningSavingNzd: Math.round(annualRunningSavingNzd),
      fiveYearTcoNzd: Math.round(fiveYearTcoNzd),
      reasons,
    };
  });

  ranked.sort((a, b) => b.score - a.score);
  return { segment: seg, ranked };
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
