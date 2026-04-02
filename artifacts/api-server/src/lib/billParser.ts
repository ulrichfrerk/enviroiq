export interface ParsedBill {
  utilityType: "electricity" | "gas" | "water";
  provider?: string;
  periodStart?: Date;
  periodEnd?: Date;
  usageKwh?: number;
  usageMj?: number;
  costAmount?: number;
  confidence: number;
  reviewFlags: string[];
}

// Providers sorted longest-first within each group so the most-specific name wins.
const NZ_ELECTRICITY_PROVIDERS = [
  // NZ — specific before short aliases
  "Contact Energy", "Genesis Energy", "Mercury Energy", "Meridian Energy",
  "Vector Metering", "King Country Energy", "Horizon Energy", "Aurora Energy",
  "Alpine Energy", "Nova Energy", "Electric Kiwi", "Flick Electric",
  "Frank Energy", "Octopus Energy", "Pulse Energy", "Network Tasman",
  "Ecotricity", "Trustpower", "Powerco", "Unison", "Westpower", "Orion",
  "Contact", "Genesis", "Mercury", "Meridian", "Vector", "Nova", "Flick", "Frank", "Octopus", "Pulse",
];

const AU_ELECTRICITY_PROVIDERS = [
  "EnergyAustralia", "Origin Energy", "AGL Energy",
  "Ergon Energy", "Energex", "Essential Energy", "ActewAGL",
  "Aurora Energy Tasmania", "Powershop", "Amber Electric",
  "OVO Energy Australia", "Alinta Energy", "Red Energy", "Lumo Energy",
  "Dodo Power and Gas", "Simply Energy", "Momentum Energy", "Powerdirect",
  "AGL", "Origin", "Ergon", "Alinta",
];

const UK_ELECTRICITY_PROVIDERS = [
  "British Gas", "EDF Energy", "E.ON Energy", "OVO Energy", "Octopus Energy",
  "Scottish Power", "Scottish and Southern Energy", "Shell Energy",
  "So Energy", "Bulb Energy",
  "EDF", "E.ON", "SSE", "npower", "Bulb",
];

const US_ELECTRICITY_PROVIDERS = [
  "Pacific Gas and Electric", "Consolidated Edison", "Con Edison",
  "Duke Energy", "Dominion Energy", "National Grid", "Southern California Edison",
  "Florida Power and Light", "Florida Power & Light", "Xcel Energy",
  "PG&E", "SCE", "FPL",
];

const ALL_ELECTRICITY_PROVIDERS = [
  ...NZ_ELECTRICITY_PROVIDERS,
  ...AU_ELECTRICITY_PROVIDERS,
  ...UK_ELECTRICITY_PROVIDERS,
  ...US_ELECTRICITY_PROVIDERS,
];

const ALL_GAS_PROVIDERS = [
  // NZ
  "Contact Energy", "Genesis Energy", "Nova Energy",
  "Rockgas", "Elgas", "Todd Energy", "Greymouth Gas",
  "Contact", "Genesis", "Nova",
  // AU
  "Origin Energy", "AGL Energy", "Alinta Energy", "Kleenheat", "Supagas", "Elgas Australia",
  "AGL", "Origin", "Alinta",
  // UK
  "British Gas", "EDF Energy", "E.ON Energy", "OVO Energy", "Octopus Energy",
  "EDF", "E.ON",
  // US
  "National Grid", "Dominion Energy", "Xcel Energy",
];

const NZ_WATER_PROVIDERS = [
  "Watercare",
  "Wellington Water",
  "Christchurch City Council",
  "Dunedin City Council",
  "Hamilton City Council",
  "Tauranga City Council",
  "Palmerston North City Council",
  "Napier City Council",
  "Hastings District Council",
  "Nelson City Council",
  "New Plymouth District Council",
  "Far North District Council",
  "Water New Zealand",
  // AU
  "Sydney Water", "Melbourne Water", "Yarra Valley Water", "South East Water",
  "Western Water", "Icon Water", "Unity Water",
  // UK
  "Thames Water", "Anglian Water", "Severn Trent", "Yorkshire Water",
];

