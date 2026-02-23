import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

const transport = !isProduction
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname,service',
      },
    }
  : undefined;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(transport ? { transport } : {}),
  base: {
    service: 'railtime-ws-server',
    pid: process.pid,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Create a child logger with a module name.
 * Usage: const log = createLogger('feed-loop');
 */
export function createLogger(module: string) {
  return logger.child({ module });
}
