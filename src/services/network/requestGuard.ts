type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type RequestState<T> = {
  inFlight: Promise<T> | null;
  cache: CacheEntry<T> | null;
  backoffUntilMs: number;
  backoffMs: number;
};

const requestStates = new Map<string, RequestState<any>>();
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class RateLimitError extends Error {
  readonly service: string;
  readonly status: number;
  readonly retryAfterMs: number;

  constructor(service: string, status: number, retryAfterMs: number, message: string) {
    super(message);
    this.name = 'RateLimitError';
    this.service = service;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function getState<T>(key: string): RequestState<T> {
  let state = requestStates.get(key);
  if (!state) {
    state = {
      inFlight: null,
      cache: null,
      backoffUntilMs: 0,
      backoffMs: 1000,
    };
    requestStates.set(key, state);
  }
  return state;
}

function describeKey(key: string): string {
  return key.replace(/\s+/g, ' ');
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds * 1000));
  }
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

export function createRateLimitError(service: string, response: Response): RateLimitError {
  const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After')) ?? 0;
  return new RateLimitError(
    service,
    response.status,
    retryAfterMs,
    `${service} returned HTTP 429${retryAfterMs > 0 ? `; retry after ${Math.ceil(retryAfterMs / 1000)}s` : ''}`,
  );
}

export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError;
}

async function executeWithTimeout<T>(
  service: string,
  timeoutMs: number,
  execute: () => Promise<T>,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return execute();

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      execute(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${service} timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}

export async function guardedRequest<T>(options: {
  service: string;
  key: string;
  cacheTtlMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  cacheIf?: (value: T) => boolean;
  timeoutMs?: number;
  execute: () => Promise<T>;
}): Promise<T> {
  const {
    service,
    key,
    cacheTtlMs = 0,
    backoffBaseMs = 1000,
    backoffMaxMs = 5 * 60 * 1000,
    cacheIf = () => true,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    execute,
  } = options;
  const state = getState<T>(`${service}:${key}`);
  const now = Date.now();

  if (state.cache && state.cache.expiresAt > now) {
    console.log(`[${service}] cache hit for ${describeKey(key)}`);
    return state.cache.value;
  }

  if (state.backoffUntilMs > now) {
    const waitMs = state.backoffUntilMs - now;
    console.warn(
      `[${service}] backoff active for ${describeKey(key)} (${Math.ceil(waitMs / 1000)}s remaining)`,
    );
    throw new RateLimitError(
      service,
      429,
      waitMs,
      `${service} backoff active for ${Math.ceil(waitMs / 1000)}s`,
    );
  }

  if (state.inFlight) {
    console.log(`[${service}] duplicate request skipped; using in-flight promise for ${describeKey(key)}`);
    return state.inFlight;
  }

  const promise = (async () => {
    try {
      const value = await executeWithTimeout(service, timeoutMs, execute);
      if (cacheTtlMs > 0 && cacheIf(value)) {
        state.cache = {
          expiresAt: Date.now() + cacheTtlMs,
          value,
        };
        console.log(`[${service}] cached result for ${describeKey(key)} (${Math.ceil(cacheTtlMs / 1000)}s ttl)`);
      }
      state.backoffUntilMs = 0;
      state.backoffMs = backoffBaseMs;
      return value;
    } catch (error) {
      if (isRateLimitError(error)) {
        const retryAfterMs = error.retryAfterMs > 0
          ? error.retryAfterMs
          : state.backoffMs;
        const nextBackoffMs = Math.min(Math.max(retryAfterMs * 2, backoffBaseMs), backoffMaxMs);
        state.backoffUntilMs = Date.now() + retryAfterMs;
        state.backoffMs = nextBackoffMs;
        console.warn(
          `[${service}] HTTP 429 received for ${describeKey(key)}; ` +
          `backing off ${Math.ceil(retryAfterMs / 1000)}s` +
          (error.retryAfterMs > 0 ? ' (Retry-After honored)' : ''),
        );
      }
      throw error;
    } finally {
      state.inFlight = null;
    }
  })();

  state.inFlight = promise;
  return promise;
}
