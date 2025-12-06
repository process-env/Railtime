import { NextRequest, NextResponse } from 'next/server';
import { getArrivalBoard } from '@/lib/mta';
import { internalError } from '@/lib/api/errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string; stopId: string }> }
) {
  try {
    const { groupId, stopId } = await params;
    const { searchParams } = new URL(request.url);
    const noCache = searchParams.get('nocache') === 'true';

    const board = await getArrivalBoard(groupId, stopId, { useCache: !noCache });

    return NextResponse.json(board);
  } catch (error) {
    console.error('Error getting arrivals:', error);
    return internalError(error instanceof Error ? error.message : 'Failed to get arrivals');
  }
}
