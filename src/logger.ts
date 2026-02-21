import pino from 'pino';

const level = (process.env.LOG_LEVEL || 'info') as pino.LevelWithSilent;
const pretty = (process.env.LOG_PRETTY || 'false').toLowerCase() === 'true';

export const logger = pretty
  ? pino({
      level,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          singleLine: false,
          destination: 2,
        },
      },
    })
  : pino({ level }, pino.destination(2));

export function redactIfNeeded<T>(obj: T): T | string {
  const redacted =
    (process.env.PROGRESS_REDACT_BODIES || 'false').toLowerCase() === 'true';
  if (!redacted) {
    return obj;
  }
  return '[REDACTED]';
}
