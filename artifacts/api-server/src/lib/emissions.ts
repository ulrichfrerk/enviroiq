// Standard emission factors
export const EMISSION_FACTORS = {
  // kg CO2e per litre of fuel
  petrol: 2.31,
  diesel: 2.68,
  lpg: 1.51,
  // kg CO2e per kWh (NZ grid average)
  electricity: 0.0977,
  // kg CO2e per MJ of natural gas
  gas: 0.0535,
};

export function calcFleetCo2e({
  fuelType,
  distanceKm,
  fuelLitres,
  emissionFactorKgPerKm,
}: {
  fuelType: string;
  distanceKm?: number;
  fuelLitres?: number;
  emissionFactorKgPerKm?: number;
}): number {
  if (fuelType === "electric") return 0;
  if (fuelLitres && fuelType in EMISSION_FACTORS) {
    return fuelLitres * EMISSION_FACTORS[fuelType as keyof typeof EMISSION_FACTORS];
  }
  if (distanceKm) {
    const factor = emissionFactorKgPerKm ?? defaultEmissionFactor(fuelType);
    return distanceKm * factor;
  }
  return 0;
}

function defaultEmissionFactor(fuelType: string): number {
  const defaults: Record<string, number> = {
    petrol: 0.196,
    diesel: 0.214,
    hybrid: 0.12,
    lpg: 0.16,
    hydrogen: 0.005,
    other: 0.2,
  };
  return defaults[fuelType] ?? 0.2;
}

export function calcEnergyCo2e({
  utilityType,
  usageKwh,
  usageMj,
}: {
  utilityType: string;
  usageKwh?: number;
  usageMj?: number;
}): number {
  if (utilityType === "electricity" && usageKwh) {
    return usageKwh * EMISSION_FACTORS.electricity;
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
