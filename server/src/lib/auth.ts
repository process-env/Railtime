/**
 * Socket.IO connection middleware for token-based authentication.
 *
 * Validates socket.handshake.auth.token against process.env.WS_AUTH_TOKEN.
 * If the env var is not set, validation is skipped (graceful degradation for dev).
 * If set and the token does not match, the connection is rejected with "unauthorized".
 */
import type { Socket } from 'socket.io';
import { createLogger } from './logger.js';

const log = createLogger('auth');

type NextFn = (err?: Error) => void;

/**
 * Connection middleware to attach via `namespace.use(authMiddleware)`.
 */
export function authMiddleware(socket: Socket, next: NextFn): void {
  const expectedToken = process.env.WS_AUTH_TOKEN;

  // Graceful degradation: if no token is configured, allow all connections
  if (!expectedToken) {
    next();
    return;
  }

  const clientToken = socket.handshake.auth?.token as string | undefined;

  if (clientToken === expectedToken) {
    next();
  } else {
    log.warn(
      { socketId: socket.id, hasToken: !!clientToken },
      'connection rejected: unauthorized',
    );
    next(new Error('unauthorized'));
  }
}
