/**
 * Scoped logger. Debug output is compiled out of production builds by Vite's
 * dead-code elimination on `import.meta.env.DEV`; warnings and errors always surface.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const isDev = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLogger(scope: string): Logger {
  const prefix = `[${scope}]`;
  const write = (level: Level, args: unknown[]): void => {
    if (level === 'debug' && !isDev) return;
    const fn = level === 'debug' ? console.debug : console[level];
    fn.call(console, prefix, ...args);
  };
  return {
    debug: (...args) => write('debug', args),
    info: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
  };
}
