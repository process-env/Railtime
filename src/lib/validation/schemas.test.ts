import { describe, it, expect } from 'vitest';
import {
  hoursParamSchema,
  daysParamSchema,
  limitParamSchema,
  booleanParamSchema,
  routeIdSchema,
  routeFilterSchema,
  stopIdSchema,
  stationIdSchema,
  feedGroupIdSchema,
  searchQuerySchema,
  validate,
  parseQueryParams,
  historicalQuerySchema,
  collectQuerySchema,
  stopsQuerySchema,
} from './schemas';
import { z } from 'zod';

describe('validation schemas', () => {
  describe('hoursParamSchema', () => {
    it('accepts valid hours', () => {
      expect(hoursParamSchema.safeParse('24').data).toBe(24);
      expect(hoursParamSchema.safeParse('1').data).toBe(1);
      expect(hoursParamSchema.safeParse('168').data).toBe(168);
    });

    it('coerces string to number', () => {
      expect(hoursParamSchema.safeParse('24').data).toBe(24);
    });

    it('defaults to 24', () => {
      expect(hoursParamSchema.safeParse(undefined).data).toBe(24);
    });

    it('rejects hours below 1', () => {
      const result = hoursParamSchema.safeParse('0');
      expect(result.success).toBe(false);
    });

    it('rejects hours above 168', () => {
      const result = hoursParamSchema.safeParse('169');
      expect(result.success).toBe(false);
    });

    it('rejects non-integers', () => {
      const result = hoursParamSchema.safeParse('24.5');
      expect(result.success).toBe(false);
    });
  });

  describe('daysParamSchema', () => {
    it('accepts valid days', () => {
      expect(daysParamSchema.safeParse('30').data).toBe(30);
      expect(daysParamSchema.safeParse('1').data).toBe(1);
      expect(daysParamSchema.safeParse('365').data).toBe(365);
    });

    it('defaults to 30', () => {
      expect(daysParamSchema.safeParse(undefined).data).toBe(30);
    });

    it('rejects days below 1', () => {
      const result = daysParamSchema.safeParse('0');
      expect(result.success).toBe(false);
    });

    it('rejects days above 365', () => {
      const result = daysParamSchema.safeParse('366');
      expect(result.success).toBe(false);
    });
  });

  describe('limitParamSchema', () => {
    it('accepts valid limits', () => {
      expect(limitParamSchema.safeParse('100').data).toBe(100);
      expect(limitParamSchema.safeParse('1').data).toBe(1);
      expect(limitParamSchema.safeParse('2000').data).toBe(2000);
    });

    it('defaults to 100', () => {
      expect(limitParamSchema.safeParse(undefined).data).toBe(100);
    });

    it('rejects limits below 1', () => {
      const result = limitParamSchema.safeParse('0');
      expect(result.success).toBe(false);
    });

    it('rejects limits above 2000', () => {
      const result = limitParamSchema.safeParse('2001');
      expect(result.success).toBe(false);
    });
  });

  describe('booleanParamSchema', () => {
    it('parses "true" to true', () => {
      expect(booleanParamSchema.safeParse('true').data).toBe(true);
    });

    it('parses "false" to false', () => {
      expect(booleanParamSchema.safeParse('false').data).toBe(false);
    });

    it('parses null to false', () => {
      expect(booleanParamSchema.safeParse(null).data).toBe(false);
    });

    it('parses other strings to false', () => {
      expect(booleanParamSchema.safeParse('yes').data).toBe(false);
      expect(booleanParamSchema.safeParse('1').data).toBe(false);
      expect(booleanParamSchema.safeParse('').data).toBe(false);
    });
  });

  describe('routeIdSchema', () => {
    it('accepts single letter routes', () => {
      expect(routeIdSchema.safeParse('A').success).toBe(true);
      expect(routeIdSchema.safeParse('B').success).toBe(true);
      expect(routeIdSchema.safeParse('L').success).toBe(true);
    });

    it('accepts single number routes', () => {
      expect(routeIdSchema.safeParse('1').success).toBe(true);
      expect(routeIdSchema.safeParse('7').success).toBe(true);
    });

    it('accepts two-letter routes', () => {
      expect(routeIdSchema.safeParse('FS').success).toBe(true);
      expect(routeIdSchema.safeParse('SI').success).toBe(true);
    });

    it('accepts mixed alphanumeric routes', () => {
      expect(routeIdSchema.safeParse('SIR').success).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(routeIdSchema.safeParse('a').success).toBe(true);
      expect(routeIdSchema.safeParse('fs').success).toBe(true);
    });

    it('rejects empty string', () => {
      expect(routeIdSchema.safeParse('').success).toBe(false);
    });

    it('rejects routes longer than 3 chars', () => {
      expect(routeIdSchema.safeParse('ABCD').success).toBe(false);
    });

    it('rejects special characters', () => {
      expect(routeIdSchema.safeParse('A-1').success).toBe(false);
      expect(routeIdSchema.safeParse('A_B').success).toBe(false);
    });
  });

  describe('routeFilterSchema', () => {
    it('parses single route', () => {
      expect(routeFilterSchema.safeParse('A').data).toEqual(['A']);
    });

    it('parses comma-separated routes', () => {
      expect(routeFilterSchema.safeParse('A,C,E').data).toEqual(['A', 'C', 'E']);
    });

    it('trims whitespace', () => {
      expect(routeFilterSchema.safeParse('A, C, E').data).toEqual(['A', 'C', 'E']);
    });

    it('uppercases routes', () => {
      expect(routeFilterSchema.safeParse('a,b,c').data).toEqual(['A', 'B', 'C']);
    });

    it('rejects invalid routes in list', () => {
      const result = routeFilterSchema.safeParse('A,INVALID,C');
      expect(result.success).toBe(false);
    });
  });

  describe('stopIdSchema', () => {
    it('accepts numeric stop IDs', () => {
      expect(stopIdSchema.safeParse('101').success).toBe(true);
      expect(stopIdSchema.safeParse('123456').success).toBe(true);
    });

    it('accepts stop IDs with N suffix', () => {
      expect(stopIdSchema.safeParse('101N').success).toBe(true);
    });

    it('accepts stop IDs with S suffix', () => {
      expect(stopIdSchema.safeParse('101S').success).toBe(true);
    });

    it('accepts alphanumeric stop IDs', () => {
      expect(stopIdSchema.safeParse('A32').success).toBe(true);
      expect(stopIdSchema.safeParse('A32N').success).toBe(true);
    });

    it('rejects empty string', () => {
      expect(stopIdSchema.safeParse('').success).toBe(false);
    });

    it('rejects too long stop IDs', () => {
      expect(stopIdSchema.safeParse('12345678901').success).toBe(false);
    });

    it('rejects invalid characters', () => {
      expect(stopIdSchema.safeParse('101-N').success).toBe(false);
    });
  });

  describe('stationIdSchema', () => {
    it('accepts numeric station IDs', () => {
      expect(stationIdSchema.safeParse('101').success).toBe(true);
      expect(stationIdSchema.safeParse('123').success).toBe(true);
    });

    it('accepts letter-prefixed station IDs', () => {
      expect(stationIdSchema.safeParse('A32').success).toBe(true);
      expect(stationIdSchema.safeParse('R11').success).toBe(true);
    });

    it('rejects empty string', () => {
      expect(stationIdSchema.safeParse('').success).toBe(false);
    });

    it('rejects too long station IDs', () => {
      expect(stationIdSchema.safeParse('12345678901').success).toBe(false);
    });

    it('rejects suffixed station IDs', () => {
      expect(stationIdSchema.safeParse('101N').success).toBe(false);
    });
  });

  describe('feedGroupIdSchema', () => {
    it('accepts valid feed group IDs', () => {
      expect(feedGroupIdSchema.safeParse('ACE').success).toBe(true);
      expect(feedGroupIdSchema.safeParse('BDFM').success).toBe(true);
      expect(feedGroupIdSchema.safeParse('G').success).toBe(true);
      expect(feedGroupIdSchema.safeParse('JZ').success).toBe(true);
      expect(feedGroupIdSchema.safeParse('NQRW').success).toBe(true);
      expect(feedGroupIdSchema.safeParse('L').success).toBe(true);
      expect(feedGroupIdSchema.safeParse('SI').success).toBe(true);
      expect(feedGroupIdSchema.safeParse('1234567').success).toBe(true);
    });

    it('rejects invalid feed group IDs', () => {
      expect(feedGroupIdSchema.safeParse('ABC').success).toBe(false);
      expect(feedGroupIdSchema.safeParse('ace').success).toBe(false);
      expect(feedGroupIdSchema.safeParse('').success).toBe(false);
    });
  });

  describe('searchQuerySchema', () => {
    it('accepts valid search queries', () => {
      expect(searchQuerySchema.safeParse('Times Square').data).toBe('Times Square');
    });

    it('trims whitespace', () => {
      expect(searchQuerySchema.safeParse('  Times Square  ').data).toBe('Times Square');
    });

    it('returns undefined for undefined', () => {
      expect(searchQuerySchema.safeParse(undefined).data).toBeUndefined();
    });

    it('rejects queries over 100 chars', () => {
      const longQuery = 'a'.repeat(101);
      expect(searchQuerySchema.safeParse(longQuery).success).toBe(false);
    });
  });

  describe('validate helper', () => {
    it('returns success for valid data', () => {
      const result = validate(hoursParamSchema, '24');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(24);
      }
    });

    it('returns error for invalid data', () => {
      const result = validate(hoursParamSchema, '0');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('at least 1');
      }
    });

    it('joins multiple errors', () => {
      const schema = z.object({
        a: z.number().min(1),
        b: z.number().min(1),
      });
      const result = validate(schema, { a: 0, b: 0 });
      expect(result.success).toBe(false);
    });
  });

  describe('parseQueryParams helper', () => {
    it('parses valid query params', () => {
      const searchParams = new URLSearchParams('hours=24');
      const result = parseQueryParams(searchParams, historicalQuerySchema);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hours).toBe(24);
      }
    });

    it('uses defaults for missing params', () => {
      const searchParams = new URLSearchParams('');
      const result = parseQueryParams(searchParams, historicalQuerySchema);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hours).toBe(24);
      }
    });

    it('returns error for invalid params', () => {
      const searchParams = new URLSearchParams('hours=0');
      const result = parseQueryParams(searchParams, historicalQuerySchema);
      expect(result.success).toBe(false);
    });
  });

  describe('composite schemas', () => {
    describe('historicalQuerySchema', () => {
      it('validates hours param', () => {
        const result = historicalQuerySchema.safeParse({ hours: 48 });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.hours).toBe(48);
        }
      });
    });

    describe('collectQuerySchema', () => {
      it('validates cleanup and days params', () => {
        // Note: booleanParamSchema expects string input ('true'/'false')
        const result = collectQuerySchema.safeParse({ cleanup: 'true', days: 7 });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.cleanup).toBe(true);
          expect(result.data.days).toBe(7);
        }
      });
    });

    describe('stopsQuerySchema', () => {
      it('validates query, route, and limit params', () => {
        const result = stopsQuerySchema.safeParse({
          query: 'Times',
          route: 'A',
          limit: 50,
        });
        expect(result.success).toBe(true);
      });

      it('allows optional params', () => {
        const result = stopsQuerySchema.safeParse({});
        expect(result.success).toBe(true);
      });
    });
  });
});