function detectUtilityType(text: string): { type: "electricity" | "gas" | "water"; confidence: number } {
  const t = text.toLowerCase();

  const waterKeywords = ["water", "wastewater", "sewerage", "watercare", "cubic metre", "m³", "kl ", "kilolitre", "water usage", "water supply"];
  const gasKeywords = ["natural gas", "reticulated gas", "lpg", "gas usage", "gas supply", "mj ", "megajoule", "gas meter", "therms", " ccf", " mcf", " gj ", "gigajoule", "gas charge", "gas bill"];
  const electricityKeywords = ["electricity", "electric", "kwh", "kilowatt", "power supply", "energy usage", "grid", "peak", "off-peak", "anytime", "night rate", "mwh", "megawatt", "units used", "meter reading", "icp number"];

  const waterScore  = waterKeywords.filter(k => t.includes(k)).length;
  const gasScore    = gasKeywords.filter(k => t.includes(k)).length;
  const elecScore   = electricityKeywords.filter(k => t.includes(k)).length;

  if (waterScore > gasScore && waterScore > elecScore) return { type: "water", confidence: Math.min(waterScore / 3, 1) };
  if (gasScore > elecScore) return { type: "gas", confidence: Math.min(gasScore / 3, 1) };

  return { type: "electricity", confidence: Math.min(Math.max(elecScore / 3, 0.4), 1) };
}

function detectProvider(text: string, utilityType: "electricity" | "gas" | "water"): string | undefined {
  const providers =
    utilityType === "water"
      ? NZ_WATER_PROVIDERS
      : utilityType === "gas"
      ? ALL_GAS_PROVIDERS
      : ALL_ELECTRICITY_PROVIDERS;

  for (const provider of providers) {
    const escaped = provider.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) {
      return provider;
    }
  }
  return undefined;
}

const NZ_MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7,
  sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseNZDate(str: string): Date | undefined {
  str = str.trim().replace(/(\d+)(?:st|nd|rd|th)\b/g, "$1"); // strip ordinals: "1st" → "1"

  // "1 January 2026" or "01 Jan 2026" (4-digit year)
  const longMatch = str.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (longMatch) {
    const day = parseInt(longMatch[1]);
    const month = NZ_MONTHS[longMatch[2].toLowerCase()];
    const year = parseInt(longMatch[3]);
    if (month !== undefined) return new Date(year, month, day);
  }

  // "28 Jun 25" — 2-digit year (Contact Energy table style)
  const long2Match = str.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{2})$/);
  if (long2Match) {
    const day = parseInt(long2Match[1]);
    const month = NZ_MONTHS[long2Match[2].toLowerCase()];
    let year = parseInt(long2Match[3]);
    if (year >= 0 && year <= 99) year += 2000;
    if (month !== undefined) return new Date(year, month, day);
  }

  // US format: "January 1, 2026" or "Jan 1, 2026"
  const usMatch = str.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (usMatch) {
    const month = NZ_MONTHS[usMatch[1].toLowerCase()];
    const day = parseInt(usMatch[2]);
    const year = parseInt(usMatch[3]);
    if (month !== undefined) return new Date(year, month, day);
  }

  // "January 2026" or "Jan 2026" — treat as 1st of month
  const monthYearMatch = str.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monthYearMatch) {
    const month = NZ_MONTHS[monthYearMatch[1].toLowerCase()];
    const year = parseInt(monthYearMatch[2]);
    if (month !== undefined) return new Date(year, month, 1);
  }

  // "01/01/2026", "01-01-2026", or "01.01.2026" (European)
  const numericMatch = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (numericMatch) {
    const day = parseInt(numericMatch[1]);
    const month = parseInt(numericMatch[2]) - 1;
    let year = parseInt(numericMatch[3]);
    if (year < 100) year += 2000;
    return new Date(year, month, day);
  }

  // ISO "2026-01-01"
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
  }

  return undefined;
}

