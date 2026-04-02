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

const NZ_ELECTRICITY_PROVIDERS = [
  "Contact Energy", "Contact",
  "Mercury", "Mercury Energy",
  "Genesis Energy", "Genesis",
  "Meridian Energy", "Meridian",
  "Vector", "Vector Metering",
  "Powerco",
  "Nova Energy", "Nova",
  "Ecotricity",
  "Trustpower",
  "Electric Kiwi",
  "Flick Electric", "Flick",
  "Frank Energy", "Frank",
  "Octopus Energy", "Octopus",
  "Pulse Energy", "Pulse",
  "King Country Energy",
  "Network Tasman",
  "Orion",
  "Unison",
  "Horizon Energy",
  "Aurora Energy",
  "Alpine Energy",
  "Westpower",
];

const NZ_GAS_PROVIDERS = [
  "Contact Energy", "Contact",
  "Genesis Energy", "Genesis",
  "Nova Energy", "Nova",
  "Rockgas",
  "Elgas",
  "Todd Energy",
  "Greymouth Gas",
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
];

function detectUtilityType(text: string): { type: "electricity" | "gas" | "water"; confidence: number } {
  const t = text.toLowerCase();

  const waterKeywords = ["water", "wastewater", "sewerage", "watercare", "cubic metre", "m³", "kl ", "kilolitre"];
  const gasKeywords = ["natural gas", "reticulated gas", "lpg", "gas usage", "gas supply", "mj ", "megajoule", "gas meter"];
  const electricityKeywords = ["electricity", "electric", "kwh", "kilowatt", "power supply", "energy usage", "grid", "peak", "off-peak", "anytime", "night rate"];

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
      ? NZ_GAS_PROVIDERS
      : NZ_ELECTRICITY_PROVIDERS;

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
  str = str.trim();

  // "1 January 2026" or "01 Jan 2026"
  const longMatch = str.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (longMatch) {
    const day = parseInt(longMatch[1]);
    const month = NZ_MONTHS[longMatch[2].toLowerCase()];
    const year = parseInt(longMatch[3]);
    if (month !== undefined) return new Date(year, month, day);
  }

  // "January 2026" or "Jan 2026" — treat as 1st of month
  const monthYearMatch = str.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monthYearMatch) {
    const month = NZ_MONTHS[monthYearMatch[1].toLowerCase()];
    const year = parseInt(monthYearMatch[2]);
    if (month !== undefined) return new Date(year, month, 1);
  }

  // "01/01/2026" or "01-01-2026"
  const numericMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
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

const SEP = /\s*(?:to|–|—|-|through)\s*/i;
const DATE_FULL  = /\d{1,2}\s+[A-Za-z]+\s+\d{4}/;  // "1 January 2026"
const DATE_SHORT = /\d{1,2}\s+[A-Za-z]+/;           // "1 Jan" (no year)
const DATE_NUM   = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/;
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
    // Both dates fully qualified: "1 January 2026 to 31 January 2026"
    new RegExp(`(${DATE_FULL.source})${SEP.source}(${DATE_FULL.source})`, "i"),
    // Short start + full end: "1 Jan – 31 Jan 2026" (Contact Energy style)
    new RegExp(`(${DATE_SHORT.source})${SEP.source}(${DATE_FULL.source})`, "i"),
    // Numeric NZ: "01/02/2026 – 28/02/2026"
    new RegExp(`(${DATE_NUM.source})${SEP.source}(${DATE_NUM.source})`),
    // ISO: "2026-01-01 to 2026-01-31"
    new RegExp(`(${DATE_ISO.source})${SEP.source}(${DATE_ISO.source})`),
  ];

  // Optionally preceded by a billing-period label
  const LABEL = /(?:bill(?:ing)?\s+period|invoice\s+period|service\s+period|your\s+(?:bill|usage)\s+(?:covers?|from)|period)[:\s]*/i;

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
    // Priority patterns for NZ electricity bills
    const patterns = [
      /total\s+(?:electricity\s+)?(?:usage|consumption|units)[^\d]*(\d[\d,]*(?:\.\d+)?)\s*kWh/i,
      /(?:energy|electricity)\s+used[^\d]*(\d[\d,]*(?:\.\d+)?)\s*kWh/i,
      /(\d[\d,]*(?:\.\d+)?)\s*kWh\s+(?:used|consumed|total)/i,
      /(\d[\d,]*(?:\.\d+)?)\s*kWh/i,
      /kWh[^\d]*(\d[\d,]*(?:\.\d+)?)/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ""));
        if (val > 0 && val < 1_000_000) return { usageKwh: val };
      }
    }
  } else if (utilityType === "gas") {
    const patterns = [
      /total\s+(?:gas\s+)?(?:usage|consumption)[^\d]*(\d[\d,]*(?:\.\d+)?)\s*MJ/i,
      /(\d[\d,]*(?:\.\d+)?)\s*MJ/i,
      /MJ[^\d]*(\d[\d,]*(?:\.\d+)?)/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) {
        const mj = parseFloat(m[1].replace(/,/g, ""));
        if (mj > 0 && mj < 10_000_000) return { usageMj: mj, usageKwh: mj / 3.6 };
      }
    }
    // Some gas bills show kWh
    const kwhM = text.match(/(\d[\d,]*(?:\.\d+)?)\s*kWh/i);
    if (kwhM) {
      const val = parseFloat(kwhM[1].replace(/,/g, ""));
      if (val > 0) return { usageKwh: val };
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
  // NZ bills: "Total Amount Due $123.45" or "Amount Due: $123.45"
  const patterns = [
    /(?:total\s+amount\s+due|amount\s+due|total\s+due|pay\s+this\s+amount)[^\d$]*\$\s*(\d[\d,]*(?:\.\d+)?)/i,
    /(?:total\s+payable|please\s+pay)[^\d$]*\$\s*(\d[\d,]*(?:\.\d+)?)/i,
    /\$\s*(\d[\d,]*\.\d{2})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ""));
      if (val > 0 && val < 100_000) return val;
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
