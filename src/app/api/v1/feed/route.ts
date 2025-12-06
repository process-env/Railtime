import { NextResponse } from 'next/server';
import { listGroups } from '@/lib/mta';

export async function GET() {
  return NextResponse.json({ groups: listGroups() });
}
