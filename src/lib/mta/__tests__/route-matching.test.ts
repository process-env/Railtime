import { describe, it, expect } from 'vitest';
import { buildRouteFilterSet, routeMatchesFilter, ROUTE_FAMILY } from '../route-matching';

describe('buildRouteFilterSet', () => {
  it('creates an empty set from empty array', () => {
    expect(buildRouteFilterSet([]).size).toBe(0);
  });

  it('uppercases all route IDs', () => {
    const set = buildRouteFilterSet(['a', 'b', '7']);
    expect(set.has('A')).toBe(true);
    expect(set.has('B')).toBe(true);
    expect(set.has('7')).toBe(true);
    expect(set.has('a')).toBe(false);
  });
});

describe('routeMatchesFilter', () => {
  it('returns true for empty filter set (show all)', () => {
    const filterSet = buildRouteFilterSet([]);
    expect(routeMatchesFilter('Q', filterSet)).toBe(true);
    expect(routeMatchesFilter('7X', filterSet)).toBe(true);
  });

  it('matches exact route', () => {
    const filterSet = buildRouteFilterSet(['2']);
    expect(routeMatchesFilter('2', filterSet)).toBe(true);
  });

  it('rejects non-matching route', () => {
    const filterSet = buildRouteFilterSet(['2']);
    expect(routeMatchesFilter('Q', filterSet)).toBe(false);
    expect(routeMatchesFilter('W', filterSet)).toBe(false);
    expect(routeMatchesFilter('M', filterSet)).toBe(false);
  });

  it('matches express variant 5X when filter is 5', () => {
    const filterSet = buildRouteFilterSet(['5']);
    expect(routeMatchesFilter('5X', filterSet)).toBe(true);
    expect(routeMatchesFilter('5', filterSet)).toBe(true);
  });

  it('matches express variant 7X when filter is 7', () => {
    const filterSet = buildRouteFilterSet(['7']);
    expect(routeMatchesFilter('7X', filterSet)).toBe(true);
  });

  it('matches FX express when filter is F', () => {
    const filterSet = buildRouteFilterSet(['F']);
    expect(routeMatchesFilter('FX', filterSet)).toBe(true);
    expect(routeMatchesFilter('F', filterSet)).toBe(true);
  });

  it('matches shuttle aliases GS and FS when filter is S', () => {
    const filterSet = buildRouteFilterSet(['S']);
    expect(routeMatchesFilter('GS', filterSet)).toBe(true);
    expect(routeMatchesFilter('FS', filterSet)).toBe(true);
    expect(routeMatchesFilter('S', filterSet)).toBe(true);
  });

  it('matches SIR when filter is SI', () => {
    const filterSet = buildRouteFilterSet(['SI']);
    expect(routeMatchesFilter('SIR', filterSet)).toBe(true);
    expect(routeMatchesFilter('SI', filterSet)).toBe(true);
  });

  it('is case-insensitive for routeId input', () => {
    const filterSet = buildRouteFilterSet(['A']);
    expect(routeMatchesFilter('a', filterSet)).toBe(true);
    expect(routeMatchesFilter('A', filterSet)).toBe(true);
  });

  it('handles multiple routes in filter', () => {
    const filterSet = buildRouteFilterSet(['2', '5', 'A']);
    expect(routeMatchesFilter('2', filterSet)).toBe(true);
    expect(routeMatchesFilter('5', filterSet)).toBe(true);
    expect(routeMatchesFilter('5X', filterSet)).toBe(true);
    expect(routeMatchesFilter('A', filterSet)).toBe(true);
    expect(routeMatchesFilter('Q', filterSet)).toBe(false);
  });
});

describe('ROUTE_FAMILY', () => {
  it('maps all expected express variants', () => {
    expect(ROUTE_FAMILY['5X']).toBe('5');
    expect(ROUTE_FAMILY['6X']).toBe('6');
    expect(ROUTE_FAMILY['7X']).toBe('7');
    expect(ROUTE_FAMILY['FX']).toBe('F');
    expect(ROUTE_FAMILY['GS']).toBe('S');
    expect(ROUTE_FAMILY['FS']).toBe('S');
    expect(ROUTE_FAMILY['SIR']).toBe('SI');
  });
});
