import { z } from 'zod';

// ============================================================================
// Query Parameter Schemas
// ============================================================================

/**
 * Hours parameter for analytics queries (1-168 hours, default 24)
 */
export const hoursParamSchema = z.coerce
  .number()
  .int()
  .min(1, 'Hours must be at least 1')
  .max(168, 'Hours cannot exceed 168 (7 days)')
  .default(24);

/**
 * Days parameter for data retention (1-365 days, default 30)
 */
export const daysParamSchema = z.coerce
  .number()
  .int()
  .min(1, 'Days must be at least 1')
  .max(365, 'Days cannot exceed 365')
  .default(30);

/**
 * Limit parameter for pagination (1-2000, default 100)
 */
export const limitParamSchema = z.coerce
  .number()
  .int()
  .min(1, 'Limit must be at least 1')
  .max(2000, 'Limit cannot exceed 2000')
  .default(100);

/**
 * Boolean query parameter (true/false string, or null/undefined)
 * Returns false for null/undefined, true only for 'true'
 */
export const booleanParamSchema = z
  .string()
  .nullish()
  .transform((val) => val === 'true');

// ============================================================================
// Route ID Schemas
// ============================================================================

/**
 * Subway route ID (1-3 alphanumeric characters)
 * Examples: "1", "A", "FS", "SIR"
 */
export const routeIdSchema = z
  .string()
  .min(1, 'Route ID is required')
  .max(3, 'Route ID cannot exceed 3 characters')
  .regex(/^[A-Z0-9]{1,3}$/i, 'Invalid route ID format');

/**
 * Comma-separated route IDs
 */
export const routeFilterSchema = z
  .string()
  .transform((val) => val.split(',').map((r) => r.trim().toUpperCase()))
  .pipe(z.array(routeIdSchema));

/**
 * Stop ID (alphanumeric, may end with N or S for direction)
 * Examples: "101", "101N", "A32S"
 */
export const stopIdSchema = z
  .string()
  .min(1, 'Stop ID is required')
  .max(10, 'Stop ID is too long')
  .regex(/^[A-Z0-9]+[NS]?$/i, 'Invalid stop ID format');

/**
 * Station ID (parent station, numeric or alphanumeric prefix)
 * Examples: "101", "A32"
 */
export const stationIdSchema = z
  .string()
  .min(1, 'Station ID is required')
  .max(10, 'Station ID is too long')
  .regex(/^[A-Z]?\d+$/i, 'Invalid station ID format');

/**
 * Feed group ID
 */
export const feedGroupIdSchema = z.enum([
  'ACE',
  'BDFM',
  'G',
  'JZ',
  'NQRW',
  'L',
  'SI',
  '1234567',
]);

// ============================================================================
// Search Schemas
// ============================================================================

/**
 * Search query (sanitized, max 100 chars)
 */
export const searchQuerySchema = z
  .string()
  .max(100, 'Search query too long')
  .transform((val) => val.trim())
  .optional();

// ============================================================================
// Request Validation Helpers
// ============================================================================

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Validate a value against a schema
 */
export function validate<T>(
  schema: z.ZodType<T>,
  value: unknown
): ValidationResult<T> {
  const result = schema.safeParse(value);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: result.error.issues.map((e) => e.message).join(', '),
  };
}

/**
 * Parse query params from a URL
 */
export function parseQueryParams<T extends z.ZodRawShape>(
  searchParams: URLSearchParams,
  schema: z.ZodObject<T>
): ValidationResult<z.infer<typeof schema>> {
  const params: Record<string, string | null | undefined> = {};

  for (const key of Object.keys(schema.shape)) {
    const value = searchParams.get(key);
    // Include key even if null/undefined so schema defaults work
    params[key] = value ?? undefined;
  }

  return validate(schema, params);
}

// ============================================================================
// Common Request Schemas
// ============================================================================

/**
 * Historical analytics query params
 */
export const historicalQuerySchema = z.object({
  hours: hoursParamSchema,
});

/**
 * Data collection query params
 */
export const collectQuerySchema = z.object({
  cleanup: booleanParamSchema,
  days: daysParamSchema,
});

/**
 * Stops list query params
 */
export const stopsQuerySchema = z.object({
  query: searchQuerySchema,
  route: routeIdSchema.optional(),
  limit: limitParamSchema,
});

/**
 * Alerts query params
 */
export const alertsQuerySchema = z.object({
  route: z.string().optional(),
  nocache: booleanParamSchema,
});
