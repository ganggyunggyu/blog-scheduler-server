type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';
type LogContext = Record<string, unknown>;
type LogFn = (...args: unknown[]) => void;

interface Logger {
  level: string;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  debug: LogFn;
  trace: LogFn;
  fatal: LogFn;
  silent: LogFn;
  child: (bindings: LogContext) => Logger;
}

const INCLUDE_STACK = process.env.NODE_ENV !== 'production';

function isRecord(value: unknown): value is LogContext {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatTimestamp(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}.${ms}`;
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(value, (_, val) => {
    if (typeof val === 'bigint') return val.toString();
    if (typeof val === 'function') return '[Function]';
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
    }
    return val;
  });
}

function formatString(value: string): string {
  if (value.length === 0) return '""';
  if (/[\s=|"]/g.test(value)) return JSON.stringify(value);
  return value;
}

function formatValue(value: unknown): string {
  if (value instanceof Date) return formatTimestamp(value);
  if (typeof value === 'string') return formatString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return safeStringify(value);
}

function errorToContext(error: unknown): LogContext {
  if (error instanceof Error) {
    const result: LogContext = {
      errorName: error.name,
      errorMessage: error.message,
    };
    if (INCLUDE_STACK && error.stack) {
      result.errorStack = error.stack;
    }
    return result;
  }

  if (typeof error === 'string') {
    return { errorMessage: error };
  }

  return { error };
}

function summarizeRequest(req: LogContext): LogContext {
  const socket = (req as { socket?: { remoteAddress?: string; remotePort?: number } }).socket;
  return {
    id: req.id ?? req.requestId,
    method: req.method,
    url: req.url ?? req.originalUrl,
    remoteAddress: req.remoteAddress ?? req.ip ?? socket?.remoteAddress,
    remotePort: req.remotePort ?? socket?.remotePort,
  };
}

function summarizeResponse(res: LogContext): LogContext {
  return {
    statusCode: res.statusCode,
  };
}

function normalizeContext(context: LogContext): LogContext {
  const normalized: LogContext = {};

  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue;

    if (key === 'req' && isRecord(value)) {
      normalized.request = summarizeRequest(value);
      continue;
    }

    if (key === 'res' && isRecord(value)) {
      normalized.response = summarizeResponse(value);
      continue;
    }

    if ((key === 'err' || key === 'error') && (value instanceof Error || typeof value === 'string')) {
      Object.assign(normalized, errorToContext(value));
      continue;
    }

    normalized[key] = value;
  }

  return normalized;
}

function normalizeArgs(args: any[], bindings: LogContext): { message: string; context: LogContext } {
  let message = '';
  let context: LogContext = { ...bindings };

  if (args.length === 0) {
    return { message: '-', context };
  }

  const [first, second, ...rest] = args;

  if (typeof first === 'string') {
    message = first;
    if (second instanceof Error) {
      context = { ...context, ...errorToContext(second) };
    } else if (isRecord(second)) {
      context = { ...context, ...second };
    } else if (second !== undefined) {
      context.extra = [second, ...rest];
    }
  } else if (first instanceof Error) {
    context = { ...context, ...errorToContext(first) };
    message = typeof second === 'string' ? second : first.message;
    if (isRecord(second)) {
      context = { ...context, ...second };
    } else if (second !== undefined) {
      context.extra = [second, ...rest];
    }
  } else if (isRecord(first)) {
    context = { ...context, ...first };
    if (typeof second === 'string') {
      message = second;
    } else if (second instanceof Error) {
      context = { ...context, ...errorToContext(second) };
    } else if (second !== undefined) {
      context.extra = [second, ...rest];
    }
  } else {
    message = String(first);
    if (second instanceof Error) {
      context = { ...context, ...errorToContext(second) };
    } else if (isRecord(second)) {
      context = { ...context, ...second };
    } else if (second !== undefined) {
      context.extra = [second, ...rest];
    }
  }

  if (!message) message = '-';

  return { message, context: normalizeContext(context) };
}

function formatContext(context: LogContext): string {
  const entries = Object.entries(context).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return '';

  entries.sort((a, b) => {
    if (a[0] === 'scope') return -1;
    if (b[0] === 'scope') return 1;
    return a[0].localeCompare(b[0]);
  });

  return entries.map(([key, value]) => `${key}=${formatValue(value)}`).join(' ');
}

function formatLine(level: LogLevel, message: string, context: LogContext): string {
  const timestamp = formatTimestamp();
  const label = level.toUpperCase().padEnd(5);
  const contextText = formatContext(context);
  if (!contextText) {
    return `${timestamp} ${label} ${message}`;
  }
  return `${timestamp} ${label} ${message} | ${contextText}`;
}

function createLogger(bindings: LogContext = {}): Logger {
  const emit = (level: LogLevel): LogFn => {
    if (level === 'silent') return () => {};

    return (...args: any[]) => {
      const { message, context } = normalizeArgs(args, bindings);
      const line = formatLine(level, message, context);

      if (level === 'warn') {
        console.warn(line);
        return;
      }

      if (level === 'error' || level === 'fatal') {
        console.error(line);
        return;
      }

      console.log(line);
    };
  };

  return {
    level: 'info',
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    debug: emit('debug'),
    trace: emit('trace'),
    fatal: emit('fatal'),
    silent: emit('silent'),
    child: (childBindings: LogContext) => createLogger({ ...bindings, ...childBindings }),
  };
}

export const logger = createLogger();
