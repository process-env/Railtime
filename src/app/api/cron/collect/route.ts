import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, internalError, rateLimited } from '@/lib/api/errors';
import {
  checkRateLimit,
  getClientId,
  createRateLimitKey,
  RATE_LIMITS,
} from '@/lib/api/rate-limit';

/**
 * GET /api/cron/collect
 *
 * Automated data collection cron job (runs at 12am daily)
 * - Collects train position snapshots
 * - Collects arrival predictions
 * - Collects service alerts
 * - Clears schedule cache to prevent memory leaks
 *
 * Protected by CRON_SECRET environment variable
 * Designed to be called by Vercel Cron or external cron service
 */
export async function GET(request: NextRequest) {
  try {
    // Rate limit check (strict for admin endpoints)
    const clientId = getClientId(request);
    const key = createRateLimitKey(clientId, '/api/cron/collect');
    const limit = checkRateLimit(key, RATE_LIMITS.admin);
    if (!limit.success) {
      return rateLimited(limit.resetIn);
    }

    // Verify cron secret for security
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const isProduction = process.env.NODE_ENV === 'production';

    // In production, CRON_SECRET is REQUIRED
    if (isProduction && !cronSecret) {
      console.error('Cron collect: CRON_SECRET not configured in production');
      return internalError('Server misconfiguration: CRON_SECRET required');
    }

    // Validate authorization if secret is set
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('Cron collect: Unauthorized attempt');
      return unauthorized();
    }

    // Dynamic imports to avoid Turbopack module evaluation issues
    const { runCollection } = await import('@/lib/data-collector');
    const { clearScheduleCache } = await import('@/lib/mta/load-schedule');

    console.log('Cron collect: Starting data collection');
    const startTime = Date.now();

    const result = await runCollection();

    // Clear schedule cache to free memory (562k rows)
    clearScheduleCache();

    const duration = Date.now() - startTime;

    console.log(
      `Cron collect: Completed in ${duration}ms. ` +
      `Snapshots: ${result.trainSnapshots}, ` +
      `Arrivals: ${result.arrivalEvents}, ` +
      `Alerts: ${result.alertsUpdated}`
    );

    if (result.errors.length > 0) {
      console.warn('Cron collect errors:', result.errors);
    }

    return NextResponse.json({
      success: true,
      collection: {
        trainSnapshots: result.trainSnapshots,
        arrivalEvents: result.arrivalEvents,
        alertsUpdated: result.alertsUpdated,
        feedLogs: result.feedLogs,
      },
      errors: result.errors.length > 0 ? result.errors : undefined,
      durationMs: duration,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Cron collect error:', error);
    return internalError(error instanceof Error ? error.message : 'Collection failed');
  }
}
