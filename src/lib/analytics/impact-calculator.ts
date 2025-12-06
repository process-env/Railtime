/**
 * Impact Calculator
 *
 * Calculates economic and environmental impact metrics based on
 * actual subway usage data (trains in service, arrivals recorded).
 */

// ============================================================================
// Constants (with sources)
// ============================================================================

// Economic constants
export const SUBWAY_FARE = 2.90; // MTA single ride fare (2024)
export const AVG_UBER_FARE = 20.0; // NYC TLC average rideshare fare
export const AVG_TAXI_FARE = 17.0; // NYC TLC average taxi fare
export const AVG_DRIVING_COST = 30.0; // Parking ($15) + gas ($8) + tolls ($7) avg

// Ridership estimates per train
export const AVG_PASSENGERS_PER_TRAIN = 150; // Conservative estimate (rush hour can be 200+)

// Environmental constants (EPA data)
export const CO2_PER_CAR_MILE_GRAMS = 404; // EPA average passenger vehicle
export const CO2_PER_SUBWAY_MILE_GRAMS = 27; // MTA sustainability report
export const AVG_TRIP_MILES = 5; // Average NYC subway trip distance
export const CO2_PER_CAR_YEAR_KG = 4600; // Average car annual emissions
export const CO2_PER_TREE_YEAR_KG = 22; // Tree CO2 absorption per year

// ============================================================================
// Types
// ============================================================================

export interface EconomicImpact {
  totalSavings: number;
  vsUber: number;
  vsTaxi: number;
  vsDriving: number;
  avgSavingsPerTrip: number;
  estimatedRiders: number;
}

export interface EnvironmentalImpact {
  totalCO2SavedKg: number;
  totalCO2SavedTons: number;
  carsOffRoadEquivalent: number;
  treesPlantedEquivalent: number;
  co2SavedPerTrip: number;
}

export interface DelayDistribution {
  onTime: number; // <= 0 seconds delay
  slight: number; // 1-120 seconds (0-2 min)
  moderate: number; // 121-300 seconds (2-5 min)
  significant: number; // 301-600 seconds (5-10 min)
  severe: number; // > 600 seconds (10+ min)
  total: number;
  onTimePercentage: number;
}

export interface ImpactMetrics {
  economic: EconomicImpact;
  environmental: EnvironmentalImpact;
  delays: DelayDistribution | null;
}

// ============================================================================
// Calculation Functions
// ============================================================================

/**
 * Calculate economic impact from trains in service.
 * Uses trains × avg passengers per train to estimate ridership.
 *
 * @param totalTrainSnapshots - Number of train position snapshots recorded
 * @param uniqueTrips - Number of unique trips observed (optional, more accurate)
 */
export function calculateEconomicImpact(
  totalTrainSnapshots: number,
  uniqueTrips?: number
): EconomicImpact {
  // Use unique trips if available, otherwise estimate from snapshots
  // Snapshots are taken every ~30 seconds, so divide by expected snapshots per trip
  const estimatedRiders = uniqueTrips
    ? uniqueTrips * AVG_PASSENGERS_PER_TRAIN
    : Math.round((totalTrainSnapshots / 120) * AVG_PASSENGERS_PER_TRAIN); // ~120 snapshots per hour per train

  const vsUber = estimatedRiders * (AVG_UBER_FARE - SUBWAY_FARE);
  const vsTaxi = estimatedRiders * (AVG_TAXI_FARE - SUBWAY_FARE);
  const vsDriving = estimatedRiders * (AVG_DRIVING_COST - SUBWAY_FARE);

  // Use average of all alternatives
  const avgSavingsPerTrip = (AVG_UBER_FARE + AVG_TAXI_FARE + AVG_DRIVING_COST) / 3 - SUBWAY_FARE;
  const totalSavings = estimatedRiders * avgSavingsPerTrip;

  return {
    totalSavings,
    vsUber,
    vsTaxi,
    vsDriving,
    avgSavingsPerTrip: Math.round(avgSavingsPerTrip * 100) / 100,
    estimatedRiders,
  };
}

/**
 * Calculate environmental impact from ridership.
 *
 * @param estimatedRiders - Number of subway riders
 */
export function calculateEnvironmentalImpact(estimatedRiders: number): EnvironmentalImpact {
  const co2SavedPerTripGrams =
    (CO2_PER_CAR_MILE_GRAMS - CO2_PER_SUBWAY_MILE_GRAMS) * AVG_TRIP_MILES;
  const co2SavedPerTripKg = co2SavedPerTripGrams / 1000;

  const totalCO2SavedKg = estimatedRiders * co2SavedPerTripKg;
  const totalCO2SavedTons = totalCO2SavedKg / 1000;

  const carsOffRoadEquivalent = Math.round(totalCO2SavedKg / CO2_PER_CAR_YEAR_KG);
  const treesPlantedEquivalent = Math.round(totalCO2SavedKg / CO2_PER_TREE_YEAR_KG);

  return {
    totalCO2SavedKg: Math.round(totalCO2SavedKg),
    totalCO2SavedTons: Math.round(totalCO2SavedTons * 10) / 10,
    carsOffRoadEquivalent,
    treesPlantedEquivalent,
    co2SavedPerTrip: Math.round(co2SavedPerTripKg * 1000) / 1000,
  };
}

/**
 * Bucket delay values into distribution categories.
 *
 * @param delays - Array of delay values in seconds
 */
export function calculateDelayDistribution(delays: number[]): DelayDistribution {
  const distribution: DelayDistribution = {
    onTime: 0,
    slight: 0,
    moderate: 0,
    significant: 0,
    severe: 0,
    total: delays.length,
    onTimePercentage: 0,
  };

  for (const delay of delays) {
    if (delay <= 0) {
      distribution.onTime++;
    } else if (delay <= 120) {
      distribution.slight++;
    } else if (delay <= 300) {
      distribution.moderate++;
    } else if (delay <= 600) {
      distribution.significant++;
    } else {
      distribution.severe++;
    }
  }

  distribution.onTimePercentage =
    distribution.total > 0
      ? Math.round((distribution.onTime / distribution.total) * 1000) / 10
      : 0;

  return distribution;
}

/**
 * Convert delay distribution to chart-friendly format.
 */
export function delayDistributionToChartData(
  distribution: DelayDistribution
): Array<{ bucket: string; count: number }> {
  return [
    { bucket: 'on_time', count: distribution.onTime },
    { bucket: '0-2 min', count: distribution.slight },
    { bucket: '2-5 min', count: distribution.moderate },
    { bucket: '5-10 min', count: distribution.significant },
    { bucket: '10+ min', count: distribution.severe },
  ].filter((d) => d.count > 0);
}

/**
 * Calculate all impact metrics.
 *
 * @param totalSnapshots - Total train snapshots recorded
 * @param uniqueTrips - Unique trips observed (optional)
 * @param delays - Array of calculated delays in seconds (optional)
 */
export function calculateAllImpactMetrics(
  totalSnapshots: number,
  uniqueTrips?: number,
  delays?: number[]
): ImpactMetrics {
  const economic = calculateEconomicImpact(totalSnapshots, uniqueTrips);
  const environmental = calculateEnvironmentalImpact(economic.estimatedRiders);
  const delayDistribution = delays?.length ? calculateDelayDistribution(delays) : null;

  return {
    economic,
    environmental,
    delays: delayDistribution,
  };
}

/**
 * Format currency for display.
 */
export function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  } else if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(1)}K`;
  }
  return `$${amount.toFixed(2)}`;
}

/**
 * Format large numbers with commas.
 */
export function formatNumber(num: number): string {
  return num.toLocaleString();
}
