export type DailyMonitorLocationSource = 'current' | 'os_last_known' | 'stormlog_cached';

export type DailyMonitorResolvedLocation = {
  latitude: number;
  longitude: number;
  source: DailyMonitorLocationSource;
  sourceTimestampMs: number;
  ageMs: number;
};

export type DailyMonitorLocationCandidate = {
  coords?: { latitude?: number | null; longitude?: number | null } | null;
  timestamp?: number | null;
} | null;

export type DailyMonitorLocationResolverDependencies = {
  getCurrentPosition: () => Promise<DailyMonitorLocationCandidate>;
  getLastKnownPosition: () => Promise<DailyMonitorLocationCandidate>;
  readCachedLocation: () => Promise<{ latitude: number; longitude: number; timestampMs: number } | null>;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
};

export type DailyMonitorLocationResolverOptions = {
  currentFixTimeoutMs?: number;
  maxLastKnownAgeMs?: number;
  maxCachedAgeMs?: number;
};

const DEFAULT_CURRENT_FIX_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_LAST_KNOWN_AGE_MS = 5 * 60_000;
const DEFAULT_MAX_CACHED_AGE_MS = 15 * 60_000;

function finiteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validCoordinates(latitude: unknown, longitude: unknown): latitude is number {
  return finiteCoordinate(latitude)
    && finiteCoordinate(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

function normalizeCandidate(
  candidate: DailyMonitorLocationCandidate,
  source: Exclude<DailyMonitorLocationSource, 'stormlog_cached'>,
  nowMs: number,
): DailyMonitorResolvedLocation | null {
  const latitude = candidate?.coords?.latitude;
  const longitude = candidate?.coords?.longitude;
  if (!validCoordinates(latitude, longitude)) return null;

  const timestamp = candidate?.timestamp;
  const sourceTimestampMs = typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0
    ? timestamp
    : nowMs;
  const ageMs = Math.max(0, nowMs - sourceTimestampMs);

  return { latitude, longitude, source, sourceTimestampMs, ageMs };
}

function normalizeCached(
  cached: { latitude: number; longitude: number; timestampMs: number } | null,
  nowMs: number,
): DailyMonitorResolvedLocation | null {
  if (!cached || !validCoordinates(cached.latitude, cached.longitude)) return null;
  if (!Number.isFinite(cached.timestampMs) || cached.timestampMs <= 0) return null;
  return {
    latitude: cached.latitude,
    longitude: cached.longitude,
    source: 'stormlog_cached',
    sourceTimestampMs: cached.timestampMs,
    ageMs: Math.max(0, nowMs - cached.timestampMs),
  };
}

export async function resolveDailyMonitorLocation(
  dependencies: DailyMonitorLocationResolverDependencies,
  options: DailyMonitorLocationResolverOptions = {},
): Promise<DailyMonitorResolvedLocation> {
  const now = dependencies.now ?? Date.now;
  const wait = dependencies.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const currentFixTimeoutMs = Math.max(1_000, options.currentFixTimeoutMs ?? DEFAULT_CURRENT_FIX_TIMEOUT_MS);
  const maxLastKnownAgeMs = Math.max(0, options.maxLastKnownAgeMs ?? DEFAULT_MAX_LAST_KNOWN_AGE_MS);
  const maxCachedAgeMs = Math.max(0, options.maxCachedAgeMs ?? DEFAULT_MAX_CACHED_AGE_MS);

  // Start fallbacks at the same time as GPS. On a moving/background device,
  // getCurrentPosition can be slow; we should already have fallback candidates
  // ready when the bounded fresh-fix window expires.
  const lastKnownPromise = dependencies.getLastKnownPosition().catch(() => null);
  const cachedPromise = dependencies.readCachedLocation().catch(() => null);

  const currentOutcome = await Promise.race([
    dependencies.getCurrentPosition()
      .then((candidate) => ({ kind: 'candidate' as const, candidate }))
      .catch((error) => ({ kind: 'error' as const, error })),
    wait(currentFixTimeoutMs).then(() => ({ kind: 'timeout' as const })),
  ]);

  const nowMs = now();
  if (currentOutcome.kind === 'candidate') {
    const current = normalizeCandidate(currentOutcome.candidate, 'current', nowMs);
    if (current) return current;
  }

  const lastKnown = normalizeCandidate(await lastKnownPromise, 'os_last_known', nowMs);
  if (lastKnown && lastKnown.ageMs <= maxLastKnownAgeMs) return lastKnown;

  const cached = normalizeCached(await cachedPromise, nowMs);
  if (cached && cached.ageMs <= maxCachedAgeMs) return cached;

  const reasons = [
    currentOutcome.kind === 'timeout' ? `fresh GPS timed out after ${currentFixTimeoutMs}ms` : 'fresh GPS unavailable',
    lastKnown ? `last-known location is ${Math.round(lastKnown.ageMs / 60_000)}m old` : 'last-known location unavailable',
    cached ? `cached location is ${Math.round(cached.ageMs / 60_000)}m old` : 'cached location unavailable',
  ];
  throw new Error(`No sufficiently fresh location available (${reasons.join('; ')})`);
}