// "bis" = German/Dutch "to"; "au" = French "to"; add alongside English variants
const SEP = /\s*(?:to|bis|au|–|—|-|through)\s*/i;
// Digit may carry an ordinal suffix: "1st", "2nd", "31st"
const ORD = /(?:st|nd|rd|th)?/;
const DATE_FULL  = new RegExp(`\\d{1,2}${ORD.source}\\s+[A-Za-z]+\\s+\\d{4}`);  // "1st January 2026" or "01 Jan 2026"
const DATE_FULL2 = new RegExp(`\\d{1,2}${ORD.source}\\s+[A-Za-z]+\\s+\\d{2}`);  // "28 Jun 25" (2-digit year)
const DATE_SHORT = new RegExp(`\\d{1,2}${ORD.source}\\s+[A-Za-z]+`);            // "1 Jan" (no year)
const DATE_US    = /[A-Za-z]+\s+\d{1,2},?\s+\d{4}/;                             // "January 1, 2026"
const DATE_NUM   = /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/;                     // "01/01/26" or "01.01.2026"
const DATE_ISO   = /\d{4}-\d{2}-\d{2}/;

/**
 * Given two raw date strings where the second may be missing a year,
 * try to inherit the year from the other string.
 */
function parseDatePair(a: string, b: string): { periodStart?: Date; periodEnd?: Date } {
  // If b has no year, try appending the year from a
  const yearMatch = a.match(/\b(20\d{2})\b/) ?? b.match(/\b(20\d{2})\b/);
  const aFull = a.includes("20") ? a : yearMatch ? `${a} ${yearMatch[1]}` : a;
  const bFull = b.includes("20") ? b : yearMatch ? `${b} ${yearMatch[1]}` : b;
  const periodStart = parseNZDate(aFull);
  const periodEnd   = parseNZDate(bFull);
  if (periodStart && periodEnd && !isNaN(periodStart.getTime()) && !isNaN(periodEnd.getTime())) {
    return { periodStart, periodEnd };
  }
  return {};
}

function detectBillingPeriod(text: string): { periodStart?: Date; periodEnd?: Date } {
  // --- Primary: explicit date ranges ---
  // Covers formats like:
  //   "1 January 2026 to 31 January 2026"
  //   "1 Jan – 31 Jan 2026"       (year only at end — Contact Energy style)
  //   "01/02/2026 – 28/02/2026"
  //   "2026-01-01 to 2026-01-31"
  const rangePatterns: RegExp[] = [
    // Both dates fully qualified: "1 January 2026 to 31 January 2026" (with optional ordinals)
    new RegExp(`(${DATE_FULL.source})${SEP.source}(${DATE_FULL.source})`, "i"),
    // US format: "January 1, 2026 to January 31, 2026"
    new RegExp(`(${DATE_US.source})${SEP.source}(${DATE_US.source})`, "i"),
    // Short start + full end: "1 Jan – 31 Jan 2026" (Contact Energy style)
    new RegExp(`(${DATE_SHORT.source})${SEP.source}(${DATE_FULL.source})`, "i"),
    // Both dates with 2-digit year: "28 Jun 25 to 28 Jul 25" (Contact Energy table style)
    new RegExp(`(${DATE_FULL2.source})${SEP.source}(${DATE_FULL2.source})`, "i"),
    // Mixed: "28 Jun 25" to "28 Jul 2025"
    new RegExp(`(${DATE_FULL2.source})${SEP.source}(${DATE_FULL.source})`, "i"),
    // Numeric NZ/EU: "01/02/2026 – 28/02/2026" or "01.02.26 to 28.02.26"
    new RegExp(`(${DATE_NUM.source})${SEP.source}(${DATE_NUM.source})`),
    // ISO: "2026-01-01 to 2026-01-31"
    new RegExp(`(${DATE_ISO.source})${SEP.source}(${DATE_ISO.source})`),
  ];

  // Optionally preceded by a billing-period label (NZ, AU, UK, US variants)
  const LABEL = /(?:bill(?:ing)?\s+period|invoice\s+period|service\s+period|supply\s+period|read\s+period|energy\s+period|usage\s+period|your\s+(?:bill|usage)\s+(?:covers?|from|for)|period\s+from|from\s+period|covers?\s+the\s+\d+\s+day\s+period\s+from|for\s+the\s+period)[:\s]*/i;

  for (const pattern of rangePatterns) {
    // Try with label prefix first
    const labelledSrc = new RegExp(LABEL.source + pattern.source, "i");
    for (const re of [labelledSrc, pattern]) {
      const m = text.match(re);
      if (m) {
        const result = parseDatePair(m[1].trim(), m[2].trim());
        if (result.periodStart && result.periodEnd) return result;
      }
    }
  }

  // --- Fallback: collect all Month YYYY mentions, prefer the billing period ---
  // Bills typically mention the billing month earliest; the issue/due date comes later.
  // We pick the OLDEST (earliest) month mention as the billing period.
  const monthYearPattern = /\b([A-Za-z]+)\s+(20\d{2})\b/g;
  const mentions: Date[] = [];
  let m: RegExpExecArray | null;
  while ((m = monthYearPattern.exec(text)) !== null) {
    const month = NZ_MONTHS[m[1].toLowerCase()];
    if (month !== undefined) {
      mentions.push(new Date(parseInt(m[2]), month, 1));
    }
  }
  if (mentions.length > 0) {
    // Use OLDEST date — billing periods appear before issue/due dates in NZ bills
    mentions.sort((a, b) => a.getTime() - b.getTime());
    const d = mentions[0];
    const periodStart = new Date(d.getFullYear(), d.getMonth(), 1);
    const periodEnd   = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { periodStart, periodEnd };
  }

  return {};
}

