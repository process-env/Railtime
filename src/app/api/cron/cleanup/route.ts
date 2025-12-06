import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, internalError, rateLimited } from '@/lib/api/errors';
import {
  checkRateLimit,
  getClientId,
  createRateLimitKey,
  RATE_LIMITS,
} from '@/lib/api/rate-limit';

/**
 * GET /api/cron/cleanup
 *
 * Automated data cleanup cron job
 * - Removes train snapshots older than 30 days
 * - Removes arrival events older than 30 days
 * - Removes feed poll logs older than 30 days
 *
 * Protected by CRON_SECRET environment variable
 * Designed to be called by Vercel Cron or external cron service
 */
export async function GET(request: NextRequest) {
  try {
    // Rate limit check (strict for admin endpoints)
    const clientId = getClientId(request);
    const key = createRateLimitKey(clientId, '/api/cron/cleanup');
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
      console.error('Cron cleanup: CRON_SECRET not configured in production');
      return internalError('Server misconfiguration: CRON_SECRET required');
    }

    // Validate authorization if secret is set
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('Cron cleanup: Unauthorized attempt');
      return unauthorized();
    }

    // Dynamic import to avoid Turbopack module evaluation issues
    const { cleanupOldData } = await import('@/lib/data-collector');

    // Default retention: 30 days
    const daysToKeep = parseInt(process.env.DATA_RETENTION_DAYS || '30', 10);

    console.log(`Cron cleanup: Starting cleanup (keeping ${daysToKeep} days)`);
    const startTime = Date.now();

    const result = await cleanupOldData(daysToKeep);

    const duration = Date.now() - startTime;

    console.log(
      `Cron cleanup: Completed in ${duration}ms. ` +
      `Deleted: ${result.trainSnapshots} snapshots, ` +
      `${result.arrivalEvents} arrivals, ` +
      `${result.feedLogs} feed logs`
    );

    return NextResponse.json({
      success: true,
      deleted: {
        trainSnapshots: result.trainSnapshots,
        arrivalEvents: result.arrivalEvents,
        feedLogs: result.feedLogs,
      },
      daysKept: daysToKeep,
      durationMs: duration,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Cron cleanup error:', error);
    return internalError(error instanceof Error ? error.message : 'Cleanup failed');
  }
}
