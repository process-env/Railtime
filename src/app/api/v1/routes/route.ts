import { NextResponse } from 'next/server';
import { loadRoutes } from '@/lib/mta';
import { internalError } from '@/lib/api/errors';

export async function GET() {
  try {
    const { list } = await loadRoutes();
    return NextResponse.json(list);
  } catch (error) {
    console.error('Error loading routes:', error);
    return internalError(error instanceof Error ? error.message : 'Failed to load routes');
  }
}
