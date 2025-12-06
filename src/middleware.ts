import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js Middleware
 * Rate limiting disabled - enable in production with proper tuning
 */
export function middleware(request: NextRequest) {
  // Rate limiting disabled for now - the limits need tuning for real-time tracking apps
  // which make many rapid API calls by design
  return NextResponse.next();
}

/**
 * Configure which routes the middleware should run on
 */
export const config = {
  matcher: [
    // Match all API routes except static files
    '/api/:path*',
  ],
};
