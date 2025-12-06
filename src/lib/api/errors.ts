import { NextResponse } from 'next/server';

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE';

interface ApiError {
  code: ErrorCode;
  message: string;
}

const STATUS_MAP: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export function apiError(code: ErrorCode, message: string): NextResponse {
  const error: ApiError = { code, message };
  return NextResponse.json({ error }, { status: STATUS_MAP[code] });
}

export function badRequest(message: string): NextResponse {
  return apiError('BAD_REQUEST', message);
}

export function unauthorized(message = 'Unauthorized'): NextResponse {
  return apiError('UNAUTHORIZED', message);
}

export function forbidden(message = 'Forbidden'): NextResponse {
  return apiError('FORBIDDEN', message);
}

export function notFound(message: string): NextResponse {
  return apiError('NOT_FOUND', message);
}

export function validationError(message: string): NextResponse {
  return apiError('VALIDATION_ERROR', message);
}

export function internalError(message = 'Internal server error'): NextResponse {
  return apiError('INTERNAL_ERROR', message);
}

export function serviceUnavailable(message: string): NextResponse {
  return apiError('SERVICE_UNAVAILABLE', message);
}

export function rateLimited(retryAfterMs: number): NextResponse {
  const retryAfterSec = Math.ceil(retryAfterMs / 1000);
  const response = NextResponse.json(
    { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
    { status: 429 }
  );
  response.headers.set('Retry-After', String(retryAfterSec));
  return response;
}