function detectUsage(text: string, utilityType: "electricity" | "gas" | "water"): { usageKwh?: number; usageMj?: number } {
  if (utilityType === "electricity") {
    // --- High-confidence patterns (explicit labels or units) ---
    const priorityPatterns = [
      // "Total electricity usage 1,234 kWh" or "Total units 1,234 kWh"
      /total\s+(?:electricity\s+)?(?:usage|consumption|units)[^\d]*(\d[\d,]*(?:\.\d+)?)\s*kWh/i,
      // "electricity/energy used 1,234 kWh"
      /(?:energy|electricity)\s+used[^\d]*(\d[\d,]*(?:\.\d+)?)\s*kWh/i,
      // "1,234 kWh used/consumed/total"
      /(\d[\d,]*(?:\.\d+)?)\s*kWh\s+(?:used|consumed|total)/i,
      // "Units used: 1,234" or "Units Used 1,234"
      /units?\s+used[:\s]+(\d[\d,]*(?:\.\d+)?)/i,
    ];
    for (const p of priorityPatterns) {
      const m = text.match(p);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ""));
        if (val > 0 && val < 1_000_000) return { usageKwh: val };
      }
    }

    // Genesis/Meridian style: "8,220 @ 27.93 c/unit" per rate tier in charge table.
    // Multi-rate bills (Anytime + Night) have multiple lines — SUM all tiers.
    // c/day and c/month lines don't contain "c/unit" so they're excluded.
    const cUnitMatches = [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*@\s*[\d.]+\s*c\/unit/gi)];
    if (cUnitMatches.length > 0) {
      const total = cUnitMatches
        .map(m => parseFloat(m[1].replace(/,/g, "")))
        .filter(v => v > 0 && v < 1_000_000)
        .reduce((a, b) => a + b, 0);
      if (total > 0) return { usageKwh: total };
    }

    // --- Fallback: collect ALL "NNN kWh" values and take the largest ---
    // Chart Y-axis tick marks (e.g. "228 kWh" per-day scale) are always smaller
    // than the monthly total, so the largest value is almost always the real usage.
    const allKwhMatches = [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*kWh/gi)];
    if (allKwhMatches.length > 0) {
      const vals = allKwhMatches
        .map(m => parseFloat(m[1].replace(/,/g, "")))
        .filter(v => v > 0 && v < 1_000_000);
      if (vals.length > 0) return { usageKwh: Math.max(...vals) };
    }

    // MWh detection (large commercial / AU / EU) — convert to kWh
    const mwhPatterns = [
      /total\s+(?:electricity\s+)?(?:usage|consumption)[^\d]*(\d[\d,]*(?:\.\d+)?)\s*MWh/i,
      /(\d[\d,]*(?:\.\d+)?)\s*MWh\s+(?:used|consumed|total)/i,
      /(\d[\d,]*(?:\.\d+)?)\s*MWh/i,
    ];
    for (const p of mwhPatterns) {
      const m = text.match(p);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, "")) * 1000; // MWh → kWh
        if (val > 0 && val < 100_000_000) return { usageKwh: val };
      }
    }

    // UK-style: "NNN units @ RATE p/unit" (pence per unit)
    const pUnitMatches = [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*@\s*[\d.]+\s*p\/unit/gi)];
    if (pUnitMatches.length > 0) {
      const total = pUnitMatches.map(m => parseFloat(m[1].replace(/,/g, ""))).filter(v => v > 0 && v < 1_000_000).reduce((a, b) => a + b, 0);
      if (total > 0) return { usageKwh: total };
    }

    // "kWh NNN" (label before number — some European formats)
    const kwhBefore = text.match(/kWh[^\d]*(\d[\d,]*(?:\.\d+)?)/i);
    if (kwhBefore) {
      const val = parseFloat(kwhBefore[1].replace(/,/g, ""));
      if (val > 0 && val < 1_000_000) return { usageKwh: val };
    }
  } else if (utilityType === "gas") {
    // MJ (NZ standard, AU sometimes)
    const mjPatterns = [
      /total\s+(?:gas\s+)?(?:usage|consumption)[^\d]*(\d[\d,]*(?:\.\d+)?)\s*MJ/i,
      /gas\s+used[^\d]*(\d[\d,]*(?:\.\d+)?)\s*MJ/i,
      /(\d[\d,]*(?:\.\d+)?)\s*MJ\s+(?:used|consumed|total)/i,
      /(\d[\d,]*(?:\.\d+)?)\s*MJ/i,
    ];
    for (const p of mjPatterns) {
      const m = text.match(p);
      if (m) {
        const mj = parseFloat(m[1].replace(/,/g, ""));
        if (mj > 0 && mj < 10_000_000) return { usageMj: mj, usageKwh: Math.round(mj / 3.6) };
      }
    }

    // GJ (gigajoule — large commercial NZ, AU)
    const gjPatterns = [
      /total\s+(?:gas\s+)?(?:usage|consumption)[^\d]*(\d[\d,]*(?:\.\d+)?)\s*GJ/i,
      /(\d[\d,]*(?:\.\d+)?)\s*GJ\s+(?:used|consumed|total)/i,
      /(\d[\d,]*(?:\.\d+)?)\s*GJ/i,
    ];
    for (const p of gjPatterns) {
      const m = text.match(p);
      if (m) {
        const gj = parseFloat(m[1].replace(/,/g, ""));
        if (gj > 0 && gj < 100_000) {
          const mj = gj * 1000;
          return { usageMj: mj, usageKwh: Math.round(mj / 3.6) };
        }
      }
    }

    // Therms or CCF (US, UK — 1 therm ≈ 29.3 kWh, 1 CCF ≈ 29.3 kWh)
    const thermPatterns = [
      [/(\d[\d,]*(?:\.\d+)?)\s*therms?/i, 29.3],
      [/(\d[\d,]*(?:\.\d+)?)\s*CCF/i, 29.3],
      [/(\d[\d,]*(?:\.\d+)?)\s*MCF/i, 293],
    ] as [RegExp, number][];
    for (const [p, factor] of thermPatterns) {
      const m = text.match(p);
      if (m) {
        const qty = parseFloat(m[1].replace(/,/g, ""));
        if (qty > 0 && qty < 100_000) {
          const kwh = Math.round(qty * factor);
          const mj = Math.round(kwh * 3.6);
          return { usageMj: mj, usageKwh: kwh };
        }
      }
    }

    // Some gas bills (AU, UK) show kWh directly
    const kwhGasPatterns = [
      /total\s+(?:gas\s+)?(?:usage|consumption)[^\d]*(\d[\d,]*(?:\.\d+)?)\s*kWh/i,
      /gas\s+used[^\d]*(\d[\d,]*(?:\.\d+)?)\s*kWh/i,
      /(\d[\d,]*(?:\.\d+)?)\s*kWh/i,
    ];
    for (const p of kwhGasPatterns) {
      const m = text.match(p);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ""));
        if (val > 0 && val < 1_000_000) return { usageKwh: val };
      }
    }
  } else if (utilityType === "water") {
    // Water uses kL (kilolitres) or m³
    const patterns = [
      /(\d[\d,]*(?:\.\d+)?)\s*(?:kL|kilolitres?|m³|cubic\s+metres?)/i,
      /usage[^\d]*(\d[\d,]*(?:\.\d+)?)\s*(?:kL|m³)/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) {
        const kl = parseFloat(m[1].replace(/,/g, ""));
        if (kl > 0 && kl < 1_000_000) {
          // Store kL in usageKwh field for water (no kWh equivalent, but reuse for tracking)
          return { usageKwh: kl };
        }
      }
    }
  }

  return {};
}

