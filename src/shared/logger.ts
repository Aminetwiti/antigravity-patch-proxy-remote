export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  child: (subScope: string) => Logger;
}

const LEVEL_PREFIX: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};

function ts(): string {
  return new Date().toISOString();
}

function emit(level: LogLevel, scope: string, args: unknown[]): void {
  const prefix = `[${scope}]`;
  const head = `${ts()} ${LEVEL_PREFIX[level]} ${prefix}`;
  const fn =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : level === 'info'
          ? console.info
          : console.debug;
  if (args.length === 1 && args[0] && typeof args[0] === 'object') {
    fn(head, args[0]);
  } else {
    fn(head, ...args);
  }
}

export function createLogger(scope: string): Logger {
  return makeLogger(scope);
}

function makeLogger(scope: string): Logger {
  return {
    debug: (...args) => emit('debug', scope, args),
    info: (...args) => emit('info', scope, args),
    warn: (...args) => emit('warn', scope, args),
    error: (...args) => emit('error', scope, args),
    child: (subScope) => makeLogger(`${scope}.${subScope}`),
  };
}

export const logger: Logger = createLogger('App');
