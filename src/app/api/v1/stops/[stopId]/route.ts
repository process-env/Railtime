import { NextRequest, NextResponse } from 'next/server';
import { getStop } from '@/lib/mta';
import { apiError, internalError } from '@/lib/api/errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ stopId: string }> }
) {
  try {
    const { stopId } = await params;

    const stop = await getStop(stopId);

    if (!stop) {
      return apiError('NOT_FOUND', 'Stop not found');
    }

    return NextResponse.json(stop);
  } catch (error) {
    console.error('Error getting stop:', error);
    return internalError('Failed to get stop');
  }
}
