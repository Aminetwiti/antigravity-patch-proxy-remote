/** Mock for electron-log */
const noop = (..._args: unknown[]) => {};
const log: Record<string, unknown> = {
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
  verbose: noop,
  silly: noop,
  initialize: noop,
  catchErrors: noop,
  errorHandler: {
    startCatching: noop,
  },
  transports: {
    file: {
      level: false as string | boolean,
      maxSize: 1048576,
      getFile: () => ({ path: '' }),
    },
    console: {
      level: false as string | boolean,
    },
  },
};

(log as Record<string, unknown>).default = log;

export default log;
export const info = noop;
export const warn = noop;
export const error = noop;
export const debug = noop;
export const verbose = noop;
export const silly = noop;
export const initialize = noop;
export const catchErrors = noop;
export const errorHandler = (log as Record<string, unknown>).errorHandler;
export const transports = (log as Record<string, unknown>).transports;

