/**
 * Tests for the impact calculator module.
 *
 * Verifies economic impact, environmental impact, delay distribution,
 * formatting helpers, and the combined metrics aggregator.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateEconomicImpact,
  calculateEnvironmentalImpact,
  calculateDelayDistribution,
  delayDistributionToChartData,
  calculateAllImpactMetrics,
  calculateImpactFromRidership,
  formatCurrency,
  formatNumber,
  SUBWAY_FARE,
  AVG_UBER_FARE,
  AVG_TAXI_FARE,
  AVG_DRIVING_COST,
  AVG_PASSENGERS_PER_TRAIN,
  CO2_PER_CAR_MILE_GRAMS,
  CO2_PER_SUBWAY_MILE_GRAMS,
  AVG_TRIP_MILES,
  CO2_PER_CAR_YEAR_KG,
  CO2_PER_TREE_YEAR_KG,
} from '../impact-calculator';

// Pre-computed constant used across multiple test suites
const CO2_SAVED_PER_TRIP_KG =
  ((CO2_PER_CAR_MILE_GRAMS - CO2_PER_SUBWAY_MILE_GRAMS) * AVG_TRIP_MILES) / 1000; // 1.885

const AVG_SAVINGS_PER_TRIP =
  (AVG_UBER_FARE + AVG_TAXI_FARE + AVG_DRIVING_COST) / 3 - SUBWAY_FARE;

// ---------------------------------------------------------------------------
// calculateEconomicImpact
// ---------------------------------------------------------------------------
describe('calculateEconomicImpact', () => {
  it('estimates riders from uniqueTrips when provided', () => {
    const result = calculateEconomicImpact(999, 100);
    // uniqueTrips takes priority over totalTrainSnapshots
    expect(result.estimatedRiders).toBe(100 * AVG_PASSENGERS_PER_TRAIN); // 15 000
  });

  it('calculates vsUber correctly', () => {
    const result = calculateEconomicImpact(0, 100);
    const expectedVsUber = 15_000 * (AVG_UBER_FARE - SUBWAY_FARE);
    expect(result.vsUber).toBeCloseTo(expectedVsUber, 2);
  });

  it('calculates vsTaxi correctly', () => {
    const result = calculateEconomicImpact(0, 100);
    const expectedVsTaxi = 15_000 * (AVG_TAXI_FARE - SUBWAY_FARE);
    expect(result.vsTaxi).toBeCloseTo(expectedVsTaxi, 2);
  });

  it('calculates vsDriving correctly', () => {
    const result = calculateEconomicImpact(0, 100);
    const expectedVsDriving = 15_000 * (AVG_DRIVING_COST - SUBWAY_FARE);
    expect(result.vsDriving).toBeCloseTo(expectedVsDriving, 2);
  });

  it('returns positive totalSavings for non-zero input', () => {
    const result = calculateEconomicImpact(0, 100);
    expect(result.totalSavings).toBeGreaterThan(0);
  });

  it('computes totalSavings as riders * avgSavingsPerTrip', () => {
    const result = calculateEconomicImpact(0, 100);
    const expected = 15_000 * AVG_SAVINGS_PER_TRIP;
    expect(result.totalSavings).toBeCloseTo(expected, 2);
  });

  it('rounds avgSavingsPerTrip to 2 decimal places', () => {
    const result = calculateEconomicImpact(0, 100);
    const decimals = result.avgSavingsPerTrip.toString().split('.')[1] ?? '';
    expect(decimals.length).toBeLessThanOrEqual(2);
  });

  it('returns all zeros when totalTrainSnapshots is 0 and no uniqueTrips', () => {
    const result = calculateEconomicImpact(0);
    expect(result.estimatedRiders).toBe(0);
    expect(result.vsUber).toBe(0);
    expect(result.vsTaxi).toBe(0);
    expect(result.vsDriving).toBe(0);
    expect(result.totalSavings).toBe(0);
  });

  it('falls back to snapshot-based estimation when uniqueTrips is omitted', () => {
    const snapshots = 12_000;
    const result = calculateEconomicImpact(snapshots);
    // Formula: Math.round((snapshots / 120) * AVG_PASSENGERS_PER_TRAIN)
    const expected = Math.round((snapshots / 120) * AVG_PASSENGERS_PER_TRAIN);
    expect(result.estimatedRiders).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// calculateEnvironmentalImpact
// ---------------------------------------------------------------------------
describe('calculateEnvironmentalImpact', () => {
  it('computes totalCO2SavedKg for a known rider count', () => {
    const riders = 1000;
    const result = calculateEnvironmentalImpact(riders);
    expect(result.totalCO2SavedKg).toBe(Math.round(riders * CO2_SAVED_PER_TRIP_KG));
  });

  it('returns co2SavedPerTrip matching the constant derivation', () => {
    const result = calculateEnvironmentalImpact(1);
    expect(result.co2SavedPerTrip).toBeCloseTo(CO2_SAVED_PER_TRIP_KG, 3);
  });

  it('computes totalCO2SavedTons as kg / 1000 rounded to 1 decimal', () => {
    const riders = 10_000;
    const result = calculateEnvironmentalImpact(riders);
    const expectedTons =
      Math.round((riders * CO2_SAVED_PER_TRIP_KG) / 1000 * 10) / 10;
    expect(result.totalCO2SavedTons).toBe(expectedTons);
  });

  it('returns reasonable carsOffRoadEquivalent', () => {
    const riders = 100_000;
    const result = calculateEnvironmentalImpact(riders);
    const expectedCars = Math.round((riders * CO2_SAVED_PER_TRIP_KG) / CO2_PER_CAR_YEAR_KG);
    expect(result.carsOffRoadEquivalent).toBe(expectedCars);
    expect(result.carsOffRoadEquivalent).toBeGreaterThan(0);
  });

  it('returns reasonable treesPlantedEquivalent', () => {
    const riders = 100_000;
    const result = calculateEnvironmentalImpact(riders);
    const expectedTrees = Math.round((riders * CO2_SAVED_PER_TRIP_KG) / CO2_PER_TREE_YEAR_KG);
    expect(result.treesPlantedEquivalent).toBe(expectedTrees);
    expect(result.treesPlantedEquivalent).toBeGreaterThan(0);
  });

  it('returns all zeros when riders is 0', () => {
    const result = calculateEnvironmentalImpact(0);
    expect(result.totalCO2SavedKg).toBe(0);
    expect(result.totalCO2SavedTons).toBe(0);
    expect(result.carsOffRoadEquivalent).toBe(0);
    expect(result.treesPlantedEquivalent).toBe(0);
    expect(result.co2SavedPerTrip).toBeCloseTo(CO2_SAVED_PER_TRIP_KG, 3);
  });
});

// ---------------------------------------------------------------------------
// calculateImpactFromRidership
// ---------------------------------------------------------------------------
describe('calculateImpactFromRidership', () => {
  const DAILY_RIDERSHIP = 4_000_000;

  it('returns both economic and environmental fields', () => {
    const result = calculateImpactFromRidership(DAILY_RIDERSHIP);
    expect(result).toHaveProperty('economic');
    expect(result).toHaveProperty('environmental');
  });

  it('sets estimatedRiders to the input value directly', () => {
    const result = calculateImpactFromRidership(DAILY_RIDERSHIP);
    expect(result.economic.estimatedRiders).toBe(DAILY_RIDERSHIP);
  });

  it('computes environmental CO2 from the direct ridership count', () => {
    const result = calculateImpactFromRidership(DAILY_RIDERSHIP);
    expect(result.environmental.totalCO2SavedKg).toBe(
      Math.round(DAILY_RIDERSHIP * CO2_SAVED_PER_TRIP_KG),
    );
  });

  it('computes economic vsUber from the direct ridership count', () => {
    const result = calculateImpactFromRidership(DAILY_RIDERSHIP);
    expect(result.economic.vsUber).toBeCloseTo(
      DAILY_RIDERSHIP * (AVG_UBER_FARE - SUBWAY_FARE),
      2,
    );
  });

  it('returns zero-based results when dailyRidership is 0', () => {
    const result = calculateImpactFromRidership(0);
    expect(result.economic.totalSavings).toBe(0);
    expect(result.economic.estimatedRiders).toBe(0);
    expect(result.environmental.totalCO2SavedKg).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateDelayDistribution
// ---------------------------------------------------------------------------
describe('calculateDelayDistribution', () => {
  it('buckets known delay values correctly', () => {
    //           onTime   slight  moderate  significant  severe
    const delays = [0, 60, 180, 400, 800];
    const result = calculateDelayDistribution(delays);

    expect(result.onTime).toBe(1);
    expect(result.slight).toBe(1);
    expect(result.moderate).toBe(1);
    expect(result.significant).toBe(1);
    expect(result.severe).toBe(1);
    expect(result.total).toBe(5);
  });

  it('returns all zeros for an empty array', () => {
    const result = calculateDelayDistribution([]);
    expect(result.onTime).toBe(0);
    expect(result.slight).toBe(0);
    expect(result.moderate).toBe(0);
    expect(result.significant).toBe(0);
    expect(result.severe).toBe(0);
    expect(result.total).toBe(0);
    expect(result.onTimePercentage).toBe(0);
  });

  it('calculates onTimePercentage correctly', () => {
    // 3 on-time out of 5 => 60%
    const delays = [0, -10, -5, 100, 200];
    const result = calculateDelayDistribution(delays);
    expect(result.onTime).toBe(3);
    expect(result.onTimePercentage).toBe(60);
  });

  it('handles boundary values for each bucket', () => {
    const delays = [
      0,    // onTime   (<= 0)
      120,  // slight   (<= 120)
      121,  // moderate (121-300)
      300,  // moderate (<= 300)
      301,  // significant (301-600)
      600,  // significant (<= 600)
      601,  // severe   (> 600)
    ];
    const result = calculateDelayDistribution(delays);
    expect(result.onTime).toBe(1);
    expect(result.slight).toBe(1);
    expect(result.moderate).toBe(2);
    expect(result.significant).toBe(2);
    expect(result.severe).toBe(1);
  });

  it('treats negative delays as on-time', () => {
    const delays = [-30, -1, 0];
    const result = calculateDelayDistribution(delays);
    expect(result.onTime).toBe(3);
    expect(result.onTimePercentage).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// delayDistributionToChartData
// ---------------------------------------------------------------------------
describe('delayDistributionToChartData', () => {
  it('converts distribution to chart-friendly objects', () => {
    const dist = calculateDelayDistribution([0, 60, 180, 400, 800]);
    const chart = delayDistributionToChartData(dist);

    expect(chart).toHaveLength(5);
    expect(chart[0]).toEqual({ bucket: 'on_time', count: 1 });
    expect(chart[1]).toEqual({ bucket: '0-2 min', count: 1 });
  });

  it('filters out buckets with zero count', () => {
    const dist = calculateDelayDistribution([0, 0, 0]);
    const chart = delayDistributionToChartData(dist);

    expect(chart).toHaveLength(1);
    expect(chart[0].bucket).toBe('on_time');
    expect(chart[0].count).toBe(3);
  });

  it('returns empty array when all counts are zero', () => {
    const dist = calculateDelayDistribution([]);
    const chart = delayDistributionToChartData(dist);
    expect(chart).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// formatCurrency
// ---------------------------------------------------------------------------
describe('formatCurrency', () => {
  it('formats millions with M suffix', () => {
    expect(formatCurrency(1_500_000)).toBe('$1.5M');
  });

  it('formats thousands with K suffix', () => {
    expect(formatCurrency(1234)).toBe('$1.2K');
  });

  it('formats small amounts with 2 decimal places', () => {
    expect(formatCurrency(99.99)).toBe('$99.99');
  });

  it('formats exactly 1000 with K suffix', () => {
    expect(formatCurrency(1000)).toBe('$1.0K');
  });

  it('formats exactly 1_000_000 with M suffix', () => {
    expect(formatCurrency(1_000_000)).toBe('$1.0M');
  });

  it('formats zero as $0.00', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });
});

// ---------------------------------------------------------------------------
// formatNumber
// ---------------------------------------------------------------------------
describe('formatNumber', () => {
  it('returns a string', () => {
    expect(typeof formatNumber(1234567)).toBe('string');
  });

  it('formats zero', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('formats a large number with locale separators', () => {
    const formatted = formatNumber(1_234_567);
    // The exact separator depends on locale, but the digits must be present
    expect(formatted.replace(/\D/g, '')).toBe('1234567');
  });
});

// ---------------------------------------------------------------------------
// calculateAllImpactMetrics
// ---------------------------------------------------------------------------
describe('calculateAllImpactMetrics', () => {
  it('combines economic and environmental metrics', () => {
    const result = calculateAllImpactMetrics(12_000, 100);
    expect(result.economic).toBeDefined();
    expect(result.environmental).toBeDefined();
    // economic uses uniqueTrips
    expect(result.economic.estimatedRiders).toBe(100 * AVG_PASSENGERS_PER_TRAIN);
  });

  it('passes estimated riders from economic into environmental', () => {
    const result = calculateAllImpactMetrics(0, 50);
    const expectedRiders = 50 * AVG_PASSENGERS_PER_TRAIN;
    expect(result.economic.estimatedRiders).toBe(expectedRiders);
    expect(result.environmental.totalCO2SavedKg).toBe(
      Math.round(expectedRiders * CO2_SAVED_PER_TRIP_KG),
    );
  });

  it('returns null for delays when no delays array is provided', () => {
    const result = calculateAllImpactMetrics(1000);
    expect(result.delays).toBeNull();
  });

  it('returns null for delays when an empty delays array is provided', () => {
    const result = calculateAllImpactMetrics(1000, undefined, []);
    expect(result.delays).toBeNull();
  });

  it('includes delay distribution when delays are provided', () => {
    const delays = [0, 60, 300];
    const result = calculateAllImpactMetrics(1000, undefined, delays);
    expect(result.delays).not.toBeNull();
    expect(result.delays!.total).toBe(3);
    expect(result.delays!.onTime).toBe(1);
  });
});
