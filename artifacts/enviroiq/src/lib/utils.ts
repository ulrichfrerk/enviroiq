import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a CO₂e value smartly:
 *  • ≥ 1 000 kg  → "X.X t"  (tonnes, 1–2 dp)
 *  •  < 1 000 kg → "X.X kg" (kilograms, 1 dp)
 *  • null/undefined → "—"
 */
export function fmtCo2e(kg: number | null | undefined): string {
  if (kg == null || isNaN(kg)) return "—";
  if (kg >= 1000) {
    const t = kg / 1000;
    const dp = t >= 100 ? 1 : t >= 10 ? 2 : 2;
    return `${t.toLocaleString("en-NZ", { minimumFractionDigits: dp, maximumFractionDigits: dp })} t`;
  }
  return `${kg.toLocaleString("en-NZ", { maximumFractionDigits: 1 })} kg`;
}

/** Return the unit label that fmtCo2e would use for a given kg value */
export function co2eUnit(kg: number | null | undefined): string {
  if (kg == null || kg < 1000) return "kg";
  return "t";
}
