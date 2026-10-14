// Oddiy logger (pm2 logs uchun) — vaqt + daraja + qo'ng'iroq ID'si.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

let minLevel: Level = 'info';
export function setLogLevel(level: Level) {
  minLevel = LEVELS[level] ? level : 'info';
}

function write(level: Level, scope: string, msg: string) {
  if (LEVELS[level] < LEVELS[minLevel]) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export function logger(scope: string): Logger {
  return {
    debug: (m) => write('debug', scope, m),
    info: (m) => write('info', scope, m),
    warn: (m) => write('warn', scope, m),
    error: (m) => write('error', scope, m),
  };
}