function detectCost(text: string): number | undefined {
  // Currency symbol: $, £, €, A$, NZ$
  const CUR = /(?:NZ\$|A\$|\$|£|€)\s*/;
  const NUM = /(\d[\d,]*(?:\.\d+)?)/;
  const patterns = [
    // "Total amount due $123.45" / "Amount owing £45.67" / "Total due €99.00"
    new RegExp(`(?:total\\s+amount\\s+due|amount\\s+(?:due|owing)|total\\s+due|pay\\s+this\\s+amount)[^\\d$£€]*${CUR.source}${NUM.source}`, "i"),
    // "Total payable / please pay"
    new RegExp(`(?:total\\s+payable|please\\s+pay|total\\s+charges|amount\\s+payable)[^\\d$£€]*${CUR.source}${NUM.source}`, "i"),
    // Bare currency + 2 decimal places (most reliable catch-all for NZ/AU $)
    /(?:NZ\$|A\$|\$)\s*(\d[\d,]*\.\d{2})/,
    // £ or € for UK/EU
    /[£€]\s*(\d[\d,]*\.\d{2})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ""));
      if (val > 0 && val < 1_000_000) return val;
    }
  }
  return undefined;
}

export function parseBillText(text: string): ParsedBill {
  const reviewFlags: string[] = [];

  const { type: utilityType, confidence: utConf } = detectUtilityType(text);
  if (utConf < 0.4) reviewFlags.push("Utility type uncertain — defaulted to electricity");

  const provider = detectProvider(text, utilityType);
  if (!provider) reviewFlags.push("Provider not recognised");

  const { periodStart, periodEnd } = detectBillingPeriod(text);
  if (!periodStart || !periodEnd) {
    reviewFlags.push("Billing period not detected — defaulted to last month");
  }

  const { usageKwh, usageMj } = detectUsage(text, utilityType);
  if (!usageKwh && !usageMj) reviewFlags.push("Usage (kWh/MJ) not found — CO₂e will be zero");

  const costAmount = detectCost(text);

  // Confidence: start at 1.0 and subtract for each missing field
  let confidence = 1.0;
  if (utConf < 0.4) confidence -= 0.2;
  if (!provider) confidence -= 0.1;
  if (!periodStart) confidence -= 0.25;
  if (!usageKwh && !usageMj) confidence -= 0.35;
  if (!costAmount) confidence -= 0.1;
  confidence = Math.max(0.05, confidence);

  return {
    utilityType,
    provider,
    periodStart,
    periodEnd,
    usageKwh,
    usageMj,
    costAmount,
    confidence,
    reviewFlags,
  };
}
