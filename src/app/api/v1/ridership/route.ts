import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getRidershipForDate, getRidershipRange } from '@/lib/analytics/ridership-lookup';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const daysParam = searchParams.get('days');
  const days = daysParam ? parseInt(daysParam, 10) : 30;

  if (isNaN(days) || days < 1) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid days parameter' } },
      { status: 400 },
    );
  }

  const clampedDays = Math.min(days, 365);
  const today = getRidershipForDate();
  const range = getRidershipRange(clampedDays);
  const totalRidership = range.reduce((sum, d) => sum + d.ridership, 0);
  const avgDaily = range.length > 0 ? Math.round(totalRidership / range.length) : 0;

  return NextResponse.json({
    days: range.map(d => ({
      date: d.date,
      ridership: d.ridership,
      prePandemicPercent: d.prePandemicPercent,
    })),
    latest: {
      date: today.date,
      ridership: today.ridership,
      prePandemicPercent: today.prePandemicPercent,
    },
    avgDaily,
    totalRidership,
    dailyFareRevenue: today.dailyFareRevenue,
    updatedAt: new Date().toISOString(),
  });
}
